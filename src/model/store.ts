//! Saving and loading the whole document.
//!
//! The document is stored as a single human-readable JSON blob under one
//! `localStorage` key — the same shape the Rust build wrote to `save.json`, so
//! an export from either can be imported by the other. Nothing here is ever
//! sent anywhere: the app talks to no server but the one serving its own files.

import { newSaveData, parseSaveData, type SaveData } from './types';

/** The `localStorage` key holding the current document. */
export const SAVE_KEY = 'gming_tool.save';

/** Where an unreadable document is preserved before a fresh one is started. */
export const BACKUP_KEY = 'gming_tool.save.bak';

/** How long the app waits after the last edit before writing. */
export const AUTOSAVE_DELAY_MS = 1000;

/** The slice of the `Storage` interface this module needs (easy to fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadResult {
  data: SaveData;
  /** Set when something had to be recovered or was out of date. */
  notice?: string;
}

export function serializeDocument(data: SaveData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Load the document, or a fresh one if nothing is stored yet.
 *
 * Unreadable data is copied to [`BACKUP_KEY`] rather than discarded, so a bad
 * write never destroys the user's saved data.
 */
export function loadDocument(storage: StorageLike = window.localStorage): LoadResult {
  let stored: string | null = null;
  try {
    stored = storage.getItem(SAVE_KEY);
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). The app still
    // works, it just cannot remember anything.
    return { data: newSaveData(), notice: 'this browser does not allow local storage, so changes cannot be saved' };
  }

  if (stored === null) {
    return { data: newSaveData() };
  }

  try {
    return { data: parseSaveData(stored) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      storage.setItem(BACKUP_KEY, stored);
      storage.removeItem(SAVE_KEY);
    } catch {
      // If the backup fails there is nothing better to do than carry on.
    }
    return {
      data: newSaveData(),
      notice: `the saved data could not be read (${reason}); a copy was kept and a fresh library started`,
    };
  }
}

export function saveDocument(data: SaveData, storage: StorageLike = window.localStorage): void {
  storage.setItem(SAVE_KEY, serializeDocument(data));
}

/** Trigger a download of the document as a portable `.json` file. */
export function downloadDocument(data: SaveData, filename = 'gming_tool-save.json'): void {
  const blob = new Blob([serializeDocument(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export interface Autosaver {
  /** Note that the document changed; write once things go quiet. */
  schedule(): void;
  /** Write immediately if a write is pending. */
  flush(): void;
}

/**
 * Debounce writes so typing a paragraph costs one write, not one per keystroke.
 */
export function createAutosaver(
  write: () => void,
  delay: number = AUTOSAVE_DELAY_MS,
): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(): void {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        write();
      }, delay);
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        write();
      }
    },
  };
}
