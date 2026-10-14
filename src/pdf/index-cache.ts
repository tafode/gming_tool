//! A cache of extracted PDF text, kept in IndexedDB.
//!
//! Extracting the text layer of a 400-page rulebook takes a moment, so it is
//! done once and kept. An entry is tied to the file's size and modification time,
//! so replacing a document on disk quietly discards its stale text.

import type { PdfDocumentInfo } from './library';

const DB_NAME = 'gming_tool.reference';
const DB_VERSION = 1;
const STORE = 'text';

export interface TextIndex {
  /** Key: the document's path within the reference folder. */
  path: string;
  size: number;
  modified: number;
  /** Whitespace-normalised text, one entry per page, in page order. */
  pages: string[];
  indexedAt: number;
}

const connections = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the text index failed'));
  });
}

function connection(factory: IDBFactory): Promise<IDBDatabase> {
  const existing = connections.get(factory);
  if (existing) {
    return existing;
  }

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('the text index could not be opened'));
  });

  connections.set(factory, opening);
  opening.catch(() => connections.delete(factory));
  return opening;
}

/** The cached text for a document, or `null` if there is none or it is stale. */
export async function readTextIndex(
  document: PdfDocumentInfo,
  factory: IDBFactory = indexedDB,
): Promise<TextIndex | null> {
  try {
    const db = await connection(factory);
    const found = await promisify<TextIndex | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(document.path),
    );

    if (!found || found.size !== document.size || found.modified !== document.modified) {
      return null;
    }
    return { ...found, pages: Array.isArray(found.pages) ? found.pages : [] };
  } catch {
    // A cache that cannot be read is simply a cache miss.
    return null;
  }
}

export async function writeTextIndex(
  index: TextIndex,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  try {
    const db = await connection(factory);
    await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put(index));
  } catch {
    // Losing the cache only costs time later.
  }
}

export async function forgetTextIndex(
  path: string,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  try {
    const db = await connection(factory);
    await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(path));
  } catch {
    // Nothing to do; the entry is already gone as far as anyone can tell.
  }
}

/** Build a cache entry for a document. */
export function textIndexFor(document: PdfDocumentInfo, pages: string[]): TextIndex {
  return {
    path: document.path,
    size: document.size,
    modified: document.modified,
    pages,
    indexedAt: Date.now(),
  };
}
