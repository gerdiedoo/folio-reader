import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { createSyncAccountRepository } from './syncAccount';
import type { createReplicatedStore } from './replicatedStore';
type Cloud = ReturnType<typeof createSyncAccountRepository>;
type Store = ReturnType<typeof createReplicatedStore>;
type Status = Awaited<ReturnType<Store['replication']['status']>>;
export function useAccountSync(store: Store, cloud: Cloud, enabled: boolean) {
  const [status, setStatus] = useState<Status>({ pending: 0, conflicts: [] });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    cloud.sync.start();
    let active = true, running = false, foreground = AppState.currentState === 'active', timer: ReturnType<typeof setTimeout> | undefined, delay = 15000, generation = 0;
    const refresh = async () => {
      const current = ++generation, value = await store.replication.status();
      if (active && current === generation) setStatus(value);
      return value;
    };
    const run = async () => {
      if (!active || !foreground || running) return;
      if (timer) clearTimeout(timer);
      running = true; setBusy(true);
      try { await cloud.sync.cycle(); if (active) setError(cloud.sync.error()); }
      catch { if (active) setError('Account synchronization is unavailable. Device changes are kept and will retry.'); }
      finally {
        let pending = true;
        try { pending = (await refresh()).pending > 0; } catch { if (active) setError('Saved synchronization state could not be read. Existing work is kept.'); }
        running = false;
        if (active) {
          setChecked(true);
          setBusy(false);
          if (foreground) { timer = setTimeout(() => { void run(); }, pending ? delay : 60000); delay = pending ? Math.min(300000,delay * 2) : 15000; }
        }
      }
    };
    const unsubscribe = store.subscribeSync(() => { void refresh().catch(() => undefined); if (!running && foreground) { if (timer) clearTimeout(timer); timer = setTimeout(() => { void run(); },500); } });
    const subscription = AppState.addEventListener('change', value => { foreground = value === 'active'; if (timer) clearTimeout(timer); if (foreground) { delay = 15000; void run(); } });
    void run();
    return () => { active = false; cloud.sync.stop(); if (timer) clearTimeout(timer); unsubscribe(); subscription.remove(); };
  }, [store,cloud,enabled,attempt]);
  const summary = !enabled ? 'Sign in from Account to sync saved work. Device copies stay here.' : error || (!checked ? 'Checking account changes…' : status.conflicts.length ? `${status.conflicts.length} conflicting ${status.conflicts.length === 1 ? 'record needs' : 'records need'} review. Both versions are kept.`
    : status.pending ? `${status.pending} saved ${status.pending === 1 ? 'change is' : 'changes are'} waiting to upload.` : busy ? 'Checking account changes…' : 'Saved work is up to date with this account. Original EPUB files stay on this device.');
  return { status, summary, busy, retry: useCallback(() => setAttempt(value => value + 1), []) };
}
