import { describe, expect, it } from 'vitest';
import {
  addChapter,
  addTrack,
  CURRENT_SCHEMA_VERSION,
  emptyLibrary,
  newSaveData,
  newStory,
  parseSaveData,
  removeTrack,
  SaveFormatError,
  setChapterText,
  setTrackTitle,
} from '../src/model/types';

describe('the story', () => {
  it('is seeded with a single chapter', () => {
    const story = newStory();
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]?.title).toBe('Chapter 1');
    expect(story.next_id).toBe(2);
  });

  it('numbers new chapters and keeps the ids unique', () => {
    const first = newStory();
    const second = addChapter(first);
    const third = addChapter(second.story);

    expect(second.story.chapters[1]?.title).toBe('Chapter 2');
    expect(third.story.chapters[2]?.title).toBe('Chapter 3');
    expect(new Set(third.story.chapters.map((chapter) => chapter.id)).size).toBe(3);
  });

  it('keeps each chapter’s text independent', () => {
    const story = addChapter(newStory()).story;
    const [first, second] = story.chapters;

    const edited = setChapterText(setChapterText(story, first!.id, 'one'), second!.id, 'two');

    expect(edited.chapters[0]?.text).toBe('one');
    expect(edited.chapters[1]?.text).toBe('two');
  });
});

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
    const withText = {
      ...data,
      story: setChapterText(data.story, data.story.chapters[0]!.id, 'Once upon a time'),
      music: addTrack(data.music, 'https://youtu.be/abc', 'abc').library,
    };

    const parsed = parseSaveData(JSON.stringify(withText));

    expect(parsed.story.chapters[0]?.text).toBe('Once upon a time');
    expect(parsed.music.tracks[0]?.url).toBe('https://youtu.be/abc');
  });

  it('accepts the exact shape the previous Rust build wrote', () => {
    const rustSave = `{
      "schema_version": 1,
      "story": { "chapters": [{ "id": 1, "title": "Chapter 1", "text": "hi" }], "next_id": 2 },
      "music": { "tracks": [{ "id": 1, "title": "Tavern", "url": "https://youtu.be/abc" }], "next_id": 2 }
    }`;

    const parsed = parseSaveData(rustSave);

    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.story.chapters[0]?.text).toBe('hi');
    expect(parsed.music.tracks[0]?.title).toBe('Tavern');
  });

  it('loads a save that predates the music feature', () => {
    const parsed = parseSaveData(
      '{"schema_version":1,"story":{"chapters":[{"id":1,"title":"Chapter 1","text":"hi"}],"next_id":2}}',
    );

    expect(parsed.story.chapters[0]?.text).toBe('hi');
    expect(parsed.music.tracks).toEqual([]);
    expect(parsed.music.next_id).toBe(1);
  });

  it('assumes the current version when the field is missing', () => {
    const parsed = parseSaveData('{"story":{"chapters":[],"next_id":1}}');
    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('refuses a version it does not understand', () => {
    const future = '{"schema_version":999,"story":{"chapters":[],"next_id":1},"music":{"tracks":[],"next_id":1}}';
    expect(() => parseSaveData(future)).toThrow(/schema version 999/);
  });

  it('reports malformed input rather than throwing something opaque', () => {
    expect(() => parseSaveData('{ not json')).toThrow(SaveFormatError);
    expect(() => parseSaveData('[]')).toThrow(/not a JSON object/);
    expect(() => parseSaveData('{"story":{}}')).toThrow(/no list of chapters/);
  });

  it('repairs a missing next_id from the ids it can see', () => {
    const parsed = parseSaveData(
      '{"story":{"chapters":[{"id":7,"title":"Chapter 7","text":""}]},"music":{"tracks":[{"id":4,"title":"x","url":"y"}]}}',
    );

    expect(parsed.story.next_id).toBe(8);
    expect(parsed.music.next_id).toBe(5);
  });
});
