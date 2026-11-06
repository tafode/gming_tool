//! The strip of tabs above the reading pane: one per open document, with a
//! close button on each. The active tab is the document being read.

import type { DocumentTab } from '../pdf/useDocuments';

interface DocumentTabBarProps {
  tabs: DocumentTab[];
  activePath: string | null;
  onActivate(path: string): void;
  onClose(path: string): void;
}

export function DocumentTabBar({
  tabs,
  activePath,
  onActivate,
  onClose,
}: DocumentTabBarProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="document-tabs" role="tablist" aria-label="Open documents">
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div className="document-tab" data-active={active} key={tab.path}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="document-tab-label"
              title={tab.path}
              onClick={() => onActivate(tab.path)}
            >
              {tab.name}
            </button>
            <button
              type="button"
              className="document-tab-close"
              aria-label={`Close ${tab.name}`}
              title={`Close ${tab.name}`}
              onClick={() => onClose(tab.path)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
