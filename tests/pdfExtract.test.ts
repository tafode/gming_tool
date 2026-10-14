// @vitest-environment node
//
// pdf.js only runs in Node for these tests; the same code path runs in the
// browser, but there is no browser here to read a real PDF with.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtractionCancelled, extractPageText } from '../src/pdf/extract';
import { buildTextPdf } from './fixtures/buildPdf';

const realWarn = console.warn;

beforeAll(() => {
  // The fixture uses a bare standard font with no embedded data, so pdf.js warns
  // that it cannot measure glyph widths. Text extraction does not need them, so
  // that one warning is dropped while any other warning still gets through.
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('standardFontDataUrl')) {
      return;
    }
    realWarn(...args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('reading text out of a PDF', () => {
  it('reads every page, in order', async () => {
    const pages = await extractPageText({
      data: buildTextPdf(['The grappling rules', 'A list of spells']),
    });

    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('grappling');
    expect(pages[1]).toContain('spells');
  });

  it('normalises the text as it goes, so a phrase survives a line break', async () => {
    const pages = await extractPageText({ data: buildTextPdf(['roll a\nd20']) });

    expect(pages[0]).toBe('roll a d20');
  });

  it('reports progress page by page', async () => {
    const seen: number[] = [];

    await extractPageText({ data: buildTextPdf(['one', 'two', 'three']) }, (progress) => {
      seen.push(progress.page);
      expect(progress.total).toBe(3);
    });

    expect(seen).toEqual([1, 2, 3]);
  });

  it('gives up when the caller asks it to', async () => {
    await expect(
      extractPageText({ data: buildTextPdf(['one', 'two']) }, undefined, () => true),
    ).rejects.toBeInstanceOf(ExtractionCancelled);
  });
});
