import { describe, expect, it } from 'vitest';
import { hasTextLayer, normalizeText, searchPages, snippetAround } from '../src/pdf/search';

describe('normalising extracted text', () => {
  it('collapses the whitespace pdf.js leaves behind', () => {
    expect(normalizeText('Save   versus\n\nDC 15')).toBe('Save versus DC 15');
  });

  it('repairs soft hyphens and ligatures', () => {
    expect(normalizeText('grace\u00adful')).toBe('graceful');
    expect(normalizeText('the \ufb01re rules')).toBe('the fire rules');
  });
});

describe('excerpts around a hit', () => {
  it('keeps a little context and marks exactly where the hit is', () => {
    const text = `${'a'.repeat(200)} grapple ${'b'.repeat(200)}`;
    const at = text.indexOf('grapple');

    const snippet = snippetAround(text, at, 'grapple'.length);

    expect(snippet.snippet.startsWith('…')).toBe(true);
    expect(snippet.snippet.endsWith('…')).toBe(true);
    expect(snippet.snippet.slice(snippet.snippetMatchStart, snippet.snippetMatchEnd)).toBe(
      'grapple',
    );
  });

  it('leaves short text alone', () => {
    const snippet = snippetAround('roll a d20 now', 7, 3);
    expect(snippet.snippet).toBe('roll a d20 now');
    expect(snippet.snippet.slice(snippet.snippetMatchStart, snippet.snippetMatchEnd)).toBe('d20');
  });
});

describe('searching page text', () => {
  const pages = ['The grapple rules are on the next page', '', 'To grapple, roll a d20'];

  it('finds hits case-insensitively and reports the page they are on', () => {
    const hits = searchPages(pages, 'GRAPPLE');

    expect(hits.map((hit) => hit.page)).toEqual([1, 3]);
    expect(hits[0].snippet).toContain('grapple rules');
  });

  it('emphasises exactly the text that matched', () => {
    const hits = searchPages(pages, 'd20');

    expect(hits).toHaveLength(1);
    expect(hits[0].snippet.slice(hits[0].snippetMatchStart, hits[0].snippetMatchEnd)).toBe('d20');
  });

  it('finds a phrase that a line break had split', () => {
    // Stored pages have already been through normaliseText, which is what makes
    // a phrase search work across the line wrap.
    const stored = [normalizeText('roll a\nd20 for initiative')];

    expect(searchPages(stored, 'roll a d20')).toHaveLength(1);
  });

  it('finds every hit on a page', () => {
    expect(searchPages(['grapple grapple grapple'], 'grapple')).toHaveLength(3);
  });

  it('stops at the limit', () => {
    expect(searchPages(['grapple grapple grapple'], 'grapple', 2)).toHaveLength(2);
  });

  it('finds nothing for an empty query', () => {
    expect(searchPages(pages, '   ')).toEqual([]);
  });

  it('skips pages that carry no text of their own', () => {
    expect(searchPages(['', '   '], 'grapple')).toEqual([]);
  });
});

describe('telling text from scans', () => {
  it('asks whether any page carries text', () => {
    expect(hasTextLayer(['', '  '])).toBe(false);
    expect(hasTextLayer(['', 'a rule'])).toBe(true);
  });
});
