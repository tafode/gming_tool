//! Pulling the text layer out of a PDF with pdf.js.
//!
//! pdf.js is only used for text, never for rendering: the document itself is
//! shown by the browser's own viewer. The import is dynamic, so nothing of
//! pdf.js loads until the first search.

import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { normalizeText } from './search';

export interface ExtractionProgress {
  page: number;
  total: number;
}

/** Thrown when a caller asks to stop part-way through a long document. */
export class ExtractionCancelled extends Error {
  constructor() {
    super('text extraction was cancelled');
    this.name = 'ExtractionCancelled';
  }
}

export type PdfSource = { url: string } | { data: Uint8Array };

/** How many pages are read before yielding to the browser. */
const PAGES_PER_BREATH = 8;

/**
 * Extract each page's text, in order.
 *
 * Long books are read in small batches with a yield between them, so the panel
 * stays responsive and progress can be shown. `isCancelled` is checked between
 * pages so a new search can abandon the previous one.
 */
export async function extractPageText(
  source: PdfSource,
  onProgress?: (progress: ExtractionProgress) => void,
  isCancelled?: () => boolean,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // In the browser nothing has set this yet, so point pdf.js at the worker that
  // ships with the app. In Node pdf.js already defaults to a specifier it can
  // resolve, and that must be left alone.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }

  const task = pdfjs.getDocument(source);
  const document = await task.promise;

  try {
    const pages: string[] = [];

    for (let number = 1; number <= document.numPages; number += 1) {
      if (isCancelled?.()) {
        throw new ExtractionCancelled();
      }

      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');

      pages.push(normalizeText(text));
      onProgress?.({ page: number, total: document.numPages });

      if (number % PAGES_PER_BREATH === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return pages;
  } finally {
    // The loading task owns the worker that holds the document, so destroying
    // the task releases both.
    await task.destroy();
  }
}
