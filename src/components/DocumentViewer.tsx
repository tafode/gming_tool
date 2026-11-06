//! One document's reading pane: the browser's own PDF viewer, pointed at the
//! chosen document. Office documents are served as converted PDFs, so they look
//! the same here as any other book.
//!
//! Every open document keeps its pane mounted, even while another tab is in
//! front. Hiding it with `visibility` rather than removing it lets the browser's
//! viewer keep its scroll position and zoom, so switching back lands where you
//! were rather than at the top of the page.

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
  /** False while another tab is in front; the pane stays mounted but hidden. */
  active?: boolean;
}

export function DocumentViewer({
  document,
  page,
  revision,
  converter,
  preparing,
  error,
  active = true,
}: DocumentViewerProps) {
  const needsConverter = document !== null && document.kind === 'office' && converter === null;

  return (
    <div className="viewer-pane" data-active={active}>
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
  );
}
