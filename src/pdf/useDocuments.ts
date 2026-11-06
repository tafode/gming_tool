//! Choosing and reading reference documents: the shelf, the search, and the
//! documents currently open in the reading pane.
//!
//! Several documents can be open at once, each in its own tab. Opening one that
//! is already open just switches to its tab, so a jump from the search results
//! lands in the tab you already have rather than opening a second copy. The page
//! a tab was on is remembered per document, so switching away and back — or
//! closing the app and returning — finds it again.
//!
//! Office documents are converted to PDF by the server on first open, which can
//! take a moment, so opening one asks the server to prepare it with a `HEAD`
//! request and reports that as `preparing` while it waits.

import { useCallback, useMemo, useRef, useState } from 'react';
import { pdfUrl } from './library';
import { loadLastPages, rememberLastPage, type LastPages } from './preferences';
import { usePdfLibrary } from './usePdfLibrary';
import { useReferenceSearch } from './useReferenceSearch';

/** One document open in the reading pane, and where it is being read. */
export interface OpenDocument {
  path: string;
  page: number;
  /** Bumped whenever a jump should force the viewer to reload. */
  revision: number;
  /** True while an office document is being converted to PDF. */
  preparing: boolean;
  /** Set when opening the document failed (e.g. the conversion did). */
  viewerError: string | null;
}

/** An open document with its display name, for the tab strip. */
export interface DocumentTab extends OpenDocument {
  name: string;
}

interface TabsState {
  tabs: OpenDocument[];
  active: string | null;
}

/** Apply a change to one open tab, leaving the others alone. */
function updateTab(state: TabsState, path: string, patch: Partial<OpenDocument>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)),
  };
}

export function useDocuments() {
  const { library, loading, error, refresh, documents } = usePdfLibrary();
  const search = useReferenceSearch(documents);
  const converter = library?.converter ?? null;

  const [pages, setPages] = useState<LastPages>(loadLastPages);
  const [state, setState] = useState<TabsState>({ tabs: [], active: null });

  // The newest tab list, for the async office-conversion below and for telling
  // whether a click is opening a document or switching to one already open.
  const stateRef = useRef(state);
  stateRef.current = state;

  const open = useCallback(
    (path: string, target?: number) => {
      const alreadyOpen = stateRef.current.tabs.some((tab) => tab.path === path);
      const wanted = target ?? pages[path] ?? 1;

      setState((current) => {
        const existing = current.tabs.find((tab) => tab.path === path);
        if (existing === undefined) {
          return {
            tabs: [
              ...current.tabs,
              { path, page: wanted, revision: 0, preparing: false, viewerError: null },
            ],
            active: path,
          };
        }
        if (target === undefined) {
          // Already open with no page to jump to: just bring its tab forward.
          return { ...current, active: path };
        }
        return updateTab({ ...current, active: path }, path, {
          page: wanted,
          revision: existing.revision + 1,
          viewerError: null,
        });
      });

      if (target !== undefined) {
        setPages((current) => rememberLastPage(current, path, target));
      }

      const found = documents.find((candidate) => candidate.path === path);
      if (!alreadyOpen && found?.kind === 'office' && converter !== null) {
        // Convert now, so the viewer can show a clear state while it waits
        // rather than a blank frame that may never fill in.
        setState((current) => updateTab(current, path, { preparing: true, viewerError: null }));
        fetch(pdfUrl(path), { method: 'HEAD' })
          .then(async (response) => {
            if (!response.ok) {
              const detail = await response.text().catch(() => '');
              throw new Error(
                detail.trim() || `the document could not be opened (HTTP ${response.status})`,
              );
            }
          })
          .catch((cause: unknown) => {
            setState((current) =>
              updateTab(current, path, {
                viewerError: cause instanceof Error ? cause.message : String(cause),
              }),
            );
          })
          .finally(() => {
            setState((current) => updateTab(current, path, { preparing: false }));
          });
      }
    },
    [documents, pages, converter],
  );

  /** Bring an already-open document's tab to the front. */
  const activate = useCallback((path: string) => {
    setState((current) =>
      current.tabs.some((tab) => tab.path === path) ? { ...current, active: path } : current,
    );
  }, []);

  /** Close a tab; if it was the active one, fall back to a neighbour. */
  const close = useCallback((path: string) => {
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.path === path);
      if (index === -1) {
        return current;
      }
      const tabs = current.tabs.filter((tab) => tab.path !== path);
      if (current.active !== path) {
        return { tabs, active: current.active };
      }
      const next = tabs.length === 0 ? null : tabs[Math.min(index, tabs.length - 1)].path;
      return { tabs, active: next };
    });
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.path === state.active) ?? null,
    [state],
  );

  const tabs = useMemo<DocumentTab[]>(
    () =>
      state.tabs.map((tab) => ({
        ...tab,
        name: documents.find((candidate) => candidate.path === tab.path)?.name ?? tab.path,
      })),
    [state.tabs, documents],
  );

  const active = useMemo(
    () => documents.find((candidate) => candidate.path === state.active) ?? null,
    [documents, state.active],
  );

  return {
    library,
    converter,
    loading,
    error,
    refresh,
    documents,
    search,
    tabs,
    activePath: state.active,
    active,
    page: activeTab?.page ?? 1,
    revision: activeTab?.revision ?? 0,
    preparing: activeTab?.preparing ?? false,
    viewerError: activeTab?.viewerError ?? null,
    open,
    activate,
    close,
  };
}
