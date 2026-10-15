//! Choosing and reading a reference document: the shelf, the search, and which
//! document (and page) is currently open.
//!
//! Office documents are converted to PDF by the server on first open, which can
//! take a moment, so opening one asks the server to prepare it with a `HEAD`
//! request and reports that as `preparing` while it waits.

import { useCallback, useMemo, useState } from 'react';
import { pdfUrl } from './library';
import { loadLastPages, rememberLastPage, type LastPages } from './preferences';
import { usePdfLibrary } from './usePdfLibrary';
import { useReferenceSearch } from './useReferenceSearch';

export function useDocuments() {
  const { library, loading, error, refresh, documents } = usePdfLibrary();
  const search = useReferenceSearch(documents);
  const converter = library?.converter ?? null;

  const [pages, setPages] = useState<LastPages>(loadLastPages);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Bumped on every jump: the viewer only reliably honours `#page=` when it
  // actually reloads, so the iframe is remounted rather than re-pointed.
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const open = useCallback(
    (path: string, target?: number) => {
      const wanted = target ?? pages[path] ?? 1;
      setActivePath(path);
      setPage(wanted);
      setRevision((current) => current + 1);
      setViewerError(null);

      if (target !== undefined) {
        setPages((current) => rememberLastPage(current, path, target));
      }

      const document = documents.find((candidate) => candidate.path === path);
      if (document?.kind === 'office' && converter !== null) {
        // Convert now, so the viewer can show a clear state while it waits
        // rather than a blank frame that may never fill in.
        setPreparing(true);
        fetch(pdfUrl(path), { method: 'HEAD' })
          .then(async (response) => {
            if (!response.ok) {
              const detail = await response.text().catch(() => '');
              throw new Error(detail.trim() || `the document could not be opened (HTTP ${response.status})`);
            }
          })
          .catch((cause: unknown) => {
            setViewerError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => setPreparing(false));
      } else {
        setPreparing(false);
      }
    },
    [documents, pages, converter],
  );

  const active = useMemo(
    () => documents.find((candidate) => candidate.path === activePath) ?? null,
    [documents, activePath],
  );

  return {
    library,
    converter,
    loading,
    error,
    refresh,
    documents,
    search,
    active,
    activePath,
    page,
    revision,
    preparing,
    viewerError,
    open,
  };
}
