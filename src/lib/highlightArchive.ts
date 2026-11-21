import { canonical as stableValue } from './stableValue';
import { withArchiveLock } from './archiveQueue';
import type { HighlightEntry } from '../types';
import { validSourceAnchor } from './sourceAnchors';

interface ArchiveStorage {
  storageKey(key: string): string;
  subscribeArchive?(key: string, callback: () => void): () => void;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
interface Archive {
  version: 1;
  items: HighlightEntry[];
  removedIds: string[];
  removedBookIds: string[];
}
const KEY = 'highlightArchive';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validHighlight(value: unknown): value is HighlightEntry {
  if (!record(value)) return false;
  return typeof value.id === 'string' && Boolean(value.id) &&
    typeof value.bookId === 'string' && Boolean(value.bookId) &&
    ['bookTitle', 'chapter', 'text', 'colorName', 'colorHex', 'dateAdded'].every(key => typeof value[key] === 'string') &&
    Boolean((value.text as string).trim()) && Number.isInteger(value.page) && (value.page as number) >= 1 &&
    (value.note == null || typeof value.note === 'string') &&
    (value.anchor === undefined || validSourceAnchor(value.anchor)) &&
    (value.loc == null || (typeof value.loc === 'number' && Number.isFinite(value.loc) && value.loc >= 0));
}

function highlights(value: unknown): HighlightEntry[] {
  if (!Array.isArray(value) || !value.every(validHighlight)) throw new Error('Saved highlights could not be read.');
  const ids = new Set<string>();
  for (const item of value) {
    if (ids.has(item.id)) throw new Error('Duplicate saved highlight identifiers.');
    ids.add(item.id);
  }
  return value.map(item => ({ ...item, note: item.note ?? undefined, loc: item.loc ?? undefined }));
}
function identifiers(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(id => typeof id === 'string' && Boolean(id)) && new Set(value).size === value.length;
}

/** One durable record holds notes and deletion markers, scoped by the caller's store. */
export function createHighlightArchive(storage: ArchiveStorage) {
  const queueKey = storage.storageKey(KEY);
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => withArchiveLock(queueKey, work);
  const read = async (): Promise<Archive> => {
    const entry = await storage.loadJSONEntryStrict(KEY);
    if (!entry.present) {
      // The earlier per-account array stays intact; never import unattributed v1 data.
      const legacy = await storage.loadJSONEntryStrict('highlights');
      return { version: 1, items: legacy.present ? highlights(legacy.value) : [], removedIds: [], removedBookIds: [] };
    }
    const saved = entry.value;
    if (!record(saved) || saved.version !== 1 || !identifiers(saved.removedIds) || !identifiers(saved.removedBookIds)) throw new Error('Saved highlight archive could not be read.');
    const removedIds = saved.removedIds, removedBookIds = saved.removedBookIds;
    const items = highlights(saved.items);
    if (items.some(item => removedIds.includes(item.id) || removedBookIds.includes(item.bookId))) throw new Error('Saved highlight archive is inconsistent.');
    return { version: 1, items, removedIds, removedBookIds };
  };
  const update = (change: (current: Archive) => Archive) => enqueue(async () => {
    const current = await read();
    const next = change(current);
    if (next !== current) await storage.saveJSONStrict(KEY, next);
    return next;
  });
  return {
    load: () => enqueue(read),
    add: (entry: HighlightEntry) => update(current => {
      const existing = current.items.find(item => item.id === entry.id);
      if (existing && stableValue(existing) === stableValue({ ...entry, note: entry.note ?? undefined, loc: entry.loc ?? undefined })) return current;
      if (!validHighlight(entry) || current.items.some(item => item.id === entry.id) || current.removedIds.includes(entry.id) || current.removedBookIds.includes(entry.bookId)) throw new Error('This highlight cannot be added.');
      return { ...current, items: [{ ...entry }, ...current.items] };
    }),
    note: (id: string, note: string) => update(current => {
      if (!note.trim() || !current.items.some(item => item.id === id)) throw new Error('This highlight is unavailable.');
      return { ...current, items: current.items.map(item => item.id === id ? { ...item, note } : item) };
    }),
    remove: (id: string) => update(current => {
      if (!id) throw new Error('Invalid highlight.');
      return { ...current, items: current.items.filter(item => item.id !== id), removedIds: [...new Set([...current.removedIds, id])] };
    }),
    removeBook: (bookId: string) => update(current => {
      if (!bookId) throw new Error('Invalid book.');
      return {
        ...current, items: current.items.filter(item => item.bookId !== bookId),
        removedIds: [...new Set([...current.removedIds, ...current.items.filter(item => item.bookId === bookId).map(item => item.id)])],
        removedBookIds: [...new Set([...current.removedBookIds, bookId])],
      };
    }),
    mergeRemote: (remote: unknown[]) => {
      let skipped = 0;
      return update(current => {
        const ids = new Set(current.items.map(item => item.id));
        const removed = new Set(current.removedIds);
        const added: HighlightEntry[] = [];
        for (const item of remote) {
          if (!validHighlight(item)) { skipped++; continue; }
          if (current.removedBookIds.includes(item.bookId)) { removed.add(item.id); continue; }
          if (removed.has(item.id) || ids.has(item.id)) continue;
          added.push({ ...item, note: item.note ?? undefined, loc: item.loc ?? undefined });
          ids.add(item.id);
        }
        if (!added.length && removed.size === current.removedIds.length) return current;
        return { ...current, items: [...current.items, ...added], removedIds: [...removed] };
      }).then(archive => ({ ...archive, skipped }));
    },
  };
}
