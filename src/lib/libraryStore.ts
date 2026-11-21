import type { Book } from '../types';
interface Storage {
  storageKey(key: string): string;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
interface LibraryArchive { version: 1; books: Book[]; removedBookIds: string[] }
const KEY = 'libraryArchive';
const queues = new Map<string, Promise<void>>();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function validLibraryBook(value: unknown): value is Book {
  return record(value) && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value.id) &&
    typeof value.title === 'string' && typeof value.author === 'string' && typeof value.coverUrl === 'string' &&
    Number.isSafeInteger(value.currentPage) && Number(value.currentPage) > 0 && Number.isSafeInteger(value.totalPages) && Number(value.totalPages) >= 0 &&
    typeof value.progressPercent === 'number' && Number.isFinite(value.progressPercent) && value.progressPercent >= 0 && value.progressPercent <= 100;
}
function books(value: unknown): Book[] {
  if (!Array.isArray(value) || !value.every(validLibraryBook) || new Set(value.map(book => book.id)).size !== value.length) throw Error('The saved library could not be read. Existing data has been kept.');
  return value.map(book => ({ ...book }));
}
/** All mutations read the latest durable state inside a queue shared by account/store key. */
export function createLibraryStore(storage: Storage) {
  const queueKey = storage.storageKey(KEY);
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const operation = (queues.get(queueKey) ?? Promise.resolve()).then(work);
    const settled = operation.then(() => undefined, () => undefined); queues.set(queueKey, settled);
    void settled.then(() => { if (queues.get(queueKey) === settled) queues.delete(queueKey); });
    return operation;
  };
  const read = async (): Promise<LibraryArchive> => {
    const entry = await storage.loadJSONEntryStrict(KEY);
    if (!entry.present) {
      const legacy = await storage.loadJSONEntryStrict('books');
      return { version: 1, books: legacy.present ? books(legacy.value) : [], removedBookIds: [] };
    }
    const value = entry.value;
    if (!record(value) || value.version !== 1 || !Array.isArray(value.removedBookIds) ||
      !value.removedBookIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id)) || new Set(value.removedBookIds).size !== value.removedBookIds.length) throw Error('The saved library archive could not be read.');
    const items = books(value.books), removed = value.removedBookIds as string[];
    if (items.some(book => removed.includes(book.id))) throw Error('The saved library archive is inconsistent.');
    return { version: 1, books: items, removedBookIds: removed };
  };
  const update = (change: (current: LibraryArchive) => LibraryArchive) => enqueue(async () => {
    const current = await read(), next = change(current);
    if (next !== current) await storage.saveJSONStrict(KEY, next);
    return next;
  });
  return {
    load: () => enqueue(read),
    add: (book: Book) => update(current => {
      if (!validLibraryBook(book) || current.books.some(item => item.id === book.id) || current.removedBookIds.includes(book.id)) throw Error('This book cannot be added to the saved library.');
      return { ...current, books: [{ ...book }, ...current.books] };
    }),
    patch: (id: string, patch: Partial<Omit<Book, 'id'>>) => update(current => {
      const previous = current.books.find(book => book.id === id);
      if (!previous) throw Error('This book is no longer in the saved library.');
      const next = { ...previous, ...patch, id };
      if (!validLibraryBook(next)) throw Error('This book change could not be saved.');
      return { ...current, books: current.books.map(book => book.id === id ? next : book) };
    }),
    remove: (id: string) => update(current => {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw Error('Invalid book identifier.');
      return { ...current, books: current.books.filter(book => book.id !== id), removedBookIds: [...new Set([...current.removedBookIds, id])] };
    }),
    mergeRemote: (remote: unknown[]) => {
      let skipped = 0;
      return update(current => {
        const ids = new Set(current.books.map(book => book.id)), added: Book[] = [];
        for (const book of remote) {
          if (!validLibraryBook(book)) { skipped++; continue; }
          if (ids.has(book.id) || current.removedBookIds.includes(book.id)) continue;
          added.push({ ...book }); ids.add(book.id);
        }
        return added.length ? { ...current, books: [...current.books, ...added] } : current;
      }).then(snapshot => ({ ...snapshot, skipped }));
    },
  };
}
export function readingFields(book: Book): Partial<Book> {
  return { currentPage: book.currentPage, currentChapter: book.currentChapter, currentLoc: book.currentLoc, progressPercent: book.progressPercent,
    lastOpened: book.lastOpened, readingPosition: book.readingPosition, minutesLeft: book.minutesLeft, isFinished: book.isFinished };
}
