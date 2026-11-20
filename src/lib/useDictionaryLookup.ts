import { useCallback, useEffect, useState } from 'react';
import { bundledDefinition, dictionaryWord, fetchDictionaryDefinition, type DictionaryEntry } from './dictionary';

type LookupState =
  | { key: string; status: 'idle' | 'loading' | 'missing' }
  | { key: string; status: 'found'; entry: DictionaryEntry; source: 'bundled' | 'online' }
  | { key: string; status: 'error'; message: string };

export function useDictionaryLookup(term: string) {
  const key = dictionaryWord(term);
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<LookupState>({ key: '', status: 'idle' });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!key) { setLookup({ key, status: 'idle' }); return; }
    const local = bundledDefinition(key);
    if (local) { setLookup({ key, status: 'found', entry: local, source: 'bundled' }); return; }
    const controller = new AbortController();
    setLookup({ key, status: 'loading' });
    const timer = setTimeout(() => {
      void fetchDictionaryDefinition(key, { signal: controller.signal }).then(entry => {
        if (!controller.signal.aborted) setLookup(entry ? { key, status: 'found', entry, source: 'online' } : { key, status: 'missing' });
      }).catch(error => {
        if (!controller.signal.aborted) setLookup({ key, status: 'error', message: error instanceof Error ? error.message : 'Could not load the definition. Try again.' });
      });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, attempt]);

  const current: LookupState = lookup.key === key ? lookup : { key, status: key ? 'loading' : 'idle' };
  return { lookup: current, retry };
}
