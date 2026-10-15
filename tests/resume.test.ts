import { describe, expect, it } from 'vitest';
import {
  createResumeStore,
  MAX_TRACKED_POSITIONS,
  MIN_RESUME_SECONDS,
  RESUME_KEY,
  type StorageLike,
} from '../src/player/resume';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const ID = 'dQw4w9WgXcQ';
const OTHER = 'aaaaaaaaaaa';

describe('remembering playback positions', () => {
  it('remembers where a video was left off', () => {
    const storage = new MemoryStorage();
    const resume = createResumeStore(storage);

    expect(resume.get(ID)).toBeNull();

    resume.set(ID, 84.2);

    expect(resume.get(ID)).toBe(84.2);
    expect(JSON.parse(storage.getItem(RESUME_KEY) ?? '{}')).toEqual({ [ID]: 84.2 });
  });

  it('reads positions back after a reload', () => {
    const storage = new MemoryStorage();
    createResumeStore(storage).set(ID, 123);

    expect(createResumeStore(storage).get(ID)).toBe(123);
  });

  it('does not bother with positions at the very start', () => {
    const storage = new MemoryStorage();
    const resume = createResumeStore(storage);

    resume.set(ID, MIN_RESUME_SECONDS - 0.1);
    expect(resume.get(ID)).toBeNull();

    resume.set(ID, 60);
    resume.set(ID, 0);
    expect(resume.get(ID)).toBeNull();
    expect(JSON.parse(storage.getItem(RESUME_KEY) ?? '{}')).toEqual({});
  });

  it('forgets a position when asked to', () => {
    const storage = new MemoryStorage();
    const resume = createResumeStore(storage);

    resume.set(ID, 30);
    resume.clear(ID);

    expect(resume.get(ID)).toBeNull();
    expect(JSON.parse(storage.getItem(RESUME_KEY) ?? '{}')).toEqual({});
  });

  it('lists what it holds, for the track list to show', () => {
    const resume = createResumeStore(new MemoryStorage());

    resume.set(ID, 30);
    resume.set(OTHER, 90);

    expect(resume.entries()).toEqual({ [ID]: 30, [OTHER]: 90 });
  });

  it('ignores nonsense values', () => {
    const resume = createResumeStore(new MemoryStorage());

    resume.set(ID, Number.NaN);
    resume.set(OTHER, Number.POSITIVE_INFINITY);

    expect(resume.entries()).toEqual({});
  });

  it('drops the oldest positions once it has too many', () => {
    const storage = new MemoryStorage();
    const resume = createResumeStore(storage);

    for (let index = 0; index <= MAX_TRACKED_POSITIONS; index += 1) {
      resume.set(`video-${index}`, 60);
    }

    expect(Object.keys(resume.entries())).toHaveLength(MAX_TRACKED_POSITIONS);
    expect(resume.get('video-0')).toBeNull();
    expect(resume.get(`video-${MAX_TRACKED_POSITIONS}`)).toBe(60);
  });

  it('re-uses the freshest slot when a position is updated', () => {
    const resume = createResumeStore(new MemoryStorage());

    resume.set(ID, 60);
    resume.set(OTHER, 60);
    resume.set(ID, 90);
    for (let index = 0; index < MAX_TRACKED_POSITIONS - 1; index += 1) {
      resume.set(`video-${index}`, 60);
    }

    // Being touched last kept it alive, while OTHER fell off the end.
    expect(resume.get(ID)).toBe(90);
    expect(resume.get(OTHER)).toBeNull();
  });

  it('shrugs off unreadable stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(RESUME_KEY, '{ not json');

    const resume = createResumeStore(storage);

    expect(resume.entries()).toEqual({});
    resume.set(ID, 30);
    expect(createResumeStore(storage).get(ID)).toBe(30);
  });

  it('keeps only the values it can trust when reading', () => {
    const storage = new MemoryStorage();
    storage.setItem(RESUME_KEY, JSON.stringify({ [ID]: -5, [OTHER]: 12.5, junk: 'nope' }));

    const resume = createResumeStore(storage);

    expect(resume.get(ID)).toBeNull();
    expect(resume.get(OTHER)).toBe(12.5);
    expect(resume.get('junk')).toBeNull();
  });

  it('copes with storage that refuses to be used', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };

    const resume = createResumeStore(hostile);

    expect(() => resume.set(ID, 30)).not.toThrow();
    expect(resume.get(ID)).toBe(30);
  });
});
