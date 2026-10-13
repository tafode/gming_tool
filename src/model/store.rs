//! Saving and loading the whole document as a single JSON file.
//!
//! The file is human-readable and diff-friendly so it can be moved between
//! machines, and it carries a `schema_version` so older saves can be migrated
//! forward as the format evolves.

use std::path::{Path, PathBuf};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use super::{MusicLibrary, Story};

/// The save format version this build writes and understands.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Everything that gets persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveData {
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,
    pub story: Story,
    /// Defaulted so saves written before the music feature still load.
    #[serde(default)]
    pub music: MusicLibrary,
}

impl SaveData {
    /// A fresh document: one empty chapter, no music.
    pub fn new() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            story: Story::new(),
            music: MusicLibrary::new(),
        }
    }
}

impl Default for SaveData {
    fn default() -> Self {
        Self::new()
    }
}

fn current_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

/// Errors that can occur while loading or saving.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("no per-user data directory is available on this platform")]
    NoAppDir,
    #[error("could not read or write the save file: {0}")]
    Io(#[from] std::io::Error),
    #[error("the save file is not valid JSON: {0}")]
    Parse(#[from] serde_json::Error),
    #[error(
        "the save file uses schema version {found}, but this build only supports up to {supported}"
    )]
    UnsupportedVersion { found: u32, supported: u32 },
}

/// Per-user directories for saves and cached audio.
#[derive(Debug, Clone)]
pub struct AppDirs {
    data_dir: PathBuf,
    cache_dir: PathBuf,
}

impl AppDirs {
    /// Resolve the platform-appropriate directories.
    pub fn resolve() -> Result<Self, StoreError> {
        let dirs = ProjectDirs::from("", "", "gming_tool").ok_or(StoreError::NoAppDir)?;
        Ok(Self {
            data_dir: dirs.data_dir().to_path_buf(),
            cache_dir: dirs.cache_dir().to_path_buf(),
        })
    }

    /// Where the save file lives.
    pub fn save_file(&self) -> PathBuf {
        self.data_dir.join("save.json")
    }

    /// Where downloaded audio is cached.
    pub fn audio_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("audio")
    }

    /// Where helper binaries the app downloads for itself (currently yt-dlp)
    /// live.
    ///
    /// This is under the data directory rather than the cache directory: the
    /// tool is small but awkward to re-fetch, and caches may be cleared by the
    /// system at any time.
    pub fn tools_dir(&self) -> PathBuf {
        self.data_dir.join("bin")
    }
}

/// Write `data` to `path` atomically (write to a temp file, then rename).
pub fn save(path: &Path, data: &SaveData) -> Result<(), StoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    // Same directory, so the final rename is atomic.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Load `path`, or `None` if it does not exist yet.
pub fn load(path: &Path) -> Result<Option<SaveData>, StoreError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let data: SaveData = serde_json::from_str(&text)?;
    Ok(Some(migrate(data)?))
}

/// Move an unreadable save file aside so the app can start fresh without
/// destroying whatever the user had.
pub fn backup(path: &Path) -> std::io::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let backup = path.with_extension("json.bak");
    std::fs::rename(path, &backup)?;
    Ok(Some(backup))
}

/// Bring an older document up to [`CURRENT_SCHEMA_VERSION`].
fn migrate(mut data: SaveData) -> Result<SaveData, StoreError> {
    if data.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(StoreError::UnsupportedVersion {
            found: data.schema_version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }
    // No older versions exist yet. When they do, upgrade them here, in order.
    data.schema_version = CURRENT_SCHEMA_VERSION;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("gming_tool_store_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn round_trips_story_and_music() {
        let dir = temp_dir("round_trip");
        let path = dir.join("save.json");

        let mut data = SaveData::new();
        let first_chapter = data.story.chapters()[0].id;
        data.story.chapter_mut(first_chapter).unwrap().text = "Once upon a time".to_owned();
        let track = data.music.add_track("https://youtu.be/abc", "Tavern");
        data.music.set_title(track, "Tavern Ambience");

        save(&path, &data).expect("save");
        let loaded = load(&path).expect("load").expect("file exists");

        assert_eq!(loaded.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(loaded.story.chapters()[0].text, "Once upon a time");
        assert_eq!(loaded.music.tracks().len(), 1);
        assert_eq!(loaded.music.tracks()[0].title, "Tavern Ambience");
        assert_eq!(loaded.music.tracks()[0].url, "https://youtu.be/abc");
    }

    #[test]
    fn loading_a_missing_file_is_not_an_error() {
        let dir = temp_dir("missing");
        assert!(load(&dir.join("nope.json")).expect("load").is_none());
    }

    #[test]
    fn a_save_without_music_still_loads() {
        let dir = temp_dir("old_save");
        let path = dir.join("save.json");
        std::fs::write(
            &path,
            r#"{"schema_version":1,"story":{"chapters":[{"id":1,"title":"Chapter 1","text":"hi"}],"next_id":2}}"#,
        )
        .expect("write");

        let loaded = load(&path).expect("load").expect("file exists");
        assert_eq!(loaded.story.chapters()[0].text, "hi");
        assert!(loaded.music.tracks().is_empty());
    }

    #[test]
    fn future_schema_versions_are_rejected() {
        let dir = temp_dir("future");
        let path = dir.join("save.json");
        std::fs::write(
            &path,
            r#"{"schema_version":999,"story":{"chapters":[],"next_id":1},"music":{"tracks":[],"next_id":1}}"#,
        )
        .expect("write");

        match load(&path) {
            Err(StoreError::UnsupportedVersion { found, supported }) => {
                assert_eq!(found, 999);
                assert_eq!(supported, CURRENT_SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[test]
    fn invalid_json_is_reported() {
        let dir = temp_dir("invalid");
        let path = dir.join("save.json");
        std::fs::write(&path, "{ this is not json").expect("write");
        assert!(matches!(load(&path), Err(StoreError::Parse(_))));
    }

    #[test]
    fn backup_moves_the_file_aside() {
        let dir = temp_dir("backup");
        let path = dir.join("save.json");
        std::fs::write(&path, "broken").expect("write");

        let moved = backup(&path).expect("backup").expect("file existed");
        assert_eq!(moved, dir.join("save.json.bak"));
        assert!(!path.exists());
        assert!(moved.exists());
    }

    #[test]
    fn saving_creates_missing_directories() {
        let dir = temp_dir("nested");
        let path = dir.join("deep").join("nested").join("save.json");
        save(&path, &SaveData::new()).expect("save");
        assert!(path.exists());
    }
}
