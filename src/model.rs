//! Story data model: chapters and their text.
//!
//! Deliberately free of any UI or persistence concerns so it stays easy to
//! test and easy to serialize later.

/// Stable identifier for a [`Chapter`].
///
/// Using an id rather than a `Vec` index means a chapter stays selected
/// correctly even if chapters are inserted or removed in the future.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ChapterId(u64);

/// A single story chapter with its own text.
#[derive(Debug, Clone)]
pub struct Chapter {
    pub id: ChapterId,
    /// Display name, e.g. `"Chapter 1"`. Stored so it can be renamed later.
    pub title: String,
    /// The chapter's story text.
    pub text: String,
}

/// The full story: an ordered list of chapters.
#[derive(Debug)]
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
}
