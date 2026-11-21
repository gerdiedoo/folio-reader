import { createLibraryStore } from './libraryStore';
import { createHighlightArchive } from './highlightArchive';

type Storage = Parameters<typeof createLibraryStore>[0];
interface Cloud { deleteBookFromSupabase(id: string): Promise<boolean>; deleteHighlightFromSupabase(id: string): Promise<boolean> }
const KEY = 'deletionReceipts';
const queues = new Map<string, Promise<void>>();
interface Receipts { version: 1; books: string[]; highlights: string[] }
/** Tombstones are the durable work list. Receipts never erase the original deletion markers. */
export function retryRecordedDeletions(storage: Storage, cloud: Cloud, cancelled: () => boolean = () => false, limit = 20) {
  const key = storage.storageKey(KEY);
  const operation = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const [library, notes, entry] = await Promise.all([createLibraryStore(storage).load(), createHighlightArchive(storage).load(), storage.loadJSONEntryStrict(KEY)]);
    const value = entry.present ? entry.value as Receipts : { version: 1 as const, books: [], highlights: [] };
    if (!value || value.version !== 1 || !['books', 'highlights'].every(k => Array.isArray(value[k as 'books' | 'highlights']) && value[k as 'books' | 'highlights'].every(id => typeof id === 'string'))) throw Error('Saved account cleanup progress could not be read.');
    const receipts: Receipts = { version: 1, books: [...value.books], highlights: [...value.highlights] };
    const pending = [
      ...library.removedBookIds.filter(id => !receipts.books.includes(id)).map(id => ({ kind: 'books' as const, id })),
      ...notes.removedIds.filter(id => !receipts.highlights.includes(id)).map(id => ({ kind: 'highlights' as const, id })),
    ];
    let confirmed = 0, failed = 0;
    for (const item of pending.slice(0, Math.max(1, Math.min(100, limit)))) {
      if (cancelled()) break;
      let success = false;
      try { success = await (item.kind === 'books' ? cloud.deleteBookFromSupabase(item.id) : cloud.deleteHighlightFromSupabase(item.id)); } catch { /* Keep this item pending. */ }
      if (cancelled()) break;
      if (!success) { failed++; continue; }
      receipts[item.kind].push(item.id);
      // A receipt is acknowledged per deletion. An interrupted batch safely retries the rest.
      await storage.saveJSONStrict(KEY, receipts);
      confirmed++;
    }
    return { pending: pending.length - confirmed, failed };
  });
  const settled = operation.then(() => undefined, () => undefined); queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return operation;
}
