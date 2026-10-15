import { describe, expect, it } from 'vitest';
import {
  addTrack,
  CURRENT_SCHEMA_VERSION,
  emptyLibrary,
  newSaveData,
  parseSaveData,
  removeTrack,
  SaveFormatError,
  setTrackTitle,
} from '../src/model/types';

describe('the music library', () => {
  it('adds, renames and removes tracks', () => {
    const added = addTrack(emptyLibrary(), 'https://youtu.be/aaa', 'aaa');
    const withSecond = addTrack(added.library, 'https://youtu.be/bbb', 'bbb');

    expect(withSecond.library.tracks).toHaveLength(2);
    expect(withSecond.library.tracks[0]?.url).toBe('https://youtu.be/aaa');

    const renamed = setTrackTitle(withSecond.library, withSecond.id, 'Tavern');
    expect(renamed.tracks[1]?.title).toBe('Tavern');

    const trimmed = removeTrack(renamed, added.id);
    expect(trimmed.tracks).toHaveLength(1);
    expect(trimmed.tracks[0]?.title).toBe('Tavern');
  });

  it('ignores removing an unknown track', () => {
    const library = addTrack(emptyLibrary(), 'https://youtu.be/aaa', 'aaa').library;
    expect(removeTrack(library, 999).tracks).toHaveLength(1);
  });
});

describe('reading save data', () => {
  it('round-trips a document that this build wrote', () => {
    const data = newSaveData();
    const withMusic = { ...data, music: addTrack(data.music, 'https://youtu.be/abc', 'abc').library };

    const parsed = parseSaveData(JSON.stringify(withMusic));

    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.music.tracks[0]?.url).toBe('https://youtu.be/abc');
  });

  it('accepts a save from before documents replaced chapters, ignoring the story', () => {
    const rustSave = `{
      "schema_version": 1,
      "story": { "chapters": [{ "id": 1, "title": "Chapter 1", "text": "hi" }], "next_id": 2 },
      "music": { "tracks": [{ "id": 1, "title": "Tavern", "url": "https://youtu.be/abc" }], "next_id": 2 }
    }`;

    const parsed = parseSaveData(rustSave);

    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.music.tracks[0]?.title).toBe('Tavern');
    // The old story is gone; only music survives.
    expect(parsed).not.toHaveProperty('story');
  });

  it('loads a save that predates the music feature', () => {
    const parsed = parseSaveData(
      '{"schema_version":1,"story":{"chapters":[{"id":1,"title":"Chapter 1","text":"hi"}],"next_id":2}}',
    );

    expect(parsed.music.tracks).toEqual([]);
    expect(parsed.music.next_id).toBe(1);
  });

  it('assumes the current version when the field is missing', () => {
    const parsed = parseSaveData('{"music":{"tracks":[],"next_id":1}}');
    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('refuses a version it does not understand', () => {
    const future = '{"schema_version":999,"music":{"tracks":[],"next_id":1}}';
    expect(() => parseSaveData(future)).toThrow(/schema version 999/);
  });

  it('reports malformed input rather than throwing something opaque', () => {
    expect(() => parseSaveData('{ not json')).toThrow(SaveFormatError);
    expect(() => parseSaveData('[]')).toThrow(/not a JSON object/);
  });

  it('repairs a missing next_id from the ids it can see', () => {
    const parsed = parseSaveData(
      '{"music":{"tracks":[{"id":4,"title":"x","url":"y"}]}}',
    );

    expect(parsed.music.next_id).toBe(5);
  });
});
