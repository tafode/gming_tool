import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ReferencePanel } from '../src/components/ReferencePanel';
import type { PdfDocumentInfo } from '../src/pdf/library';

const FOLDER = '/home/marco/gming_tool/pdfs';

const DOCUMENTS: PdfDocumentInfo[] = [
  { path: 'rulebook.pdf', name: 'rulebook', size: 4404019, modified: 1700000000 },
  { path: 'adventures/Lost Mine.pdf', name: 'Lost Mine', size: 1024, modified: 1700000001 },
];

function stubListing(documents: PdfDocumentInfo[], folder = FOLDER): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/pdfs/index.json') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ folder, documents }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

function renderPanel(props: Partial<ComponentProps<typeof ReferencePanel>> = {}) {
  return render(
    <ReferencePanel
      collapsed={false}
      height={380}
      onToggleCollapsed={vi.fn()}
      onResizeStart={vi.fn()}
      {...props}
    />,
  );
}

describe('the reference drawer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists what is in the folder', async () => {
    stubListing(DOCUMENTS);
    renderPanel();

    expect(await screen.findByText('rulebook')).toBeTruthy();
    expect(screen.getByText('Lost Mine')).toBeTruthy();
    expect(screen.getByText('4.2 MB')).toBeTruthy();
  });

  it('reads a document in the browser’s own viewer', async () => {
    stubListing(DOCUMENTS);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /rulebook/ }));

    const viewer = screen.getByTitle('rulebook — page 1') as HTMLIFrameElement;
    expect(viewer.getAttribute('src')).toBe('/pdfs/rulebook.pdf#page=1');
  });

  it('escapes a document folder it has to reach through a path', async () => {
    stubListing(DOCUMENTS);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Lost Mine/ }));

    const viewer = screen.getByTitle('Lost Mine — page 1') as HTMLIFrameElement;
    expect(viewer.getAttribute('src')).toBe('/pdfs/adventures/Lost%20Mine.pdf#page=1');
  });

  it('points at the folder when there is nothing in it', async () => {
    stubListing([]);
    renderPanel();

    const note = await screen.findByText(/No PDFs in/);
    expect(note.textContent).toContain(FOLDER);
  });

  it('says so when the folder cannot be listed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })),
    );
    renderPanel();

    expect(await screen.findByText(/could not be listed/)).toBeTruthy();
  });

  it('folds down to a bar, and says what is on the shelf', async () => {
    stubListing(DOCUMENTS);
    renderPanel({ collapsed: true });

    const toggle = screen.getByRole('button', { name: '▸ Reference' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Search reference documents')).toBeNull();
    expect(await screen.findByText('2 documents')).toBeTruthy();
  });

  it('asks to be folded away when its bar is clicked', async () => {
    stubListing(DOCUMENTS);
    const onToggleCollapsed = vi.fn();
    renderPanel({ onToggleCollapsed });

    fireEvent.click(screen.getByRole('button', { name: '▾ Reference' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('asks to be resized when its handle is dragged', async () => {
    stubListing(DOCUMENTS);
    const onResizeStart = vi.fn();
    renderPanel({ onResizeStart });

    fireEvent.pointerDown(screen.getByTitle('Drag to resize'));

    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it('offers a search across the whole shelf', async () => {
    stubListing(DOCUMENTS);
    renderPanel();

    const search = screen.getByLabelText('Search reference documents');

    fireEvent.change(search, { target: { value: 'grapple' } });

    expect((search as HTMLInputElement).value).toBe('grapple');
  });
});
