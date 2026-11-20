import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReadingSettings } from '../types';
import { DEFAULT_READER_SETTINGS, type ReaderSettingsChange } from './readerPreferences';
import { createReaderSettingsStore } from './readerSettingsStore';

type Storage = Parameters<typeof createReaderSettingsStore>[0];
interface Cloud {
  fetchReadingSettingsFromSupabase(): Promise<Partial<ReadingSettings> | null>;
  upsertReadingSettingsToSupabase(settings: ReadingSettings): Promise<boolean>;
}

export function useReaderSettings(storage: Storage, cloud: Cloud, report: (message: string) => void) {
  const store = useMemo(() => createReaderSettingsStore(storage), [storage]);
  const [settings, setSettings] = useState<ReadingSettings>({ ...DEFAULT_READER_SETTINGS });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const statusRef = useRef(status);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const uploads = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    statusRef.current = 'loading'; setStatus('loading');
    void (async () => {
      let hasSaved: boolean;
      try {
        const local = await store.load();
        if (!active) return;
        hasSaved = local.hasSaved;
        setSettings(local.settings); statusRef.current = 'ready'; setStatus('ready'); setNotice(null);
      } catch {
        if (active) {
          statusRef.current = 'error'; setStatus('error');
          setNotice('Saved reading preferences could not be loaded. Existing data has been kept. Try again before saving changes.');
        }
        return;
      }
      if (hasSaved) return;
      try {
        const remote = await cloud.fetchReadingSettingsFromSupabase();
        if (!active || !remote) return;
        const saved = await store.seedCloud(remote);
        if (active) setSettings(saved);
      } catch {
        if (active) setNotice('Cloud reading preferences could not be loaded on this device. You can still save your own choices here.');
      }
    })();
    return () => { active = false; };
  }, [store, cloud, attempt]);

  const patch = async (change: ReaderSettingsChange): Promise<boolean> => {
    if (!mounted.current) return false;
    if (statusRef.current !== 'ready') {
      report(statusRef.current === 'loading' ? 'Reading preferences are still loading.' : 'Saved reading preferences could not be read. Use Try again in Settings.');
      return false;
    }
    setBusy(value => value + 1);
    try {
      const saved = await store.patch(change);
      if (mounted.current) { setSettings(saved); setNotice(null); }
      // Cloud delivery is best effort; device acknowledgement determines success.
      uploads.current = uploads.current.then(() => cloud.upsertReadingSettingsToSupabase(saved)).catch(() => false);
      return true;
    } catch {
      if (mounted.current) {
        setNotice('Reading preferences could not be saved on this device. Try again.');
        report('Couldn’t save reading preferences on this device. Try again.');
      }
      return false;
    } finally { if (mounted.current) setBusy(value => value - 1); }
  };
  return { settings, status, notice, busy: busy > 0, patch, retry: useCallback(() => setAttempt(value => value + 1), []) };
}
