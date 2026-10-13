//! Data model: the story chapters and the music library.
//!
//! Deliberately free of UI and persistence concerns; `store` handles saving and
//! loading. The shapes here are byte-for-byte compatible with the JSON the
//! original Rust build wrote, so existing `save.json` files import unchanged.

/** The save format version this build writes and understands. */
export const CURRENT_SCHEMA_VERSION = 1;

export interface Chapter {
  id: number;
  /** Display name, e.g. `"Chapter 1"`. Stored so it can be renamed later. */
  title: string;
  /** The chapter's story text. */
  text: string;
}

export interface Story {
  chapters: Chapter[];
  next_id: number;
}

/** A single piece of music, referenced by its YouTube URL. */
export interface Track {
  id: number;
  /** Display title, filled in from oEmbed or the player once known. */
  title: string;
  /** The YouTube URL as pasted by the user. */
  url: string;
}

export interface MusicLibrary {
  tracks: Track[];
  next_id: number;
}

/** Everything that gets persisted. */
export interface SaveData {
  schema_version: number;
  story: Story;
  music: MusicLibrary;
}

/** Raised when save data cannot be understood. */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

function addChapterTo(story: Story): { story: Story; id: number } {
  const chapter: Chapter = {
    id: story.next_id,
    title: `Chapter ${story.next_id}`,
    text: '',
  };
  return {
    story: { chapters: [...story.chapters, chapter], next_id: story.next_id + 1 },
    id: chapter.id,
  };
}

/** Append a new empty chapter. Chapters are auto-named `"Chapter N"`. */
export function addChapter(story: Story): { story: Story; id: number } {
  return addChapterTo(story);
}

/** A fresh story seeded with a single empty chapter. */
export function newStory(): Story {
  return addChapterTo({ chapters: [], next_id: 1 }).story;
}

export function setChapterText(story: Story, id: number, text: string): Story {
  return {
    ...story,
    chapters: story.chapters.map((chapter) => (chapter.id === id ? { ...chapter, text } : chapter)),
  };
}

/** Create an empty library. */
export function emptyLibrary(): MusicLibrary {
  return { tracks: [], next_id: 1 };
}

/** Append a track and return the new library plus the track id. */
export function addTrack(
  library: MusicLibrary,
  url: string,
  title: string,
): { library: MusicLibrary; id: number } {
  const track: Track = { id: library.next_id, title, url };
  return {
    library: { tracks: [...library.tracks, track], next_id: library.next_id + 1 },
    id: track.id,
  };
}

/** Remove a track, leaving the others untouched. Removing an unknown id is a no-op. */
export function removeTrack(library: MusicLibrary, id: number): MusicLibrary {
  return { ...library, tracks: library.tracks.filter((track) => track.id !== id) };
}

export function setTrackTitle(library: MusicLibrary, id: number, title: string): MusicLibrary {
  return {
    ...library,
    tracks: library.tracks.map((track) => (track.id === id ? { ...track, title } : track)),
  };
}

/** A fresh document: one empty chapter, no music. */
export function newSaveData(): SaveData {
  return { schema_version: CURRENT_SCHEMA_VERSION, story: newStory(), music: emptyLibrary() };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parse and validate save data, bringing older documents forward.
 *
 * Mirrors the Rust loader: a missing `schema_version` means "current", a missing
 * `music` section means "no tracks", and anything newer than this build
 * understands is refused rather than silently mangled.
 */
export function parseSaveData(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveFormatError('the saved data is not valid JSON');
  }

  const root = asRecord(raw);
  if (!root) {
    throw new SaveFormatError('the saved data is not a JSON object');
  }

  const version = asNumber(root.schema_version, CURRENT_SCHEMA_VERSION);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new SaveFormatError(
      `the save file uses schema version ${version}, but this build only supports up to ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  const storyRaw = asRecord(root.story);
  if (!storyRaw) {
    throw new SaveFormatError('the saved data has no story');
  }
  if (!Array.isArray(storyRaw.chapters)) {
    throw new SaveFormatError('the story has no list of chapters');
  }

  const chapters: Chapter[] = storyRaw.chapters.map((entry, index) => {
    const chapter = asRecord(entry);
    if (!chapter) {
      throw new SaveFormatError(`chapter ${index + 1} is not an object`);
    }
    const id = asNumber(chapter.id, index + 1);
    return {
      id,
      title: asString(chapter.title, `Chapter ${id}`),
      text: asString(chapter.text, ''),
    };
  });

  const nextChapterId = Math.max(
    asNumber(storyRaw.next_id, 0),
    ...chapters.map((chapter) => chapter.id + 1),
    1,
  );

  // Older saves predate the music feature, so a missing section is not an error.
  const musicRaw = asRecord(root.music) ?? {};
  const tracksRaw = Array.isArray(musicRaw.tracks) ? musicRaw.tracks : [];
  const tracks: Track[] = tracksRaw.map((entry, index) => {
    const track = asRecord(entry);
    if (!track) {
      throw new SaveFormatError(`track ${index + 1} is not an object`);
    }
    const id = asNumber(track.id, index + 1);
    return {
      id,
      title: asString(track.title, ''),
      url: asString(track.url, ''),
    };
  });

  const nextTrackId = Math.max(
    asNumber(musicRaw.next_id, 0),
    ...tracks.map((track) => track.id + 1),
    1,
  );

  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    story: { chapters, next_id: nextChapterId },
    music: { tracks, next_id: nextTrackId },
  };
}
