//! Where audio actually comes out.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use thiserror::Error;

/// Something went wrong while trying to play audio.
#[derive(Debug, Error)]
pub enum AudioError {
    #[error("refusing to play an empty path")]
    EmptyPath,
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
}
