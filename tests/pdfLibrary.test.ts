import { describe, expect, it } from 'vitest';
import { formatBytes, kindLabel, parseLibrary, pdfUrl, type PdfDocumentInfo } from '../src/pdf/library';

describe('locating a document', () => {
  it('escapes each segment of the path', () => {
    expect(pdfUrl('players-handbook.pdf')).toBe('/pdfs/players-handbook.pdf');
    expect(pdfUrl('books/Players Handbook.pdf')).toBe('/pdfs/books/Players%20Handbook.pdf');
  });
});

describe('labelling a document', () => {
  it('names the office format, and leaves PDFs unlabelled', () => {
    const document = (path: string, kind: PdfDocumentInfo['kind']): PdfDocumentInfo => ({
      path,
      name: path,
      size: 0,
      modified: 0,
      kind,
    });

    expect(kindLabel(document('rulebook.pdf', 'pdf'))).toBeNull();
    expect(kindLabel(document('notes.docx', 'office'))).toBe('Word');
    expect(kindLabel(document('notes.odt', 'office'))).toBe('ODT');
  });
});

describe('reading the folder listing', () => {
  it('keeps well-formed entries and the converter', () => {
    const library = parseLibrary({
      folder: '/home/marco/gming_tool/pdfs',
      converter: 'soffice',
      documents: [{ path: 'rulebook.pdf', name: 'rulebook', size: 1024, modified: 1700000000 }],
    });

    expect(library.folder).toBe('/home/marco/gming_tool/pdfs');
    expect(library.converter).toBe('soffice');
    expect(library.documents).toEqual([
      { path: 'rulebook.pdf', name: 'rulebook', size: 1024, modified: 1700000000, kind: 'pdf' },
    ]);
  });

  it('reads an office document’s kind', () => {
    const library = parseLibrary({
      documents: [{ path: 'notes.docx', name: 'notes', size: 10, modified: 2, kind: 'office' }],
    });

    expect(library.documents[0]?.kind).toBe('office');
    expect(library.converter).toBeNull();
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
    // A missing label, kind and counts fall back to something harmless.
    expect(library.documents[1]).toEqual({
      path: 'adventure.pdf',
      name: 'adventure.pdf',
      size: 0,
      modified: 0,
      kind: 'pdf',
    });
  });

  it('survives a listing that is not a listing at all', () => {
    expect(parseLibrary(undefined)).toEqual({ folder: '', documents: [], converter: null });
    expect(parseLibrary('nonsense')).toEqual({ folder: '', documents: [], converter: null });
    expect(parseLibrary({ documents: 'nonsense' })).toEqual({
      folder: '',
      documents: [],
      converter: null,
    });
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
