import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentArea } from '../src/components/DocumentArea';
import type { PdfDocumentInfo } from '../src/pdf/library';
import type { DocumentTab } from '../src/pdf/useDocuments';

const DOCUMENTS: PdfDocumentInfo[] = [
  { path: 'a.pdf', name: 'Alpha', size: 10, modified: 1, kind: 'pdf' },
  { path: 'b.pdf', name: 'Beta', size: 20, modified: 2, kind: 'pdf' },
];

function tab(overrides: Partial<DocumentTab> & { path: string; name: string }): DocumentTab {
  return {
    page: 1,
    revision: 0,
    preparing: false,
    viewerError: null,
    ...overrides,
  };
}

const TABS: DocumentTab[] = [
  tab({ path: 'a.pdf', name: 'Alpha' }),
  tab({ path: 'b.pdf', name: 'Beta', page: 3 }),
];

function renderArea(overrides: Partial<Parameters<typeof DocumentArea>[0]> = {}) {
  return render(
    <DocumentArea
      tabs={TABS}
      documents={DOCUMENTS}
      activePath="a.pdf"
      converter="soffice"
      onActivate={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe('the reading area', () => {
  it('asks for a document when nothing is open', () => {
    renderArea({ tabs: [], activePath: null });

    expect(screen.getByText(/Pick a document/)).toBeTruthy();
  });

  it('names the document being read', () => {
    renderArea();

    expect(screen.getByRole('heading').textContent).toBe('Alpha · page 1');
  });

  it('keeps every open document mounted, showing only the active one', () => {
    renderArea();

    const alpha = screen.getByTitle('Alpha — page 1').closest('.viewer-pane');
    const beta = screen.getByTitle('Beta — page 3').closest('.viewer-pane');

    // Both viewers are in the page, so switching tabs does not reload them...
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    // ...but only the active tab is visible.
    expect(alpha?.getAttribute('data-active')).toBe('true');
    expect(beta?.getAttribute('data-active')).toBe('false');
  });

  it('moves between open documents when the active tab changes', () => {
    renderArea({ activePath: 'b.pdf' });

    expect(screen.getByRole('heading').textContent).toBe('Beta · page 3');
    expect(screen.getByTitle('Beta — page 3').closest('.viewer-pane')?.getAttribute('data-active')).toBe(
      'true',
    );
    expect(screen.getByTitle('Alpha — page 1').closest('.viewer-pane')?.getAttribute('data-active')).toBe(
      'false',
    );
  });
});
