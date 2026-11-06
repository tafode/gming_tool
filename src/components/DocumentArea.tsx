//! The reading area: a tab for every open document, and every open document's
//! pane kept mounted beneath them. Only the active tab's pane is visible, but
//! the others stay in the page so their scroll position and zoom survive a
//! switch.

import type { PdfDocumentInfo } from '../pdf/library';
import type { DocumentTab } from '../pdf/useDocuments';
import { DocumentTabBar } from './DocumentTabBar';
import { DocumentViewer } from './DocumentViewer';

interface DocumentAreaProps {
  tabs: DocumentTab[];
  documents: PdfDocumentInfo[];
  activePath: string | null;
  converter: string | null;
  onActivate(path: string): void;
  onClose(path: string): void;
}

export function DocumentArea({
  tabs,
  documents,
  activePath,
  converter,
  onActivate,
  onClose,
}: DocumentAreaProps) {
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const activeDocument =
    activeTab === null
      ? null
      : documents.find((candidate) => candidate.path === activeTab.path) ?? null;

  return (
    <section className="panel viewer">
      <DocumentTabBar
        tabs={tabs}
        activePath={activePath}
        onActivate={onActivate}
        onClose={onClose}
      />

      <h2 className="panel-title">
        {activeDocument === null ? 'Document' : `${activeDocument.name} · page ${activeTab?.page}`}
      </h2>

      <div className="viewer-stack">
        {tabs.length === 0 ? (
          <p className="empty">Pick a document to read it here.</p>
        ) : (
          tabs.map((tab) => (
            <DocumentViewer
              key={tab.path}
              document={documents.find((candidate) => candidate.path === tab.path) ?? null}
              page={tab.page}
              revision={tab.revision}
              converter={converter}
              preparing={tab.preparing}
              error={tab.viewerError}
              active={tab.path === activePath}
            />
          ))
        )}
      </div>
    </section>
  );
}
