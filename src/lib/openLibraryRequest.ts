import { CatalogError, catalogCancelled, catalogRequest } from './catalogRequest';

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
      for (let attempt = 0; attempt < 2; attempt++) {
        const delay = Math.max(0, nextAt - clock());
        if (delay) await new Promise<void>(resolve => schedule(resolve, delay));
        if (signal?.aborted) throw catalogCancelled();
        nextAt = clock() + 1100;
        try {
          // Search can exceed the generic ten-second provider deadline. Each
          // attempt has its own slot; no immediate transport-level retry.
          const value = await request(url, 'json', signal, 1, 25000);
          if (signal?.aborted) throw catalogCancelled();
          cache.set(url, { value, at: clock() });
          if (cache.size > 100) cache.delete(cache.keys().next().value!);
          return value;
        } catch (error) {
          if (signal?.aborted) throw catalogCancelled();
          const transient = error instanceof CatalogError && (error.kind === 'network' || error.kind === 'service' && (error.status ?? 0) >= 500);
          // Timeouts and rate limits need explicit retry, rather than another
          // long wait or an extra request while the service is limiting access.
          if (attempt || !transient) throw error;
        }
      }
      throw new CatalogError('network');
    });
    tail = work.then(() => undefined, () => undefined);
    try { return await Promise.race([work, cancelled]); }
    finally { signal?.removeEventListener('abort', onAbort); }
  };
}
export const requestOpenLibrary = createOpenLibraryRequest();
