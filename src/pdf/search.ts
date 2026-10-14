//! Finding a phrase in extracted page text.
//!
//! Pure string work, deliberately separate from pdf.js so it can be tested on
//! its own and so the search stays instant once the text is cached.

/** How much text is shown either side of a hit. */
export const SNIPPET_CONTEXT = 54;

/** How many hits a single document contributes before we stop. */
export const MAX_MATCHES_PER_DOCUMENT = 40;

export interface PdfMatch {
  /** 1-based page number. */
  page: number;
  snippet: string;
  /** Where the hit sits inside `snippet`, so it can be emphasised. */
  snippetMatchStart: number;
  snippetMatchEnd: number;
  /** Where the hit sits in the page text. */
  offset: number;
}

/**
 * Fold text into a comparable form: drop soft hyphens, expand ligatures and
 * other compatibility characters, and collapse all whitespace.
 *
 * PDF text arrives with line breaks in the middle of sentences, so collapsing
 * whitespace is what makes phrase search work across a line wrap.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\u00ad/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Snippet {
  snippet: string;
  snippetMatchStart: number;
  snippetMatchEnd: number;
}

export function snippetAround(text: string, at: number, length: number): Snippet {
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + length + SNIPPET_CONTEXT);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const matchStart = prefix.length + (at - start);

  return {
    snippet,
    snippetMatchStart: matchStart,
    snippetMatchEnd: matchStart + length,
  };
}

/** Every hit for `query` across `pages`, capped at `limit`. */
export function searchPages(
  pages: readonly string[],
  query: string,
  limit: number = MAX_MATCHES_PER_DOCUMENT,
): PdfMatch[] {
  const needle = normalizeText(query).toLowerCase();
  if (needle === '' || limit <= 0) {
    return [];
  }

  const matches: PdfMatch[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const text = pages[index] ?? '';
    if (text === '') {
      continue;
    }

    const haystack = text.toLowerCase();
    let from = 0;

    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) {
        break;
      }

      matches.push({
        page: index + 1,
        offset: at,
        ...snippetAround(text, at, needle.length),
      });

      if (matches.length >= limit) {
        return matches;
      }
      from = at + needle.length;
    }
  }

  return matches;
}

/** True when any page carries text, i.e. the document is not just scans. */
export function hasTextLayer(pages: readonly string[]): boolean {
  return pages.some((page) => page.trim() !== '');
}
