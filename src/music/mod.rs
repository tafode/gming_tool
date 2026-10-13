//! Music playback: turning YouTube URLs into locally playable audio.
//!
//! The UI talks to the two traits defined here ([`output::AudioOutput`] and
//! [`resolver::Resolver`]) rather than to any concrete implementation, which
//! keeps the panel testable without an audio device or network access.

pub mod output;
pub mod resolver;

/// Best-effort extraction of the video id from a YouTube URL.
///
/// Handles `youtu.be/ID`, `watch?v=ID`, `music.youtube.com`, `shorts`, `embed`
/// and `live` links. Returns `None` for anything unrecognised.
pub fn video_id_from_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    let candidates = ["youtu.be/", "shorts/", "embed/", "live/"];
    for marker in candidates {
        if let Some(rest) = url.split(marker).nth(1) {
            let id = rest
                .split(['?', '&', '/', '#'])
                .next()
                .unwrap_or_default()
                .trim();
            if !id.is_empty() {
                return Some(id.to_owned());
            }
        }
    }

    if let Some(rest) = url.split("v=").nth(1) {
        let id = rest
            .split(['&', '?', '/', '#'])
            .next()
            .unwrap_or_default()
            .trim();
        if !id.is_empty() {
            return Some(id.to_owned());
        }
    }

    // A bare video id, e.g. "dQw4w9WgXcQ".
    if !url.contains('/') && !url.contains('.') && url.len() == 11 {
        return Some(url.to_owned());
    }

    None
}

/// A friendly title to show until the real one has been fetched.
pub fn placeholder_title(url: &str) -> String {
    video_id_from_url(url).unwrap_or_else(|| url.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_ids_from_common_url_shapes() {
        let cases = [
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            (
                "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
                "dQw4w9WgXcQ",
            ),
            (
                "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                "dQw4w9WgXcQ",
            ),
            ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
            ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ];
        for (url, expected) in cases {
            assert_eq!(video_id_from_url(url).as_deref(), Some(expected), "{url}");
        }
    }

    #[test]
    fn rejects_things_that_are_not_youtube_links() {
        assert_eq!(video_id_from_url(""), None);
        assert_eq!(video_id_from_url("   "), None);
        assert_eq!(video_id_from_url("not a link"), None);
        assert_eq!(video_id_from_url("https://example.com/watch"), None);
    }

    #[test]
    fn placeholder_title_falls_back_to_the_raw_url() {
        assert_eq!(placeholder_title("https://youtu.be/abc123"), "abc123");
        assert_eq!(placeholder_title("  weird  "), "weird");
    }
}
