export interface SystemMotionAPI {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(event: 'reduceMotionChanged', listener: (enabled: boolean) => void): { remove(): void };
}

/** A newer system event must win over an older asynchronous initial snapshot. */
export function watchSystemMotion(api: SystemMotionAPI, onChange: (reduced: boolean) => void): () => void {
  let active = true;
  let changed = false;
  onChange(true); // Avoid motion until the system preference is known.
  let subscription: { remove(): void } | undefined;
  try {
    subscription = api.addEventListener('reduceMotionChanged', enabled => {
      if (!active || typeof enabled !== 'boolean') return;
      changed = true;
      onChange(enabled);
    });
  } catch { /* A missing event source must not prevent opening the reader. */ }
  try {
    void api.isReduceMotionEnabled().then(enabled => {
      if (active && !changed && typeof enabled === 'boolean') onChange(enabled);
    }).catch(() => { /* Keep the conservative default or the latest event. */ });
  } catch { /* Native availability must not prevent opening the reader. */ }
  return () => { active = false; subscription?.remove(); };
}
