import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentTabBar } from '../src/components/DocumentTabBar';
import type { DocumentTab } from '../src/pdf/useDocuments';

const TABS: DocumentTab[] = [
  { path: 'a.pdf', name: 'Alpha', page: 1, revision: 0, preparing: false, viewerError: null },
  { path: 'b.pdf', name: 'Beta', page: 3, revision: 1, preparing: false, viewerError: null },
];

function renderBar(overrides: Partial<Parameters<typeof DocumentTabBar>[0]> = {}) {
  return render(
    <DocumentTabBar
      tabs={TABS}
      activePath="a.pdf"
      onActivate={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe('the document tabs', () => {
  it('shows a tab for every open document', () => {
    renderBar();

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Alpha', 'Beta']);
  });

  it('marks the document being read as the active tab', () => {
    renderBar();

    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('false');
  });

  it('switches to a tab when it is clicked', () => {
    const onActivate = vi.fn();
    renderBar({ onActivate });

    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));

    expect(onActivate).toHaveBeenCalledWith('b.pdf');
  });

  it('closes a tab', () => {
    const onClose = vi.fn();
    renderBar({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha' }));

    expect(onClose).toHaveBeenCalledWith('a.pdf');
  });

  it('draws nothing when no documents are open', () => {
    const { container } = renderBar({ tabs: [], activePath: null });

    expect(container.querySelector('.document-tabs')).toBeNull();
  });
});
