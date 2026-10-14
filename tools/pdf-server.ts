//! Serving a folder of reference PDFs from the launcher's own static server.
//!
//! This is not an application backend: it hands out files that are already in a
//! folder on disk, plus a listing of what that folder contains, so the app can
//! show a reference shelf without the browser ever needing filesystem access.
//!
//! Two routes are served under `/pdfs`:
//!
//! - `GET /pdfs/index.json` — what is in the folder, for the shelf listing.
//! - `GET /pdfs/<relative path>` — the file itself, with byte ranges so a large
//!   rulebook can be streamed and seeked instead of downloaded whole.

import { createReadStream, promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

/** Folder used when `PDF_DIR` is not set. */
export const DEFAULT_FOLDER_NAME = 'pdfs';

/** Upper bound on the shelf, so a huge folder cannot swamp the panel. */
export const MAX_DOCUMENTS = 500;

const MAX_DEPTH = 4;
const ROUTE = '/pdfs/';

export interface PdfDocumentInfo {
  /** Path relative to the reference folder, always with forward slashes. */
  path: string;
  /** File name without its extension, used as the shelf label. */
  name: string;
  /** Size in bytes, used to invalidate cached text. */
  size: number;
  /** Last modification time in epoch milliseconds, likewise. */
  modified: number;
}

export interface PdfListing {
  folder: string;
  documents: PdfDocumentInfo[];
}

/**
 * Work out which folder holds the reference PDFs.
 *
 * `configured` comes from `PDF_DIR`; `~` is expanded so a shell-quoted path
 * still works. Relative paths are resolved against the project root.
 */
export function resolvePdfFolder(root: string, configured?: string): string {
  const wanted = configured?.trim() ?? '';
  if (wanted === '') {
    return resolve(root, DEFAULT_FOLDER_NAME);
  }
  if (wanted === '~') {
    return homedir();
  }
  if (wanted.startsWith('~/')) {
    return resolve(homedir(), wanted.slice(2));
  }
  return resolve(root, wanted);
}

/** True when a requested path stays inside the folder and names a PDF. */
export function isServablePath(folder: string, relative: string): boolean {
  if (relative === '' || !/\.pdf$/i.test(relative) || relative.includes('\0')) {
    return false;
  }
  const root = resolve(folder);
  const target = resolve(root, relative);
  // `resolve` collapses `..`, so a prefix check is enough to stop escapes.
  return target.startsWith(root + sep);
}

/** List every PDF in the folder, newest-agnostic and sorted by path. */
export async function listPdfFiles(folder: string): Promise<PdfDocumentInfo[]> {
  const found: PdfDocumentInfo[] = [];
  await walk(folder, '', 0, found);
  found.sort((left, right) => left.path.localeCompare(right.path));
  return found.slice(0, MAX_DOCUMENTS);
}

async function walk(
  root: string,
  relative: string,
  depth: number,
  out: PdfDocumentInfo[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_DOCUMENTS) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(join(root, relative), { withFileTypes: true });
  } catch {
    // A missing or unreadable folder simply means "nothing to shelve".
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;

    if (entry.isDirectory()) {
      await walk(root, child, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) {
      continue;
    }

    try {
      const stats = await fs.stat(join(root, child));
      out.push({
        path: child,
        name: entry.name.replace(/\.pdf$/i, ''),
        size: stats.size,
        modified: Math.round(stats.mtimeMs),
      });
    } catch {
      // Removed between listing and stat; skip it.
    }
  }
}

/**
 * A connect-style middleware for Vite's dev and preview servers.
 *
 * Anything outside `/pdfs` is passed straight through to Vite.
 */
export function createPdfMiddleware(
  folder: string,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const root = resolve(folder);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const url = req.url ?? '';
    const queryAt = url.indexOf('?');
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt);

    if (!pathname.startsWith(ROUTE)) {
      next();
      return;
    }

    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice(ROUTE.length));
    } catch {
      send(res, 400, 'the path could not be decoded');
      return;
    }

    if (relative === 'index.json') {
      void serveListing(root, res);
      return;
    }

    if (!isServablePath(root, relative)) {
      send(res, 404, 'no such document');
      return;
    }

    void serveFile(resolve(root, relative), req, res);
  };
}

async function serveListing(root: string, res: ServerResponse): Promise<void> {
  let documents: PdfDocumentInfo[] = [];
  try {
    documents = await listPdfFiles(root);
  } catch {
    documents = [];
  }

  const body = JSON.stringify({ folder: root, documents } satisfies PdfListing);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // Dropping a new book into the folder must show up on a refresh.
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

async function serveFile(
  file: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(file);
  } catch {
    send(res, 404, 'no such document');
    return;
  }

  if (!stats.isFile()) {
    send(res, 404, 'no such document');
    return;
  }

  const etag = `"${stats.size}-${Math.round(stats.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.setHeader('etag', etag);
    res.end();
    return;
  }

  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('etag', etag);
  // Revalidate rather than cache hard, so replacing a file is noticed.
  res.setHeader('cache-control', 'no-cache');

  const range = parseRange(req.headers.range, stats.size);
  if (range !== null) {
    const { start, end } = range;
    res.statusCode = 206;
    res.setHeader('content-range', `bytes ${start}-${end}/${stats.size}`);
    res.setHeader('content-length', String(end - start + 1));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-length', String(stats.size));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/** Parse a single-range `Range` header; unsupported forms fall back to a full body. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (header === undefined || size === 0) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') {
    return null;
  }

  let start: number;
  let end: number;

  if (rawStart === '') {
    const wanted = Number(rawEnd);
    if (!Number.isFinite(wanted) || wanted <= 0) {
      return null;
    }
    start = Math.max(0, size - wanted);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }

  return { start, end };
}

function send(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(`${message}\n`);
}

/** The label used for a file name, without its extension. */
export function documentName(fileName: string): string {
  return basename(fileName).replace(/\.pdf$/i, '');
}
