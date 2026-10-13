//! Turning a YouTube URL into metadata and a local audio file.

use std::path::PathBuf;

use thiserror::Error;

use super::video_id_from_url;

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

/// A resolver that needs no network and downloads nothing.
///
/// It derives the video id from the URL and pretends the audio is cached under
/// `cache_dir`. Used as a placeholder until the real `yt-dlp` backend exists,
/// and as a stand-in in tests.
#[derive(Debug, Clone)]
pub struct PlaceholderResolver {
    cache_dir: PathBuf,
}

impl PlaceholderResolver {
    pub fn new(cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            cache_dir: cache_dir.into(),
        }
    }
}

impl Resolver for PlaceholderResolver {
    fn metadata(&self, url: &str) -> Result<TrackMetadata, ResolveError> {
        let video_id = video_id_from_url(url).ok_or(ResolveError::NotYouTube)?;
        Ok(TrackMetadata {
            title: video_id.clone(),
            video_id,
        })
    }

    fn audio_file(&self, _url: &str, video_id: &str) -> Result<PathBuf, ResolveError> {
        Ok(self.cache_dir.join(format!("{video_id}.m4a")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_derives_the_id_and_a_cache_path() {
        let resolver = PlaceholderResolver::new("/cache/audio");
        let meta = resolver
            .metadata("https://youtu.be/dQw4w9WgXcQ")
            .expect("valid link");
        assert_eq!(meta.video_id, "dQw4w9WgXcQ");
        assert_eq!(meta.title, "dQw4w9WgXcQ");

        let path = resolver
            .audio_file("https://youtu.be/dQw4w9WgXcQ", &meta.video_id)
            .expect("path");
        assert_eq!(path, PathBuf::from("/cache/audio/dQw4w9WgXcQ.m4a"));
    }

    #[test]
    fn placeholder_rejects_unrecognised_links() {
        let resolver = PlaceholderResolver::new("/cache");
        assert!(matches!(
            resolver.metadata("just some text"),
            Err(ResolveError::NotYouTube)
        ));
    }
}
