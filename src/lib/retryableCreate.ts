import { canonical } from './stableValue';
/** Reuse the same identifier while a failed/uncertain creation is still being retried. */
export function createRetryableWriter<T extends object, R extends T>(make: (draft: T) => R, save: (entry: R) => Promise<boolean>) {
  const attempts = new Map<string, R>();
  return async (draft: T): Promise<boolean> => {
    const key = canonical(draft), entry = attempts.get(key) ?? make(draft);
    if (!attempts.has(key)) { if (attempts.size >= 32) throw Error('Too many unconfirmed saves. Reload saved work before adding more.'); attempts.set(key, entry); }
    const saved = await save(entry);
    if (saved) attempts.delete(key);
    return saved;
  };
}
