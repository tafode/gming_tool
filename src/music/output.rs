//! Where audio actually comes out.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player};
use thiserror::Error;

/// Something went wrong while trying to play audio.
#[derive(Debug, Error)]
pub enum AudioError {
    #[error("could not open an audio device: {0}")]
    NoDevice(String),
    #[error("refusing to play an empty path")]
    EmptyPath,
    #[error("could not play {path}: {message}")]
    Play { path: PathBuf, message: String },
}

/// A destination for audio playback.
///
/// Implementations are owned by the app on the main thread, so they do not need
/// to be `Send`.
pub trait AudioOutput {
    /// Start playing `path`, replacing anything already playing.
    fn play_file(&mut self, path: &Path) -> Result<(), AudioError>;
    /// Pause playback, keeping the current position.
    fn pause(&mut self);
    /// Resume after [`AudioOutput::pause`].
    fn resume(&mut self);
    /// Stop playback and unload the current track.
    fn stop(&mut self);
    /// Set the output volume, where `1.0` is normal.
    fn set_volume(&mut self, volume: f32);
    /// Whether audio is currently being produced.
    fn is_playing(&self) -> bool;
    /// Whether the current track has run to its end.
    fn is_finished(&self) -> bool;
    /// The current volume.
    fn volume(&self) -> f32;
}

#[derive(Debug)]
struct SilentState {
    played: Vec<PathBuf>,
    volume: f32,
    playing: bool,
    paused: bool,
    stopped: bool,
}

impl Default for SilentState {
    fn default() -> Self {
        Self {
            played: Vec::new(),
            volume: 1.0,
            playing: false,
            paused: false,
            stopped: false,
        }
    }
}

/// An [`AudioOutput`] that makes no sound.
///
/// It records what it was asked to do, which makes it useful in two roles:
/// as a placeholder until the real audio backend exists, and as a test double.
#[derive(Debug, Clone, Default)]
pub struct SilentAudioOutput {
    state: Arc<Mutex<SilentState>>,
}

impl SilentAudioOutput {
    /// Every path passed to [`AudioOutput::play_file`], in order.
    #[cfg(test)]
    pub fn played_files(&self) -> Vec<PathBuf> {
        self.state.lock().unwrap().played.clone()
    }

    /// Whether [`AudioOutput::pause`] was called most recently.
    #[cfg(test)]
    pub fn is_paused(&self) -> bool {
        self.state.lock().unwrap().paused
    }

    /// Whether [`AudioOutput::stop`] was ever called.
    #[cfg(test)]
    pub fn was_stopped(&self) -> bool {
        self.state.lock().unwrap().stopped
    }
}

impl AudioOutput for SilentAudioOutput {
    fn play_file(&mut self, path: &Path) -> Result<(), AudioError> {
        if path.as_os_str().is_empty() {
            return Err(AudioError::EmptyPath);
        }
        let mut state = self.state.lock().unwrap();
        state.played.push(path.to_path_buf());
        state.playing = true;
        state.paused = false;
        Ok(())
    }

    fn pause(&mut self) {
        let mut state = self.state.lock().unwrap();
        if state.playing {
            state.playing = false;
            state.paused = true;
        }
    }

    fn resume(&mut self) {
        let mut state = self.state.lock().unwrap();
        if state.paused {
            state.paused = false;
            state.playing = true;
        }
    }

    fn stop(&mut self) {
        let mut state = self.state.lock().unwrap();
        state.playing = false;
        state.paused = false;
        state.stopped = true;
    }

    fn set_volume(&mut self, volume: f32) {
        self.state.lock().unwrap().volume = volume;
    }

    fn is_playing(&self) -> bool {
        self.state.lock().unwrap().playing
    }

    fn is_finished(&self) -> bool {
        false
    }

    fn volume(&self) -> f32 {
        self.state.lock().unwrap().volume
    }
}

/// The real audio backend, built on [`rodio`].
///
/// Opening the default output device can fail (headless machines, no sound
/// card, busy device), so [`RodioOutput::new`] returns a [`Result`] and callers
/// are expected to fall back to [`SilentAudioOutput`].
pub struct RodioOutput {
    /// Kept alive for as long as we want sound: dropping it closes the stream.
    sink: MixerDeviceSink,
    /// The player for the track that is currently loaded.
    player: Player,
    volume: f32,
    /// Whether a track has been loaded since the last [`AudioOutput::stop`].
    loaded: bool,
}

impl RodioOutput {
    /// Open the default audio output device.
    pub fn new() -> Result<Self, AudioError> {
        let sink = DeviceSinkBuilder::open_default_sink()
            .map_err(|err| AudioError::NoDevice(err.to_string()))?;
        let player = Player::connect_new(sink.mixer());
        Ok(Self {
            sink,
            player,
            volume: 1.0,
            loaded: false,
        })
    }
}

impl AudioOutput for RodioOutput {
    fn play_file(&mut self, path: &Path) -> Result<(), AudioError> {
        if path.as_os_str().is_empty() {
            return Err(AudioError::EmptyPath);
        }

        let file = File::open(path).map_err(|err| AudioError::Play {
            path: path.to_path_buf(),
            message: err.to_string(),
        })?;
        let decoder = Decoder::try_from(file).map_err(|err| AudioError::Play {
            path: path.to_path_buf(),
            message: err.to_string(),
        })?;

        // A fresh player per track. Assigning drops the previous player, which
        // stops the old sound before the new one starts -- and does so without
        // blocking the UI thread, unlike stopping and re-appending to a single
        // player (which can wait on the old sound to finish).
        self.player = Player::connect_new(self.sink.mixer());
        self.player.set_volume(self.volume);
        self.player.append(decoder);
        self.player.play();
        self.loaded = true;
        Ok(())
    }

    fn pause(&mut self) {
        self.player.pause();
    }

    fn resume(&mut self) {
        self.player.play();
    }

    fn stop(&mut self) {
        self.player.stop();
        self.loaded = false;
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        self.player.set_volume(volume);
    }

    fn is_playing(&self) -> bool {
        self.loaded && !self.player.is_paused() && !self.player.empty()
    }

    fn is_finished(&self) -> bool {
        self.loaded && self.player.empty()
    }

    fn volume(&self) -> f32 {
        self.volume
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_playback_requests() {
        let mut output = SilentAudioOutput::default();
        output.play_file(Path::new("/music/one.m4a")).unwrap();
        output.play_file(Path::new("/music/two.m4a")).unwrap();

        assert_eq!(
            output.played_files(),
            vec![
                PathBuf::from("/music/one.m4a"),
                PathBuf::from("/music/two.m4a")
            ]
        );
        assert!(output.is_playing());
    }

    #[test]
    fn pause_resume_and_stop_change_state() {
        let mut output = SilentAudioOutput::default();
        output.play_file(Path::new("/music/one.m4a")).unwrap();

        output.pause();
        assert!(!output.is_playing());
        assert!(output.is_paused());

        output.resume();
        assert!(output.is_playing());
        assert!(!output.is_paused());

        output.stop();
        assert!(!output.is_playing());
        assert!(output.was_stopped());
    }

    #[test]
    fn volume_starts_at_full_and_can_be_changed() {
        let mut output = SilentAudioOutput::default();
        assert_eq!(output.volume(), 1.0);
        output.set_volume(0.25);
        assert_eq!(output.volume(), 0.25);
    }

    #[test]
    fn rejects_an_empty_path() {
        let mut output = SilentAudioOutput::default();
        assert!(matches!(
            output.play_file(Path::new("")),
            Err(AudioError::EmptyPath)
        ));
    }

    // -- real backend ------------------------------------------------------

    /// Write a short, silent 16-bit mono PCM WAV file.
    ///
    /// Generated by hand so the test needs no sample asset on disk.
    fn write_silent_wav(path: &Path, seconds: u32) {
        let sample_rate: u32 = 44_100;
        let frames = sample_rate * seconds;
        let data_len = frames * 2; // 16-bit mono

        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(bytes.len() + data_len as usize, 0);

        std::fs::write(path, bytes).expect("write wav");
    }

    fn temp_path(tag: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("gming_tool_output_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn rodio_new_either_opens_a_device_or_reports_none() {
        // Most CI machines have no audio device; both outcomes are fine, but
        // the app must never panic on startup.
        match RodioOutput::new() {
            Ok(output) => {
                assert_eq!(output.volume(), 1.0);
                assert!(!output.is_playing());
                assert!(!output.is_finished());
            }
            Err(AudioError::NoDevice(_)) => {}
            Err(other) => panic!("unexpected error opening a device: {other}"),
        }
    }

    #[test]
    fn rodio_reports_a_missing_file_as_a_play_error() {
        let Ok(mut output) = RodioOutput::new() else {
            return; // no audio device on this machine
        };
        assert!(matches!(
            output.play_file(Path::new("")),
            Err(AudioError::EmptyPath)
        ));
        assert!(matches!(
            output.play_file(Path::new("/definitely/not/here.m4a")),
            Err(AudioError::Play { .. })
        ));
    }

    #[test]
    fn rodio_plays_a_real_file_end_to_end() {
        let Ok(mut output) = RodioOutput::new() else {
            return; // no audio device on this machine
        };

        let dir = temp_path("play");
        let wav = dir.join("tone.wav");
        write_silent_wav(&wav, 2);

        output.set_volume(0.0); // keep the test quiet
        output.play_file(&wav).expect("play generated wav");
        assert!(output.is_playing(), "should be playing right after start");
        assert!(!output.is_finished());

        output.pause();
        assert!(!output.is_playing());
        output.resume();
        assert!(output.is_playing());

        output.stop();
        assert!(!output.is_playing());
        assert!(!output.is_finished(), "a stopped track is not 'finished'");
    }
}
