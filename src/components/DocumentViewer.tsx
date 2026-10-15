//! The reading pane: the browser's own PDF viewer, pointed at the chosen
//! document. Office documents are served as converted PDFs, so they look the
//! same here as any other book.

import { pdfUrl, type PdfDocumentInfo } from '../pdf/library';

interface DocumentViewerProps {
  document: PdfDocumentInfo | null;
  page: number;
  /** Bumped whenever a jump should force the viewer to reload. */
  revision: number;
  /** The converter the server found, or `null` when office files cannot open. */
  converter: string | null;
  /** True while an office document is being converted to PDF. */
  preparing: boolean;
  /** Set when opening the document failed (e.g. the conversion did). */
  error: string | null;
}

export function DocumentViewer({
  document,
  page,
  revision,
  converter,
  preparing,
  error,
}: DocumentViewerProps) {
  const needsConverter = document !== null && document.kind === 'office' && converter === null;

  return (
    <section className="panel viewer">
      <h2 className="panel-title">
        {document === null ? 'Document' : `${document.name} · page ${page}`}
      </h2>

      <div className="viewer-pane">
        {document === null ? (
          <p className="empty">Pick a document to read it here.</p>
        ) : needsConverter ? (
          <p className="note">
            This is a Word or OpenDocument file. Install LibreOffice on this machine,
            then press Refresh, to read it here.
          </p>
        ) : error !== null ? (
          <p className="note">{error}</p>
        ) : preparing ? (
          <p className="note">Converting {document.name}…</p>
        ) : (
          <iframe
            key={`${document.path}#${page}#${revision}`}
            className="viewer-frame"
            title={`${document.name} — page ${page}`}
            src={`${pdfUrl(document.path)}#page=${page}`}
          />
        )}
      </div>
    </section>
  );
}
