import { describe, expect, it } from 'vitest';
import type { PdfDocumentInfo } from '../src/pdf/library';
import type { TextIndex } from '../src/pdf/index-cache';
import {
  MAX_TOTAL_MATCHES,
  searchLibrary,
  type SearchLibraryDeps,
} from '../src/pdf/searchLibrary';

const rulebook: PdfDocumentInfo = {
  path: 'rulebook.pdf',
  name: 'rulebook',
  size: 100,
  modified: 1,
};

const adventure: PdfDocumentInfo = {
  path: 'adventure.pdf',
  name: 'adventure',
  size: 200,
  modified: 2,
};

/** Fake dependencies: an in-memory cache and an extractor that counts its use. */
function harness(textByUrl: Record<string, string[]>) {
  const cache = new Map<string, TextIndex>();
  const extracted: string[] = [];

  const deps: SearchLibraryDeps = {
    readIndex: async (document) => {
      // The real cache drops an entry whose file has changed; the fake has to
      // honour the same contract, or it would hide a stale read.
      const found = cache.get(document.path);
      if (
        found === undefined ||
        found.size !== document.size ||
        found.modified !== document.modified
      ) {
        return null;
      }
      return found;
    },
    writeIndex: async (index) => {
      cache.set(index.path, index);
    },
    extract: async (source) => {
      const url = 'url' in source ? source.url : '(data)';
      extracted.push(url);
      return textByUrl[url] ?? [];
    },
  };

  return { deps, extracted, cache };
}

describe('searching the shelf', () => {
  it('reports which document and page a hit came from', async () => {
    const { deps } = harness({
      '/pdfs/rulebook.pdf': ['The grapple rules', 'Spell lists'],
      '/pdfs/adventure.pdf': ['A grapple in the dark'],
    });

    const found = await searchLibrary([rulebook, adventure], 'grapple', { deps });

    expect(found.matches.map((match) => [match.document.name, match.page])).toEqual([
      ['rulebook', 1],
      ['adventure', 1],
    ]);
    expect(found.searched).toBe(2);
  });

  it('reads a document once and then answers from the cache', async () => {
    const { deps, extracted } = harness({ '/pdfs/rulebook.pdf': ['The grapple rules'] });

    await searchLibrary([rulebook], 'grapple', { deps });
    const again = await searchLibrary([rulebook], 'grapple', { deps });

    expect(extracted).toEqual(['/pdfs/rulebook.pdf']);
    expect(again.matches).toHaveLength(1);
  });

  it('reads a document again once the file has changed', async () => {
    const { deps, extracted } = harness({ '/pdfs/rulebook.pdf': ['The grapple rules'] });

    await searchLibrary([rulebook], 'grapple', { deps });
    await searchLibrary([{ ...rulebook, size: rulebook.size + 1 }], 'grapple', { deps });

    expect(extracted).toHaveLength(2);
  });

  it('does no work at all for an empty query', async () => {
    const { deps, extracted } = harness({ '/pdfs/rulebook.pdf': ['The grapple rules'] });

    const found = await searchLibrary([rulebook], '   ', { deps });

    expect(found.matches).toEqual([]);
    expect(extracted).toEqual([]);
  });

  it('says which documents are scans with nothing to search', async () => {
    const { deps } = harness({ '/pdfs/rulebook.pdf': ['', ''] });

    const found = await searchLibrary([rulebook], 'grapple', { deps });

    expect(found.matches).toEqual([]);
    expect(found.withoutText.map((document) => document.name)).toEqual(['rulebook']);
    expect(found.searched).toBe(0);
  });

  it('carries on past a document it cannot read', async () => {
    const { deps } = harness({ '/pdfs/adventure.pdf': ['A grapple in the dark'] });
    const failing: SearchLibraryDeps = {
      ...deps,
      extract: async (source) => {
        if ('url' in source && source.url.includes('rulebook')) {
          throw new Error('this PDF is damaged');
        }
        return deps.extract(source);
      },
    };

    const found = await searchLibrary([rulebook, adventure], 'grapple', { deps: failing });

    expect(found.failed.map((document) => document.name)).toEqual(['rulebook']);
    expect(found.matches.map((match) => match.document.name)).toEqual(['adventure']);
  });

  it('stops as soon as it is superseded', async () => {
    const { deps, extracted } = harness({ '/pdfs/rulebook.pdf': ['The grapple rules'] });

    const found = await searchLibrary([rulebook, adventure], 'grapple', {
      deps,
      isCancelled: () => true,
    });

    expect(found.matches).toEqual([]);
    expect(extracted).toEqual([]);
  });

  it('will not flood the panel with a word that appears everywhere', async () => {
    const shelf = Array.from({ length: 5 }, (_unused, index) => ({
      ...rulebook,
      path: `book-${index}.pdf`,
      name: `book-${index}`,
    }));
    const pages = Array.from({ length: 60 }, () => 'grapple grapple grapple');
    const { deps } = harness(
      Object.fromEntries(shelf.map((document) => [`/pdfs/${document.path}`, pages])),
    );

    const found = await searchLibrary(shelf, 'grapple', { deps });

    expect(found.matches).toHaveLength(MAX_TOTAL_MATCHES);
  });
});
