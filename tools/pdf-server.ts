//! Serving the reference folder from the launcher's own static server.
//!
//! This is not an application backend: it hands out documents that are already
//! in a folder on disk, plus a listing of what that folder contains, so the app
//! can show a reference shelf without the browser ever needing filesystem
//! access.
//!
//! PDFs are served as they are. Word (`.docx`) and OpenDocument (`.odt`) files
//! are converted to PDF on demand with LibreOffice, cached, and then served the
//! same way — so the app's viewer and its text search work on every document
//! without knowing the original format was not PDF.
//!
//! Two routes are served under `/pdfs`:
//!
//! - `GET /pdfs/index.json` — what is in the folder, for the shelf listing.
//! - `GET /pdfs/<relative path>` — a document, with byte ranges so a large
//!   rulebook can be streamed and seeked instead of downloaded whole. An office
//!   document answers with `content-type: application/pdf` and the converted
//!   bytes.

import { createReadStream, promises as fs } from 'node:fs';
import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Folder used when `PDF_DIR` (or `DOC_DIR`) is not set. */
export const DEFAULT_FOLDER_NAME = 'pdfs';

/** Upper bound on the shelf, so a huge folder cannot swamp the panel. */
export const MAX_DOCUMENTS = 500;

/** Where converted PDFs are cached when no folder is given. */
export const CONVERT_CACHE_DIR = 'gming-documents';

/** How long a single LibreOffice conversion may take before it is given up on. */
const CONVERT_TIMEOUT_MS = 120_000;

const MAX_DEPTH = 4;
const ROUTE = '/pdfs/';

/** The kinds of document the shelf can hold. */
export type DocumentKind = 'pdf' | 'office';

export interface PdfDocumentInfo {
  /** Path relative to the reference folder, always with forward slashes. */
  path: string;
  /** File name without its extension, used as the shelf label. */
  name: string;
  /** Size in bytes, used to invalidate cached text. */
  size: number;
  /** Last modification time in epoch milliseconds, likewise. */
  modified: number;
  /** `pdf` for a PDF, `office` for a `.docx`/`.odt` that is converted on demand. */
  kind: DocumentKind;
}

export interface PdfListing {
  folder: string;
  documents: PdfDocumentInfo[];
  /** The converter that was found, or `null` when office files cannot be read. */
  converter: string | null;
}

/** Raised when an office document cannot be turned into a PDF. */
export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

/**
 * Work out which folder holds the reference documents.
 *
 * `configured` comes from `PDF_DIR`/`DOC_DIR`; `~` is expanded so a shell-quoted
 * path still works. Relative paths are resolved against the project root.
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

/** The office format a file name names, or `null` for anything else. */
export function officeKind(fileName: string): 'docx' | 'odt' | null {
  if (/\.docx$/i.test(fileName)) {
    return 'docx';
  }
  if (/\.odt$/i.test(fileName)) {
    return 'odt';
  }
  return null;
}

/** `office` when the document must be converted to be read, `pdf` otherwise. */
export function documentKind(fileName: string): DocumentKind {
  return officeKind(fileName) === null ? 'pdf' : 'office';
}

/** True when a requested path stays inside the folder and names a document. */
export function isServablePath(folder: string, relative: string): boolean {
  if (relative === '' || relative.includes('\0') || !/\.(pdf|docx|odt)$/i.test(relative)) {
    return false;
  }
  const root = resolve(folder);
  const target = resolve(root, relative);
  // `resolve` collapses `..`, so a prefix check is enough to stop escapes.
  return target.startsWith(root + sep);
}

/** List every document in the folder, sorted by path. */
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
    if (!entry.isFile() || !/\.(pdf|docx|odt)$/i.test(entry.name)) {
      continue;
    }

    try {
      const stats = await fs.stat(join(root, child));
      out.push({
        path: child,
        name: withoutDocumentExtension(entry.name),
        size: stats.size,
        modified: Math.round(stats.mtimeMs),
        kind: documentKind(entry.name),
      });
    } catch {
      // Removed between listing and stat; skip it.
    }
  }
}

/** The label used for a file name, without its extension. */
export function documentName(fileName: string): string {
  return withoutDocumentExtension(basename(fileName));
}

function withoutDocumentExtension(fileName: string): string {
  return fileName.replace(/\.(pdf|docx|odt)$/i, '');
}

/** A file name with any extension replaced by `.pdf`. */
export function withPdfExtension(fileName: string): string {
  return `${fileName.replace(/\.[^./\\]+$/, '')}.pdf`;
}

// --- converting office documents ------------------------------------------

/**
 * Find a LibreOffice binary on `PATH` without starting it.
 *
 * A missing converter is not an error in itself: it only means office documents
 * cannot be read, while PDFs still can.
 */
export function findConverterInPath(pathValue: string = process.env.PATH ?? ''): string | null {
  const names =
    process.platform === 'win32'
      ? ['soffice.exe', 'soffice', 'libreoffice.exe', 'libreoffice']
      : ['soffice', 'libreoffice'];

  for (const name of names) {
    for (const dir of pathValue.split(delimiter)) {
      if (dir === '') {
        continue;
      }
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.F_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

/** Where converted PDFs are cached, one folder per reference folder. */
export function defaultCacheDir(folder: string): string {
  const key = createHash('sha1').update(resolve(folder)).digest('hex').slice(0, 12);
  return join(tmpdir(), CONVERT_CACHE_DIR, key);
}

/**
 * The cache path for a converted document.
 *
 * The source file's size and modification time are part of the name, so editing
 * a document quietly maps to a fresh cache file: a stale conversion can never be
 * served.
 */
export function convertedCachePath(
  cacheDir: string,
  relative: string,
  size: number,
  modified: number,
): string {
  const stamp = createHash('sha1')
    .update(`${relative}\u0000${size}\u0000${modified}`)
    .digest('hex')
    .slice(0, 16);
  return join(cacheDir, `${relative.replace(/[/\\]/g, '__')}.${stamp}.pdf`);
}

/**
 * Convert one document to PDF with LibreOffice.
 *
 * A throwaway user profile is used so a running LibreOffice window (or another
 * conversion) cannot lock this one out.
 */
export async function convertWithSoffice(
  binary: string,
  source: string,
  outDir: string,
): Promise<void> {
  const profile = await fs.mkdtemp(join(tmpdir(), 'gming-soffice-'));
  try {
    await execFileAsync(
      binary,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        source,
      ],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
  } catch (cause) {
    const detail = errorDetail(cause) || 'the converter reported no reason';
    throw new ConversionError(`could not convert ${basename(source)}: ${detail}`);
  } finally {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

function errorDetail(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    const withStderr = cause as { stderr?: unknown; message?: unknown };
    if (typeof withStderr.stderr === 'string' && withStderr.stderr.trim() !== '') {
      return withStderr.stderr.trim().split('\n').slice(-1)[0] ?? '';
    }
    if (typeof withStderr.message === 'string') {
      return withStderr.message;
    }
  }
  return '';
}

// Conversions are serialised: LibreOffice is heavy, and running many at once
// gains nothing on a single-user machine.
let conversionChain: Promise<unknown> = Promise.resolve();

function enqueueConversion<T>(task: () => Promise<T>): Promise<T> {
  const run = conversionChain.then(task, task);
  conversionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Conversions in progress, so two requests for the same file share one job. */
const inFlight = new Map<string, Promise<string>>();

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** The cached PDF for a document, converting it first if it is not there yet. */
async function ensureConverted(
  source: string,
  cacheDir: string,
  relative: string,
  size: number,
  modified: number,
  binary: string,
  convert: (source: string, outDir: string, binary: string) => Promise<void>,
): Promise<string> {
  const target = convertedCachePath(cacheDir, relative, size, modified);
  if (await fileExists(target)) {
    return target;
  }

  const running = inFlight.get(target);
  if (running !== undefined) {
    return running;
  }

  const job = (async () => {
    // Another request may have finished while this one queued behind it.
    if (await fileExists(target)) {
      return target;
    }

    const staging = await fs.mkdtemp(join(tmpdir(), 'gming-convert-'));
    try {
      await enqueueConversion(() => convert(source, staging, binary));

      const produced = join(staging, withPdfExtension(basename(source)));
      if (!(await fileExists(produced))) {
        throw new ConversionError(`LibreOffice produced no PDF for ${basename(source)}`);
      }

      await fs.mkdir(cacheDir, { recursive: true });
      try {
        await fs.rename(produced, target);
      } catch {
        // The staging folder and the cache can be on different filesystems.
        await fs.copyFile(produced, target);
      }
      return target;
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  })();

  inFlight.set(target, job);
  try {
    return await job;
  } finally {
    inFlight.delete(target);
  }
}

// --- the middleware --------------------------------------------------------

export interface PdfMiddlewareOptions {
  /** Folder converted PDFs are cached in. Defaults under the OS temp folder. */
  cacheDir?: string;
  /** Override the conversion step, for tests. */
  convert?: (source: string, outDir: string, binary: string) => Promise<void>;
  /** Override converter detection, for tests. */
  detectConverter?: () => Promise<string | null>;
}

/**
 * A connect-style middleware for Vite's dev and preview servers.
 *
 * Anything outside `/pdfs` is passed straight through to Vite.
 */
export function createPdfMiddleware(
  folder: string,
  options: PdfMiddlewareOptions = {},
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const root = resolve(folder);
  const cacheDir = options.cacheDir ?? defaultCacheDir(root);
  const detect = options.detectConverter ?? (async () => findConverterInPath());
  const convert =
    options.convert ?? ((source, outDir, binary) => convertWithSoffice(binary, source, outDir));
  const hasConvertOverride = options.convert !== undefined;

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
      void serveListing(root, res, detect);
      return;
    }

    if (!isServablePath(root, relative)) {
      send(res, 404, 'no such document');
      return;
    }

    const source = resolve(root, relative);

    if (officeKind(relative) !== null) {
      void serveConverted(source, relative, cacheDir, req, res, {
        detect,
        convert,
        hasConvertOverride,
      });
      return;
    }

    void serveFile(source, req, res);
  };
}

interface ConversionContext {
  detect: () => Promise<string | null>;
  convert: (source: string, outDir: string, binary: string) => Promise<void>;
  hasConvertOverride: boolean;
}

async function serveConverted(
  source: string,
  relative: string,
  cacheDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  context: ConversionContext,
): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(source);
  } catch {
    send(res, 404, 'no such document');
    return;
  }

  if (!stats.isFile()) {
    send(res, 404, 'no such document');
    return;
  }

  let binary = 'soffice';
  if (!context.hasConvertOverride) {
    const found = await context.detect();
    if (found === null) {
      send(
        res,
        503,
        'this is a Word or OpenDocument file, and no converter was found — install LibreOffice to read it',
      );
      return;
    }
    binary = found;
  }

  let target: string;
  try {
    target = await ensureConverted(
      source,
      cacheDir,
      relative,
      stats.size,
      Math.round(stats.mtimeMs),
      binary,
      context.convert,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    send(res, 500, reason);
    return;
  }

  await serveFile(target, req, res);
}

async function serveListing(
  root: string,
  res: ServerResponse,
  detect: () => Promise<string | null>,
): Promise<void> {
  let documents: PdfDocumentInfo[] = [];
  try {
    documents = await listPdfFiles(root);
  } catch {
    documents = [];
  }

  const converter = await detect();
  const body = JSON.stringify({ folder: root, documents, converter } satisfies PdfListing);
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
