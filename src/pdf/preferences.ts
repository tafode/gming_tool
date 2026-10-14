//! Remembering how the reference drawer was left: its size, and which page of
//! each document was last being read.
//!
//! Deliberately kept out of the story document, so exports stay small and the
//! save schema is untouched.

import type { StorageLike } from '../model/store';

const LAYOUT_KEY = 'gming_tool.reference.layout';
const PAGES_KEY = 'gming_tool.reference.pages';

export interface ReferenceLayout {
  open: boolean;
  height: number;
}

export const DEFAULT_REFERENCE_LAYOUT: ReferenceLayout = { open: false, height: 380 };

export const MIN_REFERENCE_HEIGHT = 140;

/** The drawer never takes more than this share of the window. */
export const MAX_REFERENCE_FRACTION = 0.8;

export function clampReferenceHeight(
  height: number,
  viewport: number = window.innerHeight,
): number {
  if (!Number.isFinite(height)) {
    return DEFAULT_REFERENCE_LAYOUT.height;
  }
  const ceiling = Math.max(MIN_REFERENCE_HEIGHT, Math.round(viewport * MAX_REFERENCE_FRACTION));
  return Math.min(Math.max(Math.round(height), MIN_REFERENCE_HEIGHT), ceiling);
}

export function loadReferenceLayout(
  storage: StorageLike = window.localStorage,
): ReferenceLayout {
  try {
    const stored = storage.getItem(LAYOUT_KEY);
    if (stored === null) {
      return DEFAULT_REFERENCE_LAYOUT;
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_REFERENCE_LAYOUT;
    }
    const layout = parsed as Partial<ReferenceLayout>;
    return {
      open: layout.open === true,
      height: clampReferenceHeight(
        typeof layout.height === 'number' ? layout.height : DEFAULT_REFERENCE_LAYOUT.height,
      ),
    };
  } catch {
    return DEFAULT_REFERENCE_LAYOUT;
  }
}

export function saveReferenceLayout(
  layout: ReferenceLayout,
  storage: StorageLike = window.localStorage,
): void {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A drawer that cannot remember its size is not worth complaining about.
  }
}

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
