//! Turning a YouTube URL into metadata and a local audio file.

use std::path::PathBuf;
use std::sync::Mutex;

use thiserror::Error;

use super::video_id_from_url;
use super::yt_dlp::{self, YtDlp};

/// What we know about a video after resolving its URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackMetadata {
    pub video_id: String,
    pub title: String,
}

/// Something went wrong while resolving a URL.
#[derive(Debug, Error)]
pub enum ResolveError {
    #[error("that does not look like a YouTube link")]
    NotYouTube,
    #[error("{0}")]
    Tool(String),
    #[error("{0}")]
    Download(String),
    #[error("the download finished but produced no audio file")]
    NoAudio,
    #[error("{0}")]
    Network(String),
}

/// Looks up video metadata and makes sure the audio is available locally.
///
/// Implementations block, so callers must run them off the UI thread.
pub trait Resolver: Send + Sync {
    /// Look up the title and id for `url`, without downloading audio.
    fn metadata(&self, url: &str) -> Result<TrackMetadata, ResolveError>;

    /// Ensure the audio for `video_id` is available, returning its local path.
    fn audio_file(&self, url: &str, video_id: &str) -> Result<PathBuf, ResolveError>;
}

/// The real resolver: metadata and audio come from [`yt_dlp::YtDlp`], and
/// downloaded audio is cached under `cache_dir`.
///
/// The `yt-dlp` binary itself is only located (and, if necessary, downloaded)
/// the first time a URL actually needs resolving, so simply starting the app
/// never touches the network.
#[derive(Debug)]
pub struct YtDlpResolver {
    cache_dir: PathBuf,
    tools_dir: PathBuf,
    /// Resolved lazily on first use, then reused. Access is serialised so two
    /// concurrent jobs cannot install the binary at the same time.
    tool: Mutex<Option<YtDlp>>,
}

impl YtDlpResolver {
    pub fn new(cache_dir: impl Into<PathBuf>, tools_dir: impl Into<PathBuf>) -> Self {
        Self {
            cache_dir: cache_dir.into(),
            tools_dir: tools_dir.into(),
            tool: Mutex::new(None),
        }
    }

    /// The `yt-dlp` binary, finding or installing it on first use.
    ///
    /// The lock is held across discovery on purpose: two background jobs
    /// starting at once must not both download the binary into the same
    /// temporary file.
    fn tool(&self) -> Result<YtDlp, ResolveError> {
        let mut cached = self.tool.lock().unwrap();
        if let Some(tool) = cached.as_ref() {
            return Ok(tool.clone());
        }

        let tool = YtDlp::discover(&self.tools_dir)?;
        *cached = Some(tool.clone());
        Ok(tool)
    }
}

impl Resolver for YtDlpResolver {
    fn metadata(&self, url: &str) -> Result<TrackMetadata, ResolveError> {
        // Cheap, offline rejection of obvious mistakes, so we never spawn a
        // process for input that could not possibly work.
        if video_id_from_url(url).is_none() {
            return Err(ResolveError::NotYouTube);
        }
        self.tool()?.metadata(url)
    }

    fn audio_file(&self, url: &str, video_id: &str) -> Result<PathBuf, ResolveError> {
        if let Some(path) = yt_dlp::find_audio(&self.cache_dir, video_id) {
            return Ok(path);
        }
        self.tool()?.download_audio(url, video_id, &self.cache_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "gming_tool_resolver_{}_{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn rejects_non_youtube_links_without_touching_the_network() {
        let dir = temp_dir("reject");
        let resolver = YtDlpResolver::new(dir.join("audio"), dir.join("bin"));

        assert!(matches!(
            resolver.metadata("just some text"),
            Err(ResolveError::NotYouTube)
        ));
    }

    #[test]
    fn serves_already_cached_audio_without_invoking_yt_dlp() {
        let dir = temp_dir("cached");
        let cache = dir.join("audio");
        std::fs::create_dir_all(&cache).expect("create cache");
        std::fs::write(cache.join("dQw4w9WgXcQ.m4a"), b"audio bytes").expect("write cache file");

        let resolver = YtDlpResolver::new(&cache, dir.join("bin"));
        let path = resolver
            .audio_file("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ")
            .expect("cached file");

        assert_eq!(path, cache.join("dQw4w9WgXcQ.m4a"));
    }
}
