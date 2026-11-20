export class CatalogError extends Error {
  constructor(public readonly kind: 'network' | 'timeout' | 'service' | 'rate' | 'invalid' | 'file' | 'unavailable' | 'size', public readonly status?: number) {
    super({
      size: 'This EPUB exceeds the 40 MB download limit. Try a smaller edition, or import an EPUB file from your device.',
      network: 'Could not reach this book source. Check your connection, retry, or choose another source.',
      timeout: 'This book source took too long. Retry or choose another source.',
      service: `This book source is temporarily unavailable${status ? ` (${status})` : ''}. Retry or choose another source.`,
      rate: 'This source is limiting requests. Wait a little before retrying, or choose another source.',
      invalid: 'This source returned an unreadable catalog. Retry or choose another source.',
      file: 'This source did not send a complete EPUB. Retry, or try another edition or source.',
      unavailable: 'A free, unrestricted EPUB is not available for this edition. Try another book or source.',
    }[kind]);
    this.name = 'CatalogError';
  }
}
export function catalogCancelled(): Error { const error = new Error('Download cancelled.'); error.name = 'AbortError'; return error; }
/** A deadline covers headers AND body, even if the transport ignores abort. */
export async function catalogRequest(url: string, format: 'json' | 'text', signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw catalogCancelled();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => { reject(catalogCancelled()); controller.abort(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { reject(new CatalogError('timeout')); controller.abort(); }, 10000);
    });
    try {
      const request = Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw catalogCancelled();
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: format === 'json' ? 'application/json' : 'text/html' } });
        if (!res.ok) throw new CatalogError(res.status === 429 ? 'rate' : res.status === 404 || res.status === 410 ? 'unavailable' : 'service', res.status);
        try { return await (format === 'json' ? res.json() : res.text()); }
        catch { throw new CatalogError('invalid'); }
      });
      return await Promise.race([request, stopped]);
    } catch (error) {
      if (signal?.aborted) throw catalogCancelled();
      const failure = error instanceof CatalogError ? error : new CatalogError('network');
      if (attempt === 0 && (failure.kind === 'network' || (failure.kind === 'service' && (failure.status ?? 0) >= 500))) continue;
      throw failure;
    } finally {
      clearTimeout(timer!);
      signal?.removeEventListener('abort', onAbort!);
      controller.abort();
    }
  }
  throw new CatalogError('network');
}
