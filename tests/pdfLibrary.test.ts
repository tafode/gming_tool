import { describe, expect, it } from 'vitest';
import { formatBytes, parseLibrary, pdfUrl } from '../src/pdf/library';

describe('locating a document', () => {
  it('escapes each segment of the path', () => {
    expect(pdfUrl('players-handbook.pdf')).toBe('/pdfs/players-handbook.pdf');
    expect(pdfUrl('books/Players Handbook.pdf')).toBe('/pdfs/books/Players%20Handbook.pdf');
  });
});

describe('reading the folder listing', () => {
  it('keeps well-formed entries', () => {
    const library = parseLibrary({
      folder: '/home/marco/gming_tool/pdfs',
      documents: [{ path: 'rulebook.pdf', name: 'rulebook', size: 1024, modified: 1700000000 }],
    });

    expect(library.folder).toBe('/home/marco/gming_tool/pdfs');
    expect(library.documents).toEqual([
      { path: 'rulebook.pdf', name: 'rulebook', size: 1024, modified: 1700000000 },
    ]);
  });

  it('drops odd entries rather than blanking the shelf', () => {
    const library = parseLibrary({
      documents: [
        { path: 'rulebook.pdf', name: 'rulebook', size: 1024, modified: 1700000000 },
        { path: '' },
        'nonsense',
        null,
        { path: 'adventure.pdf' },
      ],
    });

    expect(library.documents.map((document) => document.path)).toEqual([
      'rulebook.pdf',
      'adventure.pdf',
    ]);
    // A missing label and counts fall back to something harmless.
    expect(library.documents[1]).toEqual({
      path: 'adventure.pdf',
      name: 'adventure.pdf',
      size: 0,
      modified: 0,
    });
  });

  it('survives a listing that is not a listing at all', () => {
    expect(parseLibrary(undefined)).toEqual({ folder: '', documents: [] });
    expect(parseLibrary('nonsense')).toEqual({ folder: '', documents: [] });
    expect(parseLibrary({ documents: 'nonsense' })).toEqual({ folder: '', documents: [] });
  });
});

describe('labelling sizes', () => {
  it('rounds to something readable', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4404019)).toBe('4.2 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
