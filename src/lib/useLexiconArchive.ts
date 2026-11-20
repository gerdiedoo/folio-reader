import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LexiconEntry } from '../types';
import { createLexiconArchive } from './lexiconArchive';

type Storage = Parameters<typeof createLexiconArchive>[0];
interface Cloud {
  fetchLexiconFromSupabase(): Promise<LexiconEntry[] | null>;
  upsertLexiconToSupabase(entry: LexiconEntry): Promise<boolean>;
}

export function useLexiconArchive(storage: Storage, cloud: Cloud, report: (message: string) => void) {
  const archive = useMemo(() => createLexiconArchive(storage), [storage]);
  const [items, setItems] = useState<LexiconEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const statusRef = useRef(status);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    statusRef.current = 'loading'; setStatus('loading');
    void (async () => {
      try {
        const local = await archive.load();
        if (!active) return;
        setItems(local.items); statusRef.current = 'ready'; setStatus('ready'); setNotice(null);
      } catch {
        if (active) {
          statusRef.current = 'error'; setStatus('error');
          setNotice('Saved vocabulary could not be loaded. Existing data has been kept. Try again before making changes.');
        }
        return;
      }
      try {
        const remote = await cloud.fetchLexiconFromSupabase();
        if (!active || !remote?.length) return;
        const merged = await archive.mergeRemote(remote);
        if (!active) return;
        setItems(merged.items);
        if (merged.skipped) setNotice('Some cloud vocabulary could not be read. Your saved device copies have been kept.');
      } catch {
        if (active) setNotice('Cloud vocabulary could not be confirmed on this device. Your local cards are still shown. Try again.');
      }
    })();
    return () => { active = false; };
  }, [archive, cloud, attempt]);

  const mutate = async (operation: () => Promise<{ items: LexiconEntry[] }>, after?: (items: LexiconEntry[]) => Promise<boolean>): Promise<boolean> => {
    if (!mounted.current) return false;
    if (statusRef.current !== 'ready') {
      report(statusRef.current === 'loading' ? 'Vocabulary is still loading. Try again shortly.' : 'Saved vocabulary could not be read. Use Try again in Notebook.');
      return false;
    }
    setBusy(value => value + 1);
    try {
      const saved = await operation();
      if (mounted.current) { setItems(saved.items); setNotice(null); }
      if (after) void after(saved.items).catch(() => false);
      return true;
    } catch {
      if (mounted.current) {
        setNotice('Vocabulary changes could not be saved on this device. Try again.');
        report('Couldn’t save vocabulary changes on this device. Try again.');
      }
      return false;
    } finally { if (mounted.current) setBusy(value => value - 1); }
  };
  return {
    items, status, notice, busy: busy > 0,
    retry: useCallback(() => setAttempt(value => value + 1), []),
    add: (entry: LexiconEntry) => mutate(() => archive.add(entry), saved => cloud.upsertLexiconToSupabase(saved.find(item => item.id === entry.id)!)),
    mastery: (id: string, level: number) => mutate(() => archive.mastery(id, level), saved => cloud.upsertLexiconToSupabase(saved.find(item => item.id === id)!)),
    removeBook: (id: string) => mutate(() => archive.removeBook(id)),
  };
}
