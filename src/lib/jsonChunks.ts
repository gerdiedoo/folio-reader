interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}
interface Head { format: 'folio-json-chunks'; version: 1; token: string; parts: number; length: number }
const PART = 128 * 1024, MAX = 16 * 1024 * 1024;
function head(raw: string | null): Head | null {
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (value?.format !== 'folio-json-chunks') return null;
  if (value.version !== 1 || typeof value.token !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.token) ||
    !Number.isSafeInteger(value.parts) || value.parts < 1 || value.parts > 129 || !Number.isSafeInteger(value.length) || value.length < 1 || value.length > MAX) throw Error('Saved storage segments could not be read. Existing data has been kept.');
  return value;
}
/** One small pointer commits immutable segments. Serialize reads as well as writes
 * so a newer confirmed pointer cannot clean up segments an older read still uses. */
export function createChunkedJsonStorage(storage: KeyValueStorage, token: () => string) {
  const pending = new Map<string, Promise<unknown>>();
  const queued = <T,>(key: string, work: () => Promise<T>): Promise<T> => {
    const result = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    pending.set(key,result);
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => undefined);
    return result;
  };
  const keys = (key: string, h: Head) => Array.from({length:h.parts},(_,index) => `${key}.chunk.${h.token}.${index}`);
  const remove = async (ids: string[]) => { for (const id of ids) try { await storage.removeItem?.(id); } catch { /* A cleanup failure never invalidates the committed pointer. */ } };
  return {
    getItem: (key: string) => queued(key, async () => {
      const raw = await storage.getItem(key), h = head(raw); if (!h) return raw;
      const parts = await Promise.all(keys(key,h).map(id => storage.getItem(id)));
      if (parts.some(part => part === null || part.length > PART) || parts.reduce((length,part) => length+(part?.length ?? 0),0) !== h.length) throw Error('A saved storage segment is missing or damaged. Existing data has been kept.');
      return parts.join('');
    }),
    setItem: (key: string, value: string) => queued(key, async () => {
      if (value.length > MAX) throw Error('This saved archive exceeds the supported device storage limit. Existing saved work has been kept.');
      const old = head(await storage.getItem(key));
      const staged: string[] = []; let committing = false;
      try {
        if (value.length <= PART) { committing = true; await storage.setItem(key,value); }
        else {
          const id = token(); if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('A storage identifier could not be created.');
          let at = 0, index = 0;
          while (at < value.length) {
            let end = Math.min(value.length, at+PART);
            if (end < value.length && value.charCodeAt(end-1) >= 0xD800 && value.charCodeAt(end-1) <= 0xDBFF) end--;
            const part = `${key}.chunk.${id}.${index++}`;
            if (await storage.getItem(part) !== null) throw Error('A saved segment already uses this identifier. Existing data has been kept.');
            staged.push(part); await storage.setItem(part,value.slice(at,end)); at = end;
          }
          const h: Head = {format:'folio-json-chunks',version:1,token:id,parts:index,length:value.length};
          committing = true; await storage.setItem(key,JSON.stringify(h));
        }
        if (old) await remove(keys(key,old));
      } catch (error) {
        // A pointer write can succeed before an acknowledgement fails. Keep its
        // segments then; reads/retries can recover the possibly committed value.
        if (!committing) await remove(staged);
        throw error;
      }
    }),
  };
}
