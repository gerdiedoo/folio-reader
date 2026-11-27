import type { CatalogBook, CatalogPage } from './catalog';
import { withArchiveLock } from './archiveQueue';

interface CacheStorage {
  storageKey(key: string): string;
  loadJSON(key: string): Promise<unknown>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
export interface SavedDiscoveryPage { page: CatalogPage; savedAt: number }
export interface DiscoveryPageCache {
  read(url: string): Promise<SavedDiscoveryPage | undefined>;
  write(url: string, page: CatalogPage): Promise<void>;
}
const KEY = 'catalog.openlibrary.pages';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, limit = 12) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, limit).map(v => v.slice(0, 200)) : [];
function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 3000) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://openlibrary.org' && ['/search.json', '/trending/now.json', '/trending/daily.json'].includes(url.pathname) && !url.username && !url.password &&
      [...url.searchParams.keys()].every(key => ['q', 'fields', 'limit', 'page', 'sort', 'spellcheck_count'].includes(key));
  } catch { return false; }
}
/** Store public work metadata only, never source downloads or reader credentials. */
function publicPage(value: unknown): CatalogPage | undefined {
  if (!object(value) || !Array.isArray(value.books) || value.books.length > 24 || typeof value.hasMore !== 'boolean' ||
    !(value.total === null || Number.isSafeInteger(value.total) && Number(value.total) >= 0)) return;
  const books: CatalogBook[] = [];
  for (const book of value.books) {
    if (!object(book) || book.source !== 'openlibrary' || typeof book.openLibraryWorkId !== 'string' || !/^OL\d+W$/.test(book.openLibraryWorkId) ||
      book.id !== `openlibrary-${book.openLibraryWorkId}` || typeof book.title !== 'string' || !book.title.trim() || typeof book.author !== 'string') return;
    const coverUrl = typeof book.coverUrl === 'string' && /^https:\/\/covers\.openlibrary\.org\/b\/id\/[1-9]\d*-L\.jpg\?default=false$/.test(book.coverUrl) ? book.coverUrl : '';
    books.push({ id: book.id as string, openLibraryWorkId: book.openLibraryWorkId, sourceRecordId: book.openLibraryWorkId,
      source: 'openlibrary', catalogKind: 'work', title: book.title.slice(0, 500), author: book.author.slice(0, 500), authors: strings(book.authors),
      coverUrl, epubUrl: '', epubEditions: [], downloads: 0, subjects: [], languages: strings(book.languages),
      archiveIds: strings(book.archiveIds, 3).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id)),
      publicationYear: Number.isSafeInteger(book.publicationYear) ? Number(book.publicationYear) : undefined,
      editionCount: Number.isSafeInteger(book.editionCount) && Number(book.editionCount) > 0 ? Number(book.editionCount) : undefined,
      detailUrl: `https://openlibrary.org/works/${book.openLibraryWorkId}.json` });
  }
  if (new Set(books.map(book => book.id)).size !== books.length) return;
  return { books, hasMore: value.hasMore, total: value.total as number | null, ...(value.collection === 'trending' ? { collection: 'trending' as const } : {}) };
}
export function createDiscoveryPageCache(storage: Partial<CacheStorage>, clock = Date.now): DiscoveryPageCache | undefined {
  if (!storage.storageKey || !storage.loadJSON || !storage.saveJSONStrict) return;
  const io = storage as CacheStorage;
  const locked = <T,>(work: () => Promise<T>) => withArchiveLock(io.storageKey(KEY), work);
  const readEntries = async () => {
    const value = await io.loadJSON(KEY);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.pages)) return [];
    return value.pages.slice(0, 12).flatMap(entry => {
      if (!object(entry) || !validUrl(entry.url) || typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt) ||
        entry.savedAt > clock() + 60000 || clock() - entry.savedAt > MAX_AGE) return [];
      const page = publicPage(entry.page);
      return page ? [{ url: entry.url, savedAt: entry.savedAt, page }] : [];
    });
  };
  return {
    read: url => locked(async () => {
      if (!validUrl(url)) return undefined;
      try {
        const saved = (await readEntries()).find(entry => entry.url === url);
        return saved ? { page: saved.page, savedAt: saved.savedAt } : undefined;
      } catch { return undefined; }
    }),
    write: (url, page) => locked(async () => {
      if (!validUrl(url)) return;
      const clean = publicPage(page);
      if (!clean) return;
      const entries = await readEntries();
      await io.saveJSONStrict(KEY, { version: 1, pages: [{ url, savedAt: clock(), page: clean }, ...entries.filter(entry => entry.url !== url)].slice(0, 12) });
    }),
  };
}
