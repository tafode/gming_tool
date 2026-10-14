//! Searching the whole shelf: cache first, extract when needed, then match.
//!
//! Kept separate from any React code and with its dependencies injected, so the
//! caching and cancellation rules can be tested without a browser or pdf.js.

import { extractPageText, type ExtractionProgress, type PdfSource } from './extract';
import { readTextIndex, textIndexFor, writeTextIndex, type TextIndex } from './index-cache';
import { pdfUrl, type PdfDocumentInfo } from './library';
import { hasTextLayer, searchPages } from './search';

/** A hit, together with the document it came from. */
export interface ReferenceMatch {
  document: PdfDocumentInfo;
  page: number;
  snippet: string;
  snippetMatchStart: number;
  snippetMatchEnd: number;
}

export interface IndexingProgress {
  document: PdfDocumentInfo;
  page: number;
  total: number;
}

export interface SearchLibraryDeps {
  readIndex(document: PdfDocumentInfo): Promise<TextIndex | null>;
  writeIndex(index: TextIndex): Promise<void>;
  extract(
    source: PdfSource,
    onProgress?: (progress: ExtractionProgress) => void,
    isCancelled?: () => boolean,
  ): Promise<string[]>;
}

/** The real dependencies: IndexedDB for the cache, pdf.js for extraction. */
export const pdfSearchDeps: SearchLibraryDeps = {
  readIndex: (document) => readTextIndex(document),
  writeIndex: (index) => writeTextIndex(index),
  extract: extractPageText,
};

export interface SearchLibraryOptions {
  deps?: SearchLibraryDeps;
  onProgress?(progress: IndexingProgress): void;
  isCancelled?(): boolean;
}

export interface SearchLibraryResult {
  matches: ReferenceMatch[];
  /** Documents that turned out to be scans, with no text to search. */
  withoutText: PdfDocumentInfo[];
  /** Documents that could not be read at all. */
  failed: PdfDocumentInfo[];
  /** Documents with text that were actually searched. */
  searched: number;
}

/** Ceiling on hits across the shelf, so a common word cannot flood the panel. */
export const MAX_TOTAL_MATCHES = 120;

export async function searchLibrary(
  documents: readonly PdfDocumentInfo[],
  query: string,
  options: SearchLibraryOptions = {},
): Promise<SearchLibraryResult> {
  const deps = options.deps ?? pdfSearchDeps;
  const matches: ReferenceMatch[] = [];
  const withoutText: PdfDocumentInfo[] = [];
  const failed: PdfDocumentInfo[] = [];
  let searched = 0;

  if (query.trim() === '') {
    return { matches, withoutText, failed, searched };
  }

  for (const document of documents) {
    if (options.isCancelled?.() || matches.length >= MAX_TOTAL_MATCHES) {
      break;
    }

    let index = await deps.readIndex(document);

    if (index === null) {
      let pages: string[];
      try {
        pages = await deps.extract(
          { url: pdfUrl(document.path) },
          (progress) =>
            options.onProgress?.({ document, page: progress.page, total: progress.total }),
          options.isCancelled,
        );
      } catch {
        if (options.isCancelled?.()) {
          break;
        }
        // One unreadable file must not cost the whole shelf its search.
        failed.push(document);
        continue;
      }

      index = textIndexFor(document, pages);
      await deps.writeIndex(index);
    }

    if (!hasTextLayer(index.pages)) {
      withoutText.push(document);
      continue;
    }

    searched += 1;

    for (const match of searchPages(index.pages, query)) {
      matches.push({
        document,
        page: match.page,
        snippet: match.snippet,
        snippetMatchStart: match.snippetMatchStart,
        snippetMatchEnd: match.snippetMatchEnd,
      });
      if (matches.length >= MAX_TOTAL_MATCHES) {
        break;
      }
    }
  }

  return { matches, withoutText, failed, searched };
}
