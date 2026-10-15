import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetTextIndex,
  readTextIndex,
  textIndexFor,
  writeTextIndex,
} from '../src/pdf/index-cache';
import type { PdfDocumentInfo } from '../src/pdf/library';

const document: PdfDocumentInfo = {
  path: 'rulebook.pdf',
  name: 'rulebook',
  size: 4096,
  modified: 1700000000,
  kind: 'pdf',
};

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
});

describe('the extracted text cache', () => {
  it('has nothing before anything is read', async () => {
    expect(await readTextIndex(document, factory)).toBeNull();
  });

  it('gives back the pages it was given', async () => {
    await writeTextIndex(textIndexFor(document, ['grappling', 'spells']), factory);

    const stored = await readTextIndex(document, factory);

    expect(stored?.pages).toEqual(['grappling', 'spells']);
  });

  it('ignores text from a file that has changed size', async () => {
    await writeTextIndex(textIndexFor(document, ['grappling']), factory);

    const edited = { ...document, size: document.size + 1 };

    expect(await readTextIndex(edited, factory)).toBeNull();
  });

  it('ignores text from a file that has been replaced', async () => {
    await writeTextIndex(textIndexFor(document, ['grappling']), factory);

    const replaced = { ...document, modified: document.modified + 1 };

    expect(await readTextIndex(replaced, factory)).toBeNull();
  });

  it('forgets text on request', async () => {
    await writeTextIndex(textIndexFor(document, ['grappling']), factory);

    await forgetTextIndex(document.path, factory);

    expect(await readTextIndex(document, factory)).toBeNull();
  });

  it('treats the document, not the caller, as the key', async () => {
    await writeTextIndex(textIndexFor(document, ['grappling']), factory);

    const other = { ...document, path: 'adventure.pdf' };

    expect(await readTextIndex(other, factory)).toBeNull();
  });
});
