import { catalogCancelled, catalogRequest } from './catalogRequest';

/** Anonymous Open Library access is serialized and spaced; public metadata only. */
export function createOpenLibraryRequest(request = catalogRequest, clock = Date.now, schedule = setTimeout) {
  const cache = new Map<string, { value: unknown; at: number }>();
  let tail = Promise.resolve(), nextAt = 0;
  return async (url: string, signal?: AbortSignal): Promise<unknown> => {
    if (signal?.aborted) throw catalogCancelled();
    const cached = cache.get(url);
    if (cached && clock() - cached.at < 120000) return cached.value;
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(catalogCancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const work = tail.then(async () => {
      if (signal?.aborted) throw catalogCancelled();
      const delay = Math.max(0, nextAt - clock());
      if (delay) await new Promise<void>(resolve => schedule(resolve, delay));
      if (signal?.aborted) throw catalogCancelled();
      nextAt = clock() + 1100;
      // One attempt per slot; retries are explicit so they also respect pacing.
      const value = await request(url, 'json', signal, 1);
      if (signal?.aborted) throw catalogCancelled();
      cache.set(url, { value, at: clock() });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return value;
    });
    tail = work.then(() => undefined, () => undefined);
    try { return await Promise.race([work, cancelled]); }
    finally { signal?.removeEventListener('abort', onAbort); }
  };
}
export const requestOpenLibrary = createOpenLibraryRequest();
