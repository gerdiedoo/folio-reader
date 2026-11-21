import { canonical as stableValue } from './stableValue';
import { withArchiveLock } from './archiveQueue';
import type { LexiconEntry } from '../types';
import { validSourceAnchor } from './sourceAnchors';

interface ArchiveStorage {
  storageKey(key: string): string;
  subscribeArchive?(key: string, callback: () => void): () => void;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
interface Archive { version: 1; items: LexiconEntry[]; removedBookIds: string[] }
const KEY = 'lexiconArchive';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
type StoredEntry = Omit<LexiconEntry, 'phonetic' | 'partOfSpeech' | 'contextPassage' | 'chapter'> & {
  phonetic?: string | null; partOfSpeech?: string | null; contextPassage?: string | null; chapter?: string | null;
};

export function validLexiconEntry(value: unknown): value is StoredEntry {
  if (!record(value)) return false;
  return typeof value.id === 'string' && Boolean(value.id) && typeof value.bookId === 'string' &&
    typeof value.word === 'string' && Boolean(value.word.trim()) &&
    typeof value.definition === 'string' && Boolean(value.definition.trim()) &&
    ['phonetic', 'partOfSpeech', 'contextPassage', 'chapter'].every(key => value[key] == null || typeof value[key] === 'string') &&
    (value.page === undefined || Number.isSafeInteger(value.page) && Number(value.page) >= 1) &&
    (value.anchor === undefined || validSourceAnchor(value.anchor)) &&
    Number.isInteger(value.masteryLevel) && (value.masteryLevel as number) >= 1 && (value.masteryLevel as number) <= 5;
}
function canonical(entry: StoredEntry): LexiconEntry {
  return { ...entry, phonetic: entry.phonetic ?? '', partOfSpeech: entry.partOfSpeech ?? '', contextPassage: entry.contextPassage ?? '', chapter: entry.chapter ?? '' };
}
function entries(value: unknown): LexiconEntry[] {
  if (!Array.isArray(value) || !value.every(validLexiconEntry)) throw new Error('Saved vocabulary could not be read.');
  if (new Set(value.map(item => item.id)).size !== value.length) throw new Error('Duplicate vocabulary identifiers.');
  return value.map(canonical);
}

/** Vocabulary data and book-removal markers share one confirmed, account-scoped write. */
export function createLexiconArchive(storage: ArchiveStorage) {
  const queueKey = storage.storageKey(KEY);
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => withArchiveLock(queueKey, work);
  const read = async (): Promise<Archive> => {
    const entry = await storage.loadJSONEntryStrict(KEY);
    if (!entry.present) {
      const legacy = await storage.loadJSONEntryStrict('lexicon');
      return { version: 1, items: legacy.present ? entries(legacy.value) : [], removedBookIds: [] };
    }
    const saved = entry.value;
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.removedBookIds) ||
        !saved.removedBookIds.every(id => typeof id === 'string' && Boolean(id)) ||
        new Set(saved.removedBookIds).size !== saved.removedBookIds.length) throw new Error('Saved vocabulary archive could not be read.');
    const removedBookIds = saved.removedBookIds as string[];
    const items = entries(saved.items);
    if (items.some(item => removedBookIds.includes(item.bookId))) throw new Error('Saved vocabulary archive is inconsistent.');
    return { version: 1, items, removedBookIds };
  };
  const update = (change: (current: Archive) => Archive) => enqueue(async () => {
    const current = await read(), next = change(current);
    if (next !== current) await storage.saveJSONStrict(KEY, next);
    return next;
  });
  return {
    load: () => enqueue(read),
    add: (entry: LexiconEntry) => update(current => {
      const existing = current.items.find(item => item.id === entry.id);
      if (existing && stableValue(existing) === stableValue(canonical(entry))) return current;
      if (!validLexiconEntry(entry) || current.items.some(item => item.id === entry.id) || current.removedBookIds.includes(entry.bookId)) throw new Error('This vocabulary card cannot be added.');
      return { ...current, items: [canonical(entry), ...current.items] };
    }),
    mastery: (id: string, level: number) => update(current => {
      if (!Number.isInteger(level) || level < 1 || level > 5 || !current.items.some(item => item.id === id)) throw new Error('This mastery change is unavailable.');
      return { ...current, items: current.items.map(item => item.id === id ? { ...item, masteryLevel: level } : item) };
    }),
    removeBook: (bookId: string) => update(current => {
      if (!bookId) throw new Error('Invalid book.');
      return { ...current, items: current.items.filter(item => item.bookId !== bookId), removedBookIds: [...new Set([...current.removedBookIds, bookId])] };
    }),
    mergeRemote: (remote: unknown[]) => {
      let skipped = 0;
      return update(current => {
        const ids = new Set(current.items.map(item => item.id));
        const added: LexiconEntry[] = [];
        for (const item of remote) {
          if (!validLexiconEntry(item)) { skipped++; continue; }
          if (ids.has(item.id) || current.removedBookIds.includes(item.bookId)) continue;
          added.push(canonical(item)); ids.add(item.id);
        }
        return added.length ? { ...current, items: [...current.items, ...added] } : current;
      }).then(archive => ({ ...archive, skipped }));
    },
  };
}
