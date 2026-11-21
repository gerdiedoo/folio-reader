const queues = new Map<string, Promise<void>>();
/** One logical archive lock is shared by user edits, network reconciliation and recovery. */
export function withArchiveLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const operation = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = operation.then(() => undefined, () => undefined); queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return operation;
}
