import type { BookContentPage, Bookmark } from '../types';

const STORAGE_KEY = 'folio.v1.bookmarks';
interface BookmarkStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createBookmark(bookId: string, page: BookContentPage): Bookmark {
  return {
    id: `${bookId}:${page.pageNumber}`,
    bookId,
    pageNumber: page.pageNumber,
    locNumber: page.locNumber,
    chapterTitle: page.chapterTitle,
    excerpt: [page.dropCap + page.paragraph1, page.paragraph2Lead + page.highlightedText + page.paragraph2Rest]
      .join(' ').replace(/\s+/g, ' ').trim().slice(0, 180),
    createdAt: new Date().toISOString(),
  };
}

export function findBookmarkPage(bookmark: Bookmark, pages: BookContentPage[]): number {
  return pages.findIndex(page => page.pageNumber === bookmark.pageNumber && page.locNumber === bookmark.locNumber);
}

function readBookmarks(raw: string | null): Bookmark[] {
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error('Invalid bookmark storage');
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.bookId !== 'string' || !record.bookId ||
        !Number.isInteger(record.pageNumber) || record.pageNumber < 1 ||
        !Number.isFinite(record.locNumber) || record.locNumber < 0 ||
        record.id !== `${record.bookId}:${record.pageNumber}` || ids.has(record.id) ||
        typeof record.chapterTitle !== 'string' || typeof record.excerpt !== 'string' ||
        typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) {
      throw new Error('Invalid bookmark storage');
    }
    ids.add(record.id);
  }
  return records as Bookmark[];
}

export function createBookmarkStore(storage: BookmarkStorage) {
  let cache: Bookmark[] | undefined;
  let reading: Promise<Bookmark[]> | undefined;
  let pending = Promise.resolve();
  const load = async (): Promise<Bookmark[]> => {
    if (cache) return cache;
    if (!reading) {
      reading = storage.getItem(STORAGE_KEY).then(raw => {
        cache = readBookmarks(raw);
        return cache;
      }).finally(() => { reading = undefined; });
    }
    return reading;
  };
  const update = (change: (current: Bookmark[]) => Bookmark[]) => {
    const operation = pending.then(async () => {
      const next = change(await load());
      // Commit the in-memory snapshot only after durable storage succeeds.
      await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      cache = next;
      return next;
    });
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return {
    load,
    toggle: (bookmark: Bookmark) => update(current => current.some(item => item.id === bookmark.id)
      ? current.filter(item => item.id !== bookmark.id) : [...current, bookmark]),
    remove: (id: string) => update(current => current.filter(item => item.id !== id)),
    removeBook: (bookId: string) => update(current => current.filter(item => item.bookId !== bookId)),
  };
}
