//! Data model: the story chapters and the music library.
//!
//! Deliberately free of UI, audio and persistence concerns; [`store`] handles
//! saving and loading.

pub mod store;

use serde::{Deserialize, Serialize};

/// Stable identifier for a [`Chapter`].
///
/// Using an id rather than a `Vec` index means a chapter stays selected
/// correctly even if chapters are inserted or removed in the future.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChapterId(u64);

/// A single story chapter with its own text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub id: ChapterId,
    /// Display name, e.g. `"Chapter 1"`. Stored so it can be renamed later.
    pub title: String,
    /// The chapter's story text.
    pub text: String,
}

/// The full story: an ordered list of chapters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Story {
    chapters: Vec<Chapter>,
    next_id: u64,
}

impl Story {
    /// Create a new story seeded with a single empty chapter.
    pub fn new() -> Self {
        let mut story = Self {
            chapters: Vec::new(),
            next_id: 1,
        };
        story.add_chapter();
        story
    }

    /// Append a new empty chapter and return its id.
    ///
    /// Chapters are auto-named `"Chapter N"`, where `N` increments and never
    /// reuses a value.
    pub fn add_chapter(&mut self) -> ChapterId {
        let id = ChapterId(self.next_id);
        self.next_id += 1;
        self.chapters.push(Chapter {
            id,
            title: format!("Chapter {}", id.0),
            text: String::new(),
        });
        id
    }

    /// All chapters, in order.
    pub fn chapters(&self) -> &[Chapter] {
        &self.chapters
    }

    /// Mutable access to a chapter by id.
    pub fn chapter_mut(&mut self, id: ChapterId) -> Option<&mut Chapter> {
        self.chapters.iter_mut().find(|c| c.id == id)
    }
}

impl Default for Story {
    fn default() -> Self {
        Self::new()
    }
}

/// Stable identifier for a [`Track`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TrackId(u64);

/// A single piece of music, referenced by its YouTube URL.
///
/// Note that no local file path is stored: audio lives in a per-machine cache
/// that is re-populated on demand, so saves stay portable between operating
/// systems.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    /// Display title, filled in from the video once it is resolved.
    pub title: String,
    /// The YouTube URL as pasted by the user.
    pub url: String,
}

/// The music library: an ordered list of tracks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicLibrary {
    tracks: Vec<Track>,
    next_id: u64,
}

impl MusicLibrary {
    /// Create an empty library.
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            next_id: 1,
        }
    }

    /// Append a track and return its id.
    pub fn add_track(&mut self, url: impl Into<String>, title: impl Into<String>) -> TrackId {
        let id = TrackId(self.next_id);
        self.next_id += 1;
        self.tracks.push(Track {
            id,
            title: title.into(),
            url: url.into(),
        });
        id
    }

    /// All tracks, in order.
    pub fn tracks(&self) -> &[Track] {
        &self.tracks
    }

    /// Find a track's URL by id.
    pub fn url_of(&self, id: TrackId) -> Option<&str> {
        self.tracks
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.url.as_str())
    }

    /// Rename a track. Returns `false` if the id is unknown.
    pub fn set_title(&mut self, id: TrackId, title: impl Into<String>) -> bool {
        match self.tracks.iter_mut().find(|t| t.id == id) {
            Some(track) => {
                track.title = title.into();
                true
            }
            None => false,
        }
    }

    /// Remove a track, returning it if it was present.
    pub fn remove_track(&mut self, id: TrackId) -> Option<Track> {
        let index = self.tracks.iter().position(|t| t.id == id)?;
        Some(self.tracks.remove(index))
    }
}

impl Default for MusicLibrary {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(story: &Story, id: ChapterId) -> &str {
        story
            .chapters()
            .iter()
            .find(|c| c.id == id)
            .expect("chapter exists")
            .text
            .as_str()
    }

    #[test]
    fn new_seeds_exactly_one_chapter() {
        let story = Story::new();
        assert_eq!(story.chapters().len(), 1);
        assert_eq!(story.chapters()[0].title, "Chapter 1");
    }

    #[test]
    fn add_chapter_yields_unique_ids_in_order() {
        let mut story = Story::new();
        let first = story.chapters()[0].id;
        let second = story.add_chapter();
        let third = story.add_chapter();

        assert_ne!(first, second);
        assert_ne!(second, third);
        assert_eq!(story.chapters().len(), 3);
        assert_eq!(story.chapters()[2].title, "Chapter 3");
    }

    #[test]
    fn chapter_mut_targets_the_right_chapter() {
        let mut story = Story::new();
        let second = story.add_chapter();

        story.chapter_mut(second).unwrap().text = "second text".to_owned();

        let first_id = story.chapters()[0].id;
        assert_eq!(text_of(&story, first_id), "");
        assert_eq!(text_of(&story, second), "second text");
    }

    #[test]
    fn chapter_text_is_independent_per_chapter() {
        let mut story = Story::new();
        let first = story.chapters()[0].id;
        let second = story.add_chapter();

        story.chapter_mut(first).unwrap().text = "one".to_owned();
        story.chapter_mut(second).unwrap().text = "two".to_owned();

        assert_eq!(text_of(&story, first), "one");
        assert_eq!(text_of(&story, second), "two");
    }

    #[test]
    fn default_is_equivalent_to_new() {
        assert_eq!(Story::default().chapters().len(), 1);
    }

    #[test]
    fn new_library_is_empty() {
        assert!(MusicLibrary::new().tracks().is_empty());
        assert!(MusicLibrary::default().tracks().is_empty());
    }

    #[test]
    fn tracks_keep_their_own_url_and_title() {
        let mut library = MusicLibrary::new();
        let first = library.add_track("https://youtu.be/aaa", "First");
        let second = library.add_track("https://youtu.be/bbb", "Second");

        assert_eq!(library.url_of(first), Some("https://youtu.be/aaa"));
        assert_eq!(library.url_of(second), Some("https://youtu.be/bbb"));

        assert!(library.set_title(second, "Renamed"));
        assert_eq!(library.tracks()[1].title, "Renamed");
        assert!(!library.set_title(TrackId(999), "nope"));
    }

    #[test]
    fn removing_a_track_leaves_the_others_untouched() {
        let mut library = MusicLibrary::new();
        let first = library.add_track("url-a", "A");
        let second = library.add_track("url-b", "B");

        let removed = library.remove_track(first).expect("track existed");
        assert_eq!(removed.title, "A");
        assert_eq!(library.tracks().len(), 1);
        assert_eq!(library.tracks()[0].id, second);
        assert!(library.remove_track(first).is_none());
    }
}
