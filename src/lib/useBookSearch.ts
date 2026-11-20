import { useCallback, useEffect, useState } from 'react';
import type { BookContentPage } from '../types';
import { searchBookPages, type BookSearchMatch } from './bookSearch';

interface SearchState {
  query: string;
  pages: BookContentPage[] | null;
  status: 'idle' | 'searching' | 'ready' | 'error';
  matches: BookSearchMatch[];
  hasMore: boolean;
  error?: string;
}

export function useBookSearch(pages: BookContentPage[], query: string) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState<SearchState>({ query: '', pages: null, status: 'idle', matches: [], hasMore: false });
  useEffect(() => {
    const controller = new AbortController();
    const empty = { query, pages, matches: [], hasMore: false };
    if (!query.trim()) { setState({ ...empty, status: 'idle' }); return; }
    setState({ ...empty, status: 'searching' });
    const timer = setTimeout(() => {
      void searchBookPages(pages, query, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setState({ query, pages, status: 'ready', ...result });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ ...empty, status: 'error', error: error instanceof Error ? error.message : 'Search failed. Try another phrase.' });
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pages, query, attempt]);

  // Never show results for the previous query/book while the new effect starts.
  if (state.query !== query || state.pages !== pages) {
    return { status: query.trim() ? 'searching' as const : 'idle' as const, matches: [], hasMore: false, error: undefined, retry };
  }
  return { ...state, retry };
}
