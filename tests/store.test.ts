import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DELAY_MS,
  BACKUP_KEY,
  createAutosaver,
  loadDocument,
  SAVE_KEY,
  saveDocument,
  serializeDocument,
  type StorageLike,
} from '../src/model/store';
import { addTrack, newSaveData } from '../src/model/types';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('loading a document', () => {
  it('starts fresh when nothing is stored', () => {
    const storage = new MemoryStorage();
    const { data, notice } = loadDocument(storage);

    expect(notice).toBeUndefined();
    expect(data.music.tracks).toEqual([]);
  });

  it('reads back what was saved', () => {
    const storage = new MemoryStorage();
    const data = newSaveData();
    const withTrack = {
      ...data,
      music: addTrack(data.music, 'https://youtu.be/abc', 'abc').library,
    };

    saveDocument(withTrack, storage);
    const { data: loaded } = loadDocument(storage);

    expect(loaded.music.tracks[0]?.url).toBe('https://youtu.be/abc');
  });

  it('keeps unreadable data aside instead of destroying it', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{ this is not json');

    const { data, notice } = loadDocument(storage);

    expect(notice).toMatch(/could not be read/);
    expect(data.music.tracks).toEqual([]);
    expect(storage.getItem(BACKUP_KEY)).toBe('{ this is not json');
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it('copes with storage that refuses to be read', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {},
      removeItem() {},
    };

    const { data, notice } = loadDocument(hostile);

    expect(data.music.tracks).toEqual([]);
    expect(notice).toMatch(/does not allow local storage/);
  });

  it('writes readable JSON', () => {
    const text = serializeDocument(newSaveData());
    expect(text).toContain('"schema_version": 2');
    expect(JSON.parse(text).music.tracks).toEqual([]);
  });
});

describe('the autosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes once after edits stop', () => {
    const write = vi.fn();
    const autosaver = createAutosaver(write);

    autosaver.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS / 2);
    autosaver.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS / 2);

    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flushes straight away when asked', () => {
    const write = vi.fn();
    const autosaver = createAutosaver(write);

    autosaver.schedule();
    autosaver.flush();

    expect(write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing pending', () => {
    const write = vi.fn();
    createAutosaver(write).flush();
    expect(write).not.toHaveBeenCalled();
  });
});
