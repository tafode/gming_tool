//! Reading the shelf listing, with a way to refresh it after dropping files in.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPdfLibrary, type PdfDocumentInfo, type PdfLibrary } from './library';

/** A stable empty shelf, so a loading panel does not change identity each render. */
const NO_DOCUMENTS: PdfDocumentInfo[] = [];

export interface PdfLibraryState {
  library: PdfLibrary | null;
  loading: boolean;
  error: string | null;
  refresh(): void;
  /** Documents, or an empty list while loading. */
  documents: PdfLibrary['documents'];
}

export function usePdfLibrary(): PdfLibraryState {
  const [library, setLibrary] = useState<PdfLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;

    setLoading(true);
    void fetchPdfLibrary(controller.signal)
      .then((found) => {
        if (controller.signal.aborted) {
          return;
        }
        setLibrary(found);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [attempt]);

  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

  return { library, loading, error, refresh, documents: library?.documents ?? NO_DOCUMENTS };
}
