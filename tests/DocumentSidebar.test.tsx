import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { DocumentSidebar } from '../src/components/DocumentSidebar';
import type { PdfDocumentInfo, PdfLibrary } from '../src/pdf/library';
import type { ReferenceMatch } from '../src/pdf/searchLibrary';
import type { ReferenceSearchState } from '../src/pdf/useReferenceSearch';

const FOLDER = '/home/marco/gming_tool/pdfs';

const DOCUMENTS: PdfDocumentInfo[] = [
  { path: 'rulebook.pdf', name: 'rulebook', size: 4404019, modified: 1700000000, kind: 'pdf' },
  {
    path: 'adventures/Lost Mine.pdf',
    name: 'Lost Mine',
    size: 1024,
    modified: 1700000001,
    kind: 'pdf',
  },
  { path: 'notes.docx', name: 'notes', size: 2048, modified: 1700000002, kind: 'office' },
];

const LIBRARY: PdfLibrary = { folder: FOLDER, documents: DOCUMENTS, converter: 'soffice' };

function searchState(overrides: Partial<ReferenceSearchState> = {}): ReferenceSearchState {
  return {
    query: '',
    setQuery: vi.fn(),
    results: [],
    searching: false,
    progress: null,
    withoutText: [],
    failed: [],
    truncated: false,
    ...overrides,
  };
}

function renderSidebar(props: Partial<ComponentProps<typeof DocumentSidebar>> = {}) {
  return render(
    <DocumentSidebar
      documents={DOCUMENTS}
      library={LIBRARY}
      loading={false}
      error={null}
      activePath={null}
      search={searchState()}
      onSelect={vi.fn()}
      onOpenResult={vi.fn()}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe('the document sidebar', () => {
  it('lists documents with their size and format', () => {
    renderSidebar();

    expect(screen.getByText('rulebook')).toBeTruthy();
    expect(screen.getByText('Lost Mine')).toBeTruthy();
    expect(screen.getByText('4.2 MB')).toBeTruthy();
    // An office document is badged; a PDF is not.
    expect(screen.getByText('Word')).toBeTruthy();
  });

  it('marks the document being read', () => {
    renderSidebar({ activePath: 'notes.docx' });

    const active = screen.getByRole('button', { name: /notes/ });
    expect(active.getAttribute('aria-current')).toBe('true');
  });

  it('opens a document when it is clicked', () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });

    fireEvent.click(screen.getByRole('button', { name: /rulebook/ }));

    expect(onSelect).toHaveBeenCalledWith('rulebook.pdf');
  });

  it('points at the folder when there is nothing in it', () => {
    renderSidebar({ documents: [], library: { folder: FOLDER, documents: [], converter: null } });

    expect(screen.getByText(/No documents in/).textContent).toContain(FOLDER);
  });

  it('says so when the folder cannot be listed', () => {
    renderSidebar({ error: 'the reference folder could not be listed (HTTP 500)' });

    expect(screen.getByText(/could not be listed/)).toBeTruthy();
  });

  it('asks to be refreshed', () => {
    const onRefresh = vi.fn();
    renderSidebar({ onRefresh });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('passes typing through to the search', () => {
    const setQuery = vi.fn();
    renderSidebar({ search: searchState({ setQuery }) });

    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'grapple' } });

    expect(setQuery).toHaveBeenCalledWith('grapple');
  });

  it('shows hits and opens the document at the hit’s page', () => {
    const document = DOCUMENTS[0]!;
    const results: ReferenceMatch[] = [
      {
        document,
        page: 3,
        snippet: 'the grapple rules',
        snippetMatchStart: 4,
        snippetMatchEnd: 11,
      },
    ];
    const onOpenResult = vi.fn();
    renderSidebar({
      search: searchState({ query: 'grapple', results }),
      onOpenResult,
    });

    expect(screen.getByText(/rulebook · page 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /rulebook · page 3/ }));

    expect(onOpenResult).toHaveBeenCalledWith('rulebook.pdf', 3);
  });
});
