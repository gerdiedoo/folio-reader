import { withArchiveLock } from './archiveQueue';
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

export function createBookmarkStore(storage: BookmarkStorage, storageKey = STORAGE_KEY) {
  const load = () => withArchiveLock(storageKey, async () => readBookmarks(await storage.getItem(storageKey)));
  const update = (change: (current: Bookmark[]) => Bookmark[]) => withArchiveLock(storageKey, async () => {
    const next = change(readBookmarks(await storage.getItem(storageKey)));
    await storage.setItem(storageKey, JSON.stringify(next));
    return next;
  });
  return {
    load,
    toggle: (bookmark: Bookmark) => update(current => current.some(item => item.id === bookmark.id)
      ? current.filter(item => item.id !== bookmark.id) : [...current, bookmark]),
    remove: (id: string) => update(current => current.filter(item => item.id !== id)),
    removeBook: (bookId: string) => update(current => current.filter(item => item.bookId !== bookId)),
  };
}
