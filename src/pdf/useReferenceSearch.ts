//! Debounced search across the whole reference shelf.

import { useEffect, useState } from 'react';
import type { PdfDocumentInfo } from './library';
import {
  MAX_TOTAL_MATCHES,
  searchLibrary,
  type ReferenceMatch,
} from './searchLibrary';

/** How long typing must pause before the shelf is searched. */
export const SEARCH_DELAY_MS = 300;

const NO_RESULTS: ReferenceMatch[] = [];
const NO_DOCUMENTS: PdfDocumentInfo[] = [];

export interface ReferenceSearchState {
  query: string;
  setQuery(query: string): void;
  results: ReferenceMatch[];
  searching: boolean;
  /** Human-readable note while a long document is being read. */
  progress: string | null;
  /** Documents that have no text layer, so search cannot see inside them. */
  withoutText: PdfDocumentInfo[];
  /** Documents that could not be read at all. */
  failed: PdfDocumentInfo[];
  /** True when the hit ceiling was reached and later hits were not looked for. */
  truncated: boolean;
}

export function useReferenceSearch(documents: readonly PdfDocumentInfo[]): ReferenceSearchState {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReferenceMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [withoutText, setWithoutText] = useState<PdfDocumentInfo[]>([]);
  const [failed, setFailed] = useState<PdfDocumentInfo[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    // Every run claims a new token; anything older than the newest token has
    // been superseded and its result is dropped.
    const token = generation.current + 1;
    generation.current = token;

    if (query.trim() === '') {
      // Clear whatever a previous search left behind — but only where the state
      // actually differs. Writing a fresh empty array on every pass would change
      // state identity each render and loop the component forever.
      setResults((current) => (current.length === 0 ? current : NO_RESULTS));
      setWithoutText((current) => (current.length === 0 ? current : NO_DOCUMENTS));
      setFailed((current) => (current.length === 0 ? current : NO_DOCUMENTS));
      setTruncated((current) => (current ? false : current));
      setSearching((current) => (current ? false : current));
      setProgress((current) => (current === null ? current : null));
      return;
    }

    setSearching(true);
    setProgress(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchLibrary(documents, query, {
            isCancelled: () => generation.current !== token,
            onProgress: (note) => {
              if (generation.current === token) {
                setProgress(
                  `Reading ${note.document.name} · page ${note.page} of ${note.total}`,
                );
              }
            },
          });

          if (generation.current !== token) {
            return;
          }
          setResults(found.matches);
          setWithoutText(found.withoutText);
          setFailed(found.failed);
          setTruncated(found.matches.length >= MAX_TOTAL_MATCHES);
          setSearching(false);
          setProgress(null);
        } catch {
          if (generation.current === token) {
            // A superseded search never reaches here; a real failure clears out.
            setResults([]);
            setWithoutText([]);
            setFailed([]);
            setTruncated(false);
            setSearching(false);
            setProgress(null);
          }
        }
      })();
    }, SEARCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [query, documents]);

  return { query, setQuery, results, searching, progress, withoutText, failed, truncated };
}

/** Module-level so a re-render never disturbs an in-flight search. */
const generation = { current: 0 };
