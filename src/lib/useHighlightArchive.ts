import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HighlightEntry } from '../types';
import { createHighlightArchive } from './highlightArchive';

type Storage = Parameters<typeof createHighlightArchive>[0];
interface Cloud {
  fetchHighlightsFromSupabase(): Promise<HighlightEntry[] | null>;
  upsertHighlightToSupabase(entry: HighlightEntry): Promise<boolean>;
  deleteHighlightFromSupabase(id: string): Promise<boolean>;
}

export function useHighlightArchive(storage: Storage, cloud: Cloud, report: (message: string) => void) {
  const archive = useMemo(() => createHighlightArchive(storage), [storage]);
  const [items, setItems] = useState<HighlightEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const statusRef = useRef(status);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => storage.subscribeArchive?.('highlightArchive', () => {
    void archive.load().then(saved => { if (mounted.current) { setItems(saved.items); setNotice(null); } }).catch(() => undefined);
  }), [archive, storage]);

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
          setNotice('Saved highlights could not be loaded. Existing data has been kept. Try again before making changes.');
        }
        return;
      }
      try {
        const remote = await cloud.fetchHighlightsFromSupabase();
        if (!active || !remote?.length) return;
        const merged = await archive.mergeRemote(remote);
        if (!active) return;
        setItems(merged.items);
        if (merged.skipped) setNotice('Some cloud highlights could not be read. Your saved device copies have been kept.');
      } catch {
        if (active) setNotice('Cloud highlights could not be confirmed on this device. Your local notes are still shown. Try again.');
      }
    })();
    return () => { active = false; };
  }, [archive, cloud, attempt]);

  const mutate = async (operation: () => Promise<{ items: HighlightEntry[] }>, after?: (items: HighlightEntry[]) => Promise<boolean>): Promise<boolean> => {
    if (!mounted.current) return false;
    if (statusRef.current !== 'ready') {
      report(statusRef.current === 'loading' ? 'Highlights are still loading. Try again shortly.' : 'Saved highlights could not be read. Use Try again in Notebook.');
      return false;
    }
    setBusy(value => value + 1);
    try {
      const saved = await operation();
      if (mounted.current) { setItems(saved.items); setNotice(null); }
      // Local success is independent of network availability. Never report cloud backup here.
      if (after) void after(saved.items).catch(() => false);
      return true;
    } catch {
      if (mounted.current) {
        setNotice('Changes could not be saved on this device. Try again.');
        report('Couldn’t save highlight changes on this device. Try again.');
      }
      return false;
    } finally { if (mounted.current) setBusy(value => value - 1); }
  };
  return {
    items, status, notice, busy: busy > 0,
    retry: useCallback(() => setAttempt(value => value + 1), []),
    add: (entry: HighlightEntry) => mutate(() => archive.add(entry), () => cloud.upsertHighlightToSupabase(entry)),
    note: (id: string, note: string) => mutate(() => archive.note(id, note), saved => cloud.upsertHighlightToSupabase(saved.find(item => item.id === id)!)),
    remove: (id: string) => mutate(() => archive.remove(id), () => cloud.deleteHighlightFromSupabase(id)),
    removeBook: (id: string) => mutate(() => archive.removeBook(id)),
  };
}
