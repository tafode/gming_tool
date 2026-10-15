//! The reference shelf: what the launcher found in the documents folder.
//!
//! The browser is told this by the server that serves the app, so the app never
//! needs filesystem access of its own.

/** Where the server publishes the folder listing. */
export const PDF_LIST_URL = '/pdfs/index.json';

/** Prefix every document is served under. */
export const PDF_ROUTE = '/pdfs/';

/** `pdf` for a PDF, `office` for a `.docx`/`.odt` the server converts for us. */
export type DocumentKind = 'pdf' | 'office';

export interface PdfDocumentInfo {
  /** Path relative to the reference folder, always with forward slashes. */
  path: string;
  /** Label for the shelf, without the extension. */
  name: string;
  /** Size in bytes; also used to tell whether cached text is still valid. */
  size: number;
  /** Last modification time in epoch milliseconds, likewise. */
  modified: number;
  /** Whether the document is a PDF or has to be converted before it can be read. */
  kind: DocumentKind;
}

export interface PdfLibrary {
  /** Absolute path of the folder, shown when it is empty. */
  folder: string;
  documents: PdfDocumentInfo[];
  /** The document converter the server found, or `null` if it found none. */
  converter: string | null;
}

/**
 * The URL a document is served from, escaping each path segment.
 *
 * An office document is served as a PDF by the server, so this one URL works
 * for the viewer and for text extraction alike.
 */
export function pdfUrl(path: string): string {
  const encoded = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
  return PDF_ROUTE + encoded;
}

/** A short label for an office document's format, or `null` for a PDF. */
export function kindLabel(document: PdfDocumentInfo): string | null {
  if (document.kind === 'pdf') {
    return null;
  }
  const lower = document.path.toLowerCase();
  if (lower.endsWith('.docx')) {
    return 'Word';
  }
  if (lower.endsWith('.odt')) {
    return 'ODT';
  }
  return 'Doc';
}

/** A readable size for the shelf listing, e.g. `4.2 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asKind(value: unknown): DocumentKind {
  return value === 'office' ? 'office' : 'pdf';
}

/**
 * Read a listing, tolerating anything unexpected.
 *
 * A malformed entry is dropped rather than failing the whole shelf: an odd file
 * name should never blank the reference panel.
 */
export function parseLibrary(body: unknown): PdfLibrary {
  const root = isRecord(body) ? body : {};
  const folder = typeof root.folder === 'string' ? root.folder : '';
  const converter = typeof root.converter === 'string' ? root.converter : null;
  const raw = Array.isArray(root.documents) ? root.documents : [];

  const documents: PdfDocumentInfo[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path === '') {
      continue;
    }
    documents.push({
      path: entry.path,
      name:
        typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : entry.path,
      size: asCount(entry.size),
      modified: asCount(entry.modified),
      kind: asKind(entry.kind),
    });
  }

  return { folder, documents, converter };
}

export async function fetchPdfLibrary(signal?: AbortSignal): Promise<PdfLibrary> {
  const response = await fetch(PDF_LIST_URL, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`the reference folder could not be listed (HTTP ${response.status})`);
  }
  return parseLibrary(await response.json());
}
