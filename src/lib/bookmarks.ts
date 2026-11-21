import type { BookContentPage, Bookmark } from '../types';
import { resolveSourceAnchor, sourceAnchorForPosition, validSourceAnchor } from './sourceAnchors';

const STORAGE_KEY = 'folio.v1.bookmarks';
interface BookmarkStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createBookmark(bookId: string, page: BookContentPage): Bookmark {
  const anchor = sourceAnchorForPosition(page);
  return {
    ...(anchor ? { anchor } : {}),
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
  if (bookmark.anchor) return resolveSourceAnchor(bookmark.anchor, pages)?.index ?? -1;
  return pages.findIndex(page => page.pageNumber === bookmark.pageNumber && page.locNumber === bookmark.locNumber);
}

export function readBookmarks(raw: string | null): Bookmark[] {
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
        typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
        (record.anchor !== undefined && !validSourceAnchor(record.anchor))) {
      throw new Error('Invalid bookmark storage');
    }
    ids.add(record.id);
  }
  return records as Bookmark[];
}

const storageQueues = new WeakMap<BookmarkStorage, Map<string, Promise<void>>>();

export function createBookmarkStore(storage: BookmarkStorage, storageKey = STORAGE_KEY) {
  let queues = storageQueues.get(storage);
  if (!queues) { queues = new Map(); storageQueues.set(storage, queues); }
  const queue = queues;
  const load = async (): Promise<Bookmark[]> => {
    await queue.get(storageKey);
    return readBookmarks(await storage.getItem(storageKey));
  };
  const update = (change: (current: Bookmark[]) => Bookmark[]) => {
    const operation = (queue.get(storageKey) ?? Promise.resolve()).then(async () => {
      // Read durable state inside the queue; an older mounted instance may have saved.
      const next = change(readBookmarks(await storage.getItem(storageKey)));
      await storage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
    const settled = operation.then(() => undefined, () => undefined);
    queue.set(storageKey, settled);
    void settled.then(() => { if (queue.get(storageKey) === settled) queue.delete(storageKey); });
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
