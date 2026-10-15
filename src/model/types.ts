//! Data model: the music library.
//!
//! The story used to live here too. It is now made of documents that sit in the
//! reference folder and are read in place, so all that is left to save is music.
//! The save format carries a `schema_version` so older files keep importing: a
//! legacy `story` section is simply ignored.
//!
//! Deliberately free of UI and persistence concerns; `store` handles saving and
//! loading.

/** The save format version this build writes and understands. */
export const CURRENT_SCHEMA_VERSION = 2;

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
  music: MusicLibrary;
}

/** Raised when save data cannot be understood. */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
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

/** A fresh document: no music. */
export function newSaveData(): SaveData {
  return { schema_version: CURRENT_SCHEMA_VERSION, music: emptyLibrary() };
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
 * A missing `schema_version` means "current", a missing `music` section means
 * "no tracks", and a legacy `story` section (from before documents replaced
 * chapters) is ignored rather than refused. Anything newer than this build
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
    music: { tracks, next_id: nextTrackId },
  };
}
