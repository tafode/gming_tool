//! Remembering which page of each document was last being read.
//!
//! Deliberately kept out of the save document, so exports stay small and the
//! save schema is untouched.

import type { StorageLike } from '../model/store';

const PAGES_KEY = 'gming_tool.reference.pages';

export type LastPages = Record<string, number>;

export function loadLastPages(storage: StorageLike = window.localStorage): LastPages {
  try {
    const stored = storage.getItem(PAGES_KEY);
    if (stored === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const pages: LastPages = {};
    for (const [path, page] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof page === 'number' && Number.isFinite(page) && page >= 1) {
        pages[path] = Math.floor(page);
      }
    }
    return pages;
  } catch {
    return {};
  }
}

/** Record the page being read and return the updated map. */
export function rememberLastPage(
  pages: LastPages,
  path: string,
  page: number,
  storage: StorageLike = window.localStorage,
): LastPages {
  const updated = { ...pages, [path]: page };
  try {
    storage.setItem(PAGES_KEY, JSON.stringify(updated));
  } catch {
    // Nothing to do; the page is simply not remembered next time.
  }
  return updated;
}
