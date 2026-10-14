import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPdfMiddleware,
  isServablePath,
  listPdfFiles,
  parseRange,
  resolvePdfFolder,
} from '../tools/pdf-server';

let folder: string;

beforeEach(async () => {
  folder = await fs.mkdtemp(join(tmpdir(), 'gming-pdfs-'));
  await fs.writeFile(join(folder, 'rulebook.pdf'), 'PDF-one-rulebook');
  await fs.mkdir(join(folder, 'adventures'));
  await fs.writeFile(join(folder, 'adventures', 'Lost Mine.PDF'), 'PDF-two-lost-mine');
  await fs.writeFile(join(folder, 'notes.txt'), 'not a pdf');
  await fs.writeFile(join(folder, '.hidden.pdf'), 'PDF-hidden');
});

afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
});

describe('choosing the reference folder', () => {
  it('defaults to a `pdfs` folder beside the project', () => {
    expect(resolvePdfFolder('/app', undefined)).toBe('/app/pdfs');
    expect(resolvePdfFolder('/app', '   ')).toBe('/app/pdfs');
  });

  it('resolves a relative folder against the project', () => {
    expect(resolvePdfFolder('/app', 'books')).toBe('/app/books');
  });

  it('expands a home-relative folder, even when the shell did not', () => {
    expect(resolvePdfFolder('/app', '~')).toBe(homedir());
    expect(resolvePdfFolder('/app', '~/books')).toBe(join(homedir(), 'books'));
  });

  it('takes an absolute folder as it is', () => {
    expect(resolvePdfFolder('/app', '/mnt/books')).toBe('/mnt/books');
  });
});

describe('guarding what can be served', () => {
  it('serves PDFs from inside the folder', () => {
    expect(isServablePath('/app/pdfs', 'rulebook.pdf')).toBe(true);
    expect(isServablePath('/app/pdfs', 'adventures/Lost Mine.PDF')).toBe(true);
  });

  it('refuses to climb out of the folder', () => {
    expect(isServablePath('/app/pdfs', '../secrets.pdf')).toBe(false);
    expect(isServablePath('/app/pdfs', 'adventures/../../secrets.pdf')).toBe(false);
    expect(isServablePath('/app/pdfs', '/etc/secrets.pdf')).toBe(false);
  });

  it('refuses anything that is not a PDF', () => {
    expect(isServablePath('/app/pdfs', 'notes.txt')).toBe(false);
    expect(isServablePath('/app/pdfs', '')).toBe(false);
    expect(isServablePath('/app/pdfs', 'rulebook.pdf\0.txt')).toBe(false);
  });
});

describe('reading byte ranges', () => {
  it('reads what a viewer asks for', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('clamps a range that runs past the end', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('falls back to the whole file for anything odd', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=abc', 1000)).toBeNull();
    expect(parseRange('bytes=10-5', 1000)).toBeNull();
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=0-10', 0)).toBeNull();
  });
});

describe('listing the folder', () => {
  it('finds PDFs at any depth, and nothing else', async () => {
    const documents = await listPdfFiles(folder);

    expect(documents.map((document) => document.path)).toEqual([
      'adventures/Lost Mine.PDF',
      'rulebook.pdf',
    ]);
    expect(documents.map((document) => document.name)).toEqual(['Lost Mine', 'rulebook']);
    expect(documents[1].size).toBeGreaterThan(0);
    expect(documents[1].modified).toBeGreaterThan(0);
  });

  it('finds nothing in a folder that is not there', async () => {
    expect(await listPdfFiles(join(folder, 'nowhere'))).toEqual([]);
  });
});

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const middleware = createPdfMiddleware(folder);
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end('passed through');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('serving the shelf', () => {
  it('publishes the listing the panel reads', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/pdfs/index.json`);
      const listing = (await response.json()) as {
        folder: string;
        documents: { path: string }[];
      };

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(listing.folder).toBe(folder);
      expect(listing.documents.map((document) => document.path)).toContain('rulebook.pdf');
    });
  });

  it('sends a document whole', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/pdfs/rulebook.pdf`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(await response.text()).toBe('PDF-one-rulebook');
    });
  });

  it('streams a range, which is how a viewer seeks', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/pdfs/rulebook.pdf`, {
        headers: { range: 'bytes=4-6' },
      });

      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe('bytes 4-6/16');
      expect(await response.text()).toBe('one');
    });
  });

  it('honours an etag, so a second look costs nothing', async () => {
    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/pdfs/rulebook.pdf`, { cache: 'no-store' });
      const etag = first.headers.get('etag') ?? '';

      const second = await fetch(`${baseUrl}/pdfs/rulebook.pdf`, {
        cache: 'no-store',
        headers: { 'if-none-match': etag },
      });

      expect(etag).not.toBe('');
      expect(second.status).toBe(304);
    });
  });

  it('refuses to be talked out of the folder', async () => {
    await withServer(async (baseUrl) => {
      // The path arrives encoded, so it survives URL normalisation and reaches
      // the guard as a traversal attempt.
      const escaped = await fetch(`${baseUrl}/pdfs/..%2Fpdf-server.test.ts`);
      const notPdf = await fetch(`${baseUrl}/pdfs/notes.txt`);

      expect(escaped.status).toBe(404);
      expect(notPdf.status).toBe(404);
    });
  });

  it('leaves everything else to the app server', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/index.html`);

      expect(await response.text()).toBe('passed through');
    });
  });
});
