//! The reference drawer: a shelf of PDFs from the project's folder, a search
//! across all of them, and the browser's own viewer for reading them.

import { useCallback, useState, type PointerEvent } from 'react';
import {
  formatBytes,
  pdfUrl,
  type PdfDocumentInfo,
} from '../pdf/library';
import {
  loadLastPages,
  rememberLastPage,
  type LastPages,
} from '../pdf/preferences';
import { usePdfLibrary } from '../pdf/usePdfLibrary';
import { useReferenceSearch } from '../pdf/useReferenceSearch';

interface ReferencePanelProps {
  collapsed: boolean;
  /** Drawer height in pixels, used only while it is open. */
  height: number;
  onToggleCollapsed(): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
}

export function ReferencePanel({
  collapsed,
  height,
  onToggleCollapsed,
  onResizeStart,
}: ReferencePanelProps) {
  const { library, loading, error, refresh, documents } = usePdfLibrary();
  const search = useReferenceSearch(documents);

  const [pages, setPages] = useState<LastPages>(loadLastPages);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Bumped on every jump: the viewer only reliably honours `#page=` when it
  // actually reloads, so the iframe is remounted rather than re-pointed.
  const [revision, setRevision] = useState(0);

  const active = documents.find((document) => document.path === activePath) ?? null;

  const openDocument = useCallback(
    (path: string, target?: number) => {
      const wanted = target ?? pages[path] ?? 1;
      setActivePath(path);
      setPage(wanted);
      setRevision((current) => current + 1);
      if (target !== undefined) {
        setPages((current) => rememberLastPage(current, path, target));
      }
    },
    [pages],
  );

  const searching = search.query.trim() !== '';

  return (
    <section
      className={collapsed ? 'reference collapsed' : 'reference'}
      aria-label="Reference documents"
      style={collapsed ? undefined : { height }}
    >
      <div
        className="reference-handle"
        onPointerDown={onResizeStart}
        aria-hidden="true"
        title="Drag to resize"
      />

      <header className="reference-bar">
        <button
          type="button"
          className="reference-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          {collapsed ? '▸' : '▾'} Reference
        </button>

        {collapsed ? (
          <span className="reference-summary">{summarise(loading, documents)}</span>
        ) : (
          <>
            <input
              type="search"
              className="reference-search"
              value={search.query}
              placeholder="Search all documents…"
              aria-label="Search reference documents"
              onChange={(event) => search.setQuery(event.target.value)}
            />

            {searching && (
              <span className="reference-summary">
                {search.searching
                  ? (search.progress ?? 'Searching…')
                  : `${search.results.length} hit${search.results.length === 1 ? '' : 's'}`}
              </span>
            )}

            <button type="button" onClick={refresh} disabled={loading}>
              Refresh
            </button>
          </>
        )}
      </header>

      {!collapsed && (
        <div className="reference-body">
          {error !== null ? (
            <p className="reference-note">{error}</p>
          ) : documents.length === 0 ? (
            <p className="reference-note">
              {loading
                ? 'Looking for documents…'
                : `No PDFs in ${library?.folder ?? 'the reference folder'}. Drop some in and press Refresh.`}
            </p>
          ) : (
            <>
              <div className="reference-shelf">
                {searching ? (
                  <SearchResults
                    results={search.results}
                    searching={search.searching}
                    truncated={search.truncated}
                    withoutText={search.withoutText}
                    failed={search.failed}
                    onOpen={openDocument}
                  />
                ) : (
                  <ul className="reference-list">
                    {documents.map((document) => (
                      <li key={document.path}>
                        <button
                          type="button"
                          className="reference-document"
                          aria-current={document.path === activePath}
                          title={document.path}
                          onClick={() => openDocument(document.path)}
                        >
                          <span className="reference-document-name">{document.name}</span>
                          <span className="reference-document-size">
                            {formatBytes(document.size)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="reference-pane">
                {active === null ? (
                  <p className="reference-note">Pick a document to read it here.</p>
                ) : (
                  <iframe
                    key={`${active.path}#${page}#${revision}`}
                    className="reference-viewer"
                    title={`${active.name} — page ${page}`}
                    src={`${pdfUrl(active.path)}#page=${page}`}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function summarise(loading: boolean, documents: readonly PdfDocumentInfo[]): string {
  if (loading) {
    return 'looking for documents…';
  }
  if (documents.length === 0) {
    return 'no documents';
  }
  return `${documents.length} document${documents.length === 1 ? '' : 's'}`;
}

interface SearchResultsProps {
  results: ReturnType<typeof useReferenceSearch>['results'];
  searching: boolean;
  truncated: boolean;
  withoutText: PdfDocumentInfo[];
  failed: PdfDocumentInfo[];
  onOpen(path: string, page: number): void;
}

function SearchResults({
  results,
  searching,
  truncated,
  withoutText,
  failed,
  onOpen,
}: SearchResultsProps) {
  if (searching && results.length === 0) {
    return <p className="reference-note">Searching…</p>;
  }

  if (results.length === 0 && withoutText.length === 0 && failed.length === 0) {
    return <p className="reference-note">Nothing found.</p>;
  }

  return (
    <div className="reference-results">
      <ul>
        {results.map((hit, index) => (
          <li key={`${hit.document.path}#${hit.page}#${index}`}>
            <button
              type="button"
              className="reference-hit"
              onClick={() => onOpen(hit.document.path, hit.page)}
            >
              <span className="reference-hit-where">
                {hit.document.name} · page {hit.page}
              </span>
              <span className="reference-hit-snippet">
                {hit.snippet.slice(0, hit.snippetMatchStart)}
                <mark>{hit.snippet.slice(hit.snippetMatchStart, hit.snippetMatchEnd)}</mark>
                {hit.snippet.slice(hit.snippetMatchEnd)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {truncated && <p className="reference-note">Showing the first 120 hits.</p>}

      {withoutText.length > 0 && (
        <p className="reference-note">
          No text layer in {withoutText.map((document) => document.name).join(', ')} — those
          are scans, so search cannot see inside them.
        </p>
      )}

      {failed.length > 0 && (
        <p className="reference-note">
          Could not read {failed.map((document) => document.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
