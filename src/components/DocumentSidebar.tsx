//! The document list: every PDF, Word and OpenDocument file on the shelf, a
//! search across all of them, and the button that re-reads the folder.

import { formatBytes, kindLabel, type PdfDocumentInfo, type PdfLibrary } from '../pdf/library';
import type { ReferenceSearchState } from '../pdf/useReferenceSearch';

interface DocumentSidebarProps {
  documents: PdfDocumentInfo[];
  library: PdfLibrary | null;
  loading: boolean;
  error: string | null;
  activePath: string | null;
  search: ReferenceSearchState;
  onSelect(path: string): void;
  onOpenResult(path: string, page: number): void;
  onRefresh(): void;
}

export function DocumentSidebar({
  documents,
  library,
  loading,
  error,
  activePath,
  search,
  onSelect,
  onOpenResult,
  onRefresh,
}: DocumentSidebarProps) {
  const searching = search.query.trim() !== '';

  return (
    <aside className="panel documents">
      <h2 className="panel-title">Documents</h2>

      <div className="documents-search">
        <input
          type="search"
          value={search.query}
          placeholder="Search all documents…"
          aria-label="Search documents"
          onChange={(event) => search.setQuery(event.target.value)}
        />
        <button type="button" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>

      {searching && (
        <p className="documents-summary" role="status">
          {search.searching
            ? (search.progress ?? 'Searching…')
            : `${search.results.length} hit${search.results.length === 1 ? '' : 's'}`}
        </p>
      )}

      <div className="documents-body">
        {error !== null ? (
          <p className="note">{error}</p>
        ) : documents.length === 0 ? (
          <p className="note">
            {loading
              ? 'Looking for documents…'
              : `No documents in ${library?.folder ?? 'the reference folder'}. Drop some in and press Refresh.`}
          </p>
        ) : searching ? (
          <SearchResults
            results={search.results}
            searching={search.searching}
            truncated={search.truncated}
            withoutText={search.withoutText}
            failed={search.failed}
            onOpen={onOpenResult}
          />
        ) : (
          <ul className="documents-list">
            {documents.map((document) => {
              const badge = kindLabel(document);
              return (
                <li key={document.path}>
                  <button
                    type="button"
                    className="document-button"
                    aria-current={document.path === activePath}
                    title={document.path}
                    onClick={() => onSelect(document.path)}
                  >
                    <span className="document-name">{document.name}</span>
                    {badge !== null && <span className="document-badge">{badge}</span>}
                    <span className="document-size">{formatBytes(document.size)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

interface SearchResultsProps {
  results: ReferenceSearchState['results'];
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
    return <p className="note">Searching…</p>;
  }

  if (results.length === 0 && withoutText.length === 0 && failed.length === 0) {
    return <p className="note">Nothing found.</p>;
  }

  return (
    <div className="search-results">
      <ul>
        {results.map((hit, index) => (
          <li key={`${hit.document.path}#${hit.page}#${index}`}>
            <button
              type="button"
              className="search-hit"
              onClick={() => onOpen(hit.document.path, hit.page)}
            >
              <span className="search-hit-where">
                {hit.document.name} · page {hit.page}
              </span>
              <span className="search-hit-snippet">
                {hit.snippet.slice(0, hit.snippetMatchStart)}
                <mark>{hit.snippet.slice(hit.snippetMatchStart, hit.snippetMatchEnd)}</mark>
                {hit.snippet.slice(hit.snippetMatchEnd)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {truncated && <p className="note">Showing the first 120 hits.</p>}

      {withoutText.length > 0 && (
        <p className="note">
          No text layer in {withoutText.map((document) => document.name).join(', ')} — those
          are scans, so search cannot see inside them.
        </p>
      )}

      {failed.length > 0 && (
        <p className="note">
          Could not read {failed.map((document) => document.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
