import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocuments } from '../src/pdf/useDocuments';
import type { PdfDocumentInfo } from '../src/pdf/library';

const DOCUMENTS: PdfDocumentInfo[] = [
  { path: 'a.pdf', name: 'Alpha', size: 10, modified: 1, kind: 'pdf' },
  { path: 'b.pdf', name: 'Beta', size: 20, modified: 2, kind: 'pdf' },
];

/** Stub the one request the hook makes on its own: the shelf listing. */
function stubLibrary(documents: PdfDocumentInfo[] = DOCUMENTS): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/pdfs/index.json') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ folder: '/books', converter: 'soffice', documents }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    }),
  );
}

async function ready() {
  const rendered = renderHook(() => useDocuments());
  await waitFor(() => expect(rendered.result.current.documents).toHaveLength(DOCUMENTS.length));
  return rendered;
}

describe('the open documents', () => {
  beforeEach(() => {
    localStorage.clear();
    stubLibrary();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens a document in a tab and marks it active', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));

    expect(result.current.tabs.map((tab) => tab.path)).toEqual(['a.pdf']);
    expect(result.current.activePath).toBe('a.pdf');
    expect(result.current.active?.name).toBe('Alpha');
    expect(result.current.page).toBe(1);
  });

  it('opens each document in its own tab', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.open('b.pdf'));

    expect(result.current.tabs.map((tab) => tab.path)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.current.tabs.map((tab) => tab.name)).toEqual(['Alpha', 'Beta']);
    expect(result.current.activePath).toBe('b.pdf');
  });

  it('switches to an already-open document rather than opening it twice', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.open('b.pdf'));
    act(() => result.current.open('a.pdf'));

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activePath).toBe('a.pdf');
  });

  it('remembers the page a document was left on across tab switches', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.open('b.pdf'));
    act(() => result.current.open('a.pdf', 7));
    expect(result.current.activePath).toBe('a.pdf');
    expect(result.current.page).toBe(7);

    act(() => result.current.open('b.pdf'));
    expect(result.current.page).toBe(1);

    act(() => result.current.open('a.pdf'));
    expect(result.current.page).toBe(7);
  });

  it('stores the page a document was left on', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf', 7));

    expect(localStorage.getItem('gming_tool.reference.pages')).toContain('"a.pdf":7');
  });

  it('remembers a page from a previous visit', async () => {
    localStorage.setItem('gming_tool.reference.pages', JSON.stringify({ 'a.pdf': 5 }));
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));

    expect(result.current.page).toBe(5);
  });

  it('closes a tab and falls back to a neighbour', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.open('b.pdf'));
    act(() => result.current.close('b.pdf'));

    expect(result.current.tabs.map((tab) => tab.path)).toEqual(['a.pdf']);
    expect(result.current.activePath).toBe('a.pdf');
  });

  it('leaves nothing open when the last tab is closed', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.close('a.pdf'));

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activePath).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it('does not disturb the active tab when another is closed', async () => {
    const { result } = await ready();

    act(() => result.current.open('a.pdf'));
    act(() => result.current.open('b.pdf'));
    act(() => result.current.close('a.pdf'));

    expect(result.current.tabs.map((tab) => tab.path)).toEqual(['b.pdf']);
    expect(result.current.activePath).toBe('b.pdf');
  });
});
