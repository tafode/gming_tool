//! Remembering where each track was left off.
//!
//! Playback positions deliberately live outside the save document, under
//! their own `localStorage` key: they are session state rather than library
//! content, so they neither travel with Export nor touch the save schema the
//! old Rust build shares. The map is keyed by YouTube's video id — that is
//! what the player actually plays, so the position survives a track being
//! re-added or removed.
//!
//! Everything here fails soft: a browser that refuses storage simply forgets
//! between reloads, and unreadable data is dropped rather than reported — the
//! music itself is never at risk.

/** The `localStorage` key holding the saved positions. */
export const RESUME_KEY = 'gming_tool.positions';

/** Positions shorter than this are "the start"; they are not worth resuming. */
export const MIN_RESUME_SECONDS = 1;

/** The oldest positions are dropped past this many remembered videos. */
export const MAX_TRACKED_POSITIONS = 200;

/** The slice of the `Storage` interface this module needs (easy to fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ResumeStore {
  /** Where this video was left off, or `null` if nothing is worth resuming. */
  get(videoId: string): number | null;
  /** Remember a position; anything under [`MIN_RESUME_SECONDS`] is forgotten. */
  set(videoId: string, seconds: number): void;
  /** Forget a position (the video finished, or its track was deleted). */
  clear(videoId: string): void;
  /** Every remembered position, as a plain object (for driving the UI). */
  entries(): Record<string, number>;
}

function readPositions(storage: StorageLike): Map<string, number> {
  const positions = new Map<string, number>();
  let stored: string | null = null;
  try {
    stored = storage.getItem(RESUME_KEY);
  } catch {
    // Storage is unavailable; positions are remembered for this session only.
    return positions;
  }
  if (stored === null) {
    return positions;
  }
  try {
    const raw: unknown = JSON.parse(stored);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [videoId, value] of Object.entries(raw)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_RESUME_SECONDS) {
          positions.set(videoId, value);
        }
      }
    }
  } catch {
    // Unreadable positions are simply forgotten.
  }
  return positions;
}

function writePositions(storage: StorageLike, positions: Map<string, number>): void {
  try {
    storage.setItem(RESUME_KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Nothing stored is better than a crash over a resume position.
  }
}

export function createResumeStore(storage: StorageLike = window.localStorage): ResumeStore {
  const positions = readPositions(storage);

  function forget(videoId: string): void {
    if (positions.delete(videoId)) {
      writePositions(storage, positions);
    }
  }

  return {
    get(videoId) {
      return positions.get(videoId) ?? null;
    },

    set(videoId, seconds) {
      if (!Number.isFinite(seconds) || seconds < MIN_RESUME_SECONDS) {
        forget(videoId);
        return;
      }
      // Re-insert so the map's order tracks recency for the pruning below.
      positions.delete(videoId);
      positions.set(videoId, seconds);
      while (positions.size > MAX_TRACKED_POSITIONS) {
        const oldest = positions.keys().next();
        if (oldest.done) {
          break;
        }
        positions.delete(oldest.value);
      }
      writePositions(storage, positions);
    },

    clear: forget,

    entries() {
      return Object.fromEntries(positions);
    },
  };
}
