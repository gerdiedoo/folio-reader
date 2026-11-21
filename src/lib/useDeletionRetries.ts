import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { retryRecordedDeletions } from './deletionRetries';

export function useDeletionRetries(storage: Parameters<typeof retryRecordedDeletions>[0], cloud: Parameters<typeof retryRecordedDeletions>[1], enabled: boolean, changeKey: string) {
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, running = false, foreground = AppState.currentState === 'active', timer: ReturnType<typeof setTimeout> | undefined, delay = 15000;
    const run = async () => {
      if (stopped || running || !foreground) return;
      if (timer) clearTimeout(timer);
      running = true;
      try {
        const result = await retryRecordedDeletions(storage, cloud, () => stopped);
        if (stopped) return;
        setNotice(result.pending ? `${result.pending} account ${result.pending === 1 ? 'removal is' : 'removals are'} waiting for confirmation. Device removals are saved.` : null);
        if (result.pending && foreground) { timer = setTimeout(() => { void run(); }, delay); delay = Math.min(300000, delay * 2); }
      } catch {
        if (!stopped) { setNotice('Account removals could not be confirmed. Device removals are saved.'); if (foreground) timer = setTimeout(() => { void run(); }, delay); delay = Math.min(300000, delay * 2); }
      } finally { running = false; }
    };
    void run();
    const subscription = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      if (state === 'active') { delay = 15000; void run(); }
      else if (timer) clearTimeout(timer);
    });
    return () => { stopped = true; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [storage, cloud, enabled, changeKey, attempt]);
  return { notice: enabled ? notice : null, retry: useCallback(() => setAttempt(value => value + 1), []) };
}
