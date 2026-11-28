import { File, Paths } from 'expo-file-system';
import type { ReadingPosition } from '../types';
import { loadJSON, saveJSON } from './localStore';
import type { LocalStore } from './localStore';

import { starterBooks } from '../data/freeBooks';
import { archiveEpubLinks, archiveSearchUrl, gutenbergBook, parseArchivePage, parseGutenbergPage, parseStandardPage, standardEpubLinks, standardSearchUrl, sourceUrl } from './catalogProviders';
import { CatalogError, catalogCancelled, catalogRequest } from './catalogRequest';
import { archiveBookDetails, standardBookDetails } from './catalogDetails';
import { extraBookDetails, extraEpubLinks, extraSource, searchExtraCatalog, type CatalogAccess } from './extraCatalog';
import { createDiscoveryCatalog } from './discoveryCatalog';
export { CATALOG_SOURCES } from './catalogProviders';

const API = 'https://gutendex.com/books/';
const EPUB_MIME = 'application/epub+zip';
const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHED_PAGES = 60;
const pageCache = new Map<string, { page: CatalogPage; cachedAt: number }>();
export type CatalogSource = 'gutenberg' | 'standard' | 'archive' | 'openlibrary' | 'google' | 'oapen' | 'doab' | 'wikisource' | 'feedbooks';

export interface CatalogBook {
  catalogKind?: 'work';
  openLibraryWorkId?: string;
  authors?: string[];
  publicationYear?: number;
  editionCount?: number;
  epubEditions?: CatalogBook[];
  discoveryWorkId?: string;
  useDiscoveryCover?: boolean;
  sourceRecordId?: string;
  archiveIds?: string[];
  exportTitle?: string;
  /** Stable id across sessions, e.g. "gutenberg-1342". */
  id: string;
  source?: CatalogSource;
  detailUrl?: string;
  title: string;
  author: string;
  coverUrl: string;
  epubUrl: string;
  downloads: number;
  subjects: string[];
  description?: string;
  languages?: string[];
}

export interface LibraryBackupEntry {
  documentFingerprint?: string;
  readingPosition?: Pick<ReadingPosition, 'pageNumber' | 'wordOffset' | 'anchor'>;
  title: string;
  author: string;
  gutenbergId?: number;
  currentPage?: number;
  progressPercent?: number;
  currentChapter?: string;
  currentLoc?: number;
  isFinished?: boolean;
}

export interface LibraryRestoreProgress {
  current: number;
  total: number;
  percent: number;
  title: string;
  phase: 'loading' | 'finding' | 'downloading' | 'preparing' | 'complete';
}

export interface LibraryRestoreFailure {
  title: string;
  reason: string;
  entry: LibraryBackupEntry;
}

export interface LibraryRecoveryBook extends LibraryBackupEntry {
  id: string;
  reason: string;
}

export interface LibraryRestoreResult {
  readingPositionsNotRestored?: number;
  restored: number;
  skipped: number;
  alreadyInLibrary: number;
  lookupFailed: number;
  failures: LibraryRestoreFailure[];
}

export interface CatalogPage {
  collection?: 'trending';
  books: CatalogBook[];
  hasMore: boolean;
  total: number | null;
  notice?: string;
  noticeKind?: 'info' | 'recovery';
}

export type CatalogSort = 'popular' | 'ascending' | 'descending';

export interface CatalogTopic {
  id: string;
  label: string;
  /** Gutendex `topic` filter (matches subjects and bookshelves). Empty = most popular overall. */
  topic: string;
}

export const TOPICS: CatalogTopic[] = [
  { id: 'popular', label: 'Popular', topic: '' },
  { id: 'fiction', label: 'Fiction', topic: 'fiction' },
  { id: 'mystery', label: 'Mystery', topic: 'detective and mystery' },
  { id: 'scifi', label: 'Sci-Fi', topic: 'science fiction' },
  { id: 'adventure', label: 'Adventure', topic: 'adventure' },
  { id: 'romance', label: 'Romance', topic: 'love stories' },
  { id: 'horror', label: 'Gothic & Horror', topic: 'horror' },
  { id: 'philosophy', label: 'Philosophy', topic: 'philosophy' },
  { id: 'history', label: 'History', topic: 'history' },
  { id: 'poetry', label: 'Poetry', topic: 'poetry' },
  { id: 'children', label: "Children's", topic: 'children' },
  { id: 'drama', label: 'Plays', topic: 'drama' },
];

// ---------------------------------------------------------------------------
// Search / browse
// ---------------------------------------------------------------------------

export async function searchCatalog(
  opts: { query?: string; topic?: string; page?: number; sort?: CatalogSort; source?: CatalogSource; googleBooksKey?: string | null },
  signal?: AbortSignal
): Promise<CatalogPage> {
  if (signal?.aborted) throw catalogCancelled();
  const source = opts.source ?? 'gutenberg';
  const query = (opts.query ?? '').trim().slice(0, 200);
  const topic = opts.topic ?? '';
  const pageNumber = Number.isSafeInteger(opts.page) && opts.page! > 0 ? opts.page! : 1;
  const sort = opts.sort ?? 'popular';
  if (extraSource(source)) return searchExtraCatalog(source, query, topic, pageNumber, sort, { googleBooksKey: opts.googleBooksKey }, signal);
  const params = new URLSearchParams({ languages: 'en', mime_type: EPUB_MIME, sort, page: String(pageNumber) });
  if (query) params.set('search', query);
  if (topic) params.set('topic', topic);
  const url = source === 'standard' ? standardSearchUrl(query, topic, pageNumber, sort)
    : source === 'archive' ? archiveSearchUrl(query, topic, pageNumber, sort) : `${API}?${params}`;
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.page;
  try {
    const data = await catalogRequest(url, source === 'standard' ? 'text' : 'json', signal);
    let page: CatalogPage;
    try { page = source === 'standard' ? parseStandardPage(data as string) : source === 'archive' ? parseArchivePage(data, pageNumber) : parseGutenbergPage(data); }
    catch { throw new CatalogError('invalid'); }
    if (signal?.aborted) throw catalogCancelled();
    pageCache.set(url, { page, cachedAt: Date.now() });
    if (pageCache.size > MAX_CACHED_PAGES) pageCache.delete(pageCache.keys().next().value!);
    return page;
  } catch (error) {
    if (signal?.aborted) throw catalogCancelled();
    if (pageNumber !== 1) throw error; // Never append a fallback as another page.
    const reason = error instanceof Error ? error.message : 'The source could not be reached.';
    if (cached) return { ...cached.page, notice: `Showing a previously loaded catalog. ${reason}` };
    if (source === 'gutenberg') {
      const books = starterBooks(query, topic);
      return { books, hasMore: false, total: books.length, notice: `Gutenberg’s live catalog is unavailable. Showing matches from a small starter collection; downloads still require a connection. ${reason}` };
    }
    throw error;
  }
}

export async function getCatalogBook(gutenbergId: number): Promise<CatalogBook | null> {
  if (!Number.isSafeInteger(gutenbergId) || gutenbergId < 1) return null;
  try { return gutenbergBook(await catalogRequest(`${API}${gutenbergId}/`, 'json')); }
  catch (error) {
    if (error instanceof CatalogError && error.kind === 'unavailable') return null;
    throw error;
  }
}

const detailCache = new Map<string, { book: CatalogBook; cachedAt: number }>();
export async function loadCatalogBookDetails(book: CatalogBook, signal?: AbortSignal, access: CatalogAccess = {}): Promise<CatalogBook> {
  if (signal?.aborted) throw catalogCancelled();
  // A Google key belongs to one reader; do not reuse an earlier reader's access check.
  if (book.source && extraSource(book.source)) return extraBookDetails(book, access, signal);
  const cached = detailCache.get(book.id);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.book;
  let details: CatalogBook;
  if (book.source === 'standard') {
    const url = sourceUrl(book.detailUrl, ['standardebooks.org']);
    if (!url || !/^\/ebooks\/[a-z0-9-]+\/[a-z0-9_/-]+$/.test(new URL(url).pathname)) throw new CatalogError('invalid');
    details = standardBookDetails(await catalogRequest(url, 'text', signal) as string, book);
  } else if (book.source === 'archive') {
    const id = book.id.replace(/^archive-/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id)) throw new CatalogError('invalid');
    details = archiveBookDetails(await catalogRequest(`https://archive.org/metadata/${encodeURIComponent(id)}`, 'json', signal), book);
  } else {
    const id = /^gutenberg-(\d+)$/.exec(book.id)?.[1];
    if (!id) throw new CatalogError('invalid');
    const result = gutenbergBook(await catalogRequest(`${API}${id}/`, 'json', signal));
    if (!result || result.id !== book.id) throw new CatalogError('invalid');
    details = result;
  }
  if (signal?.aborted) throw catalogCancelled();
  detailCache.set(book.id, { book: details, cachedAt: Date.now() });
  if (detailCache.size > MAX_CACHED_PAGES) detailCache.delete(detailCache.keys().next().value!);
  return details;
}

function normalizeCatalogText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function findCatalogBook(title: string, author: string): Promise<CatalogBook | null> {
  const page = await searchCatalog({ query: title });
  const normalizedTitle = normalizeCatalogText(title);
  const normalizedAuthor = normalizeCatalogText(author);
  return page.books.find((book) =>
    normalizeCatalogText(book.title) === normalizedTitle &&
    (!normalizedAuthor || normalizedAuthor === 'unknown author' ||
      normalizeCatalogText(book.author) === normalizedAuthor)
  ) ?? null;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Downloads the EPUB into the cache folder and returns its file:// URI, ready for
 * `parseEpubFile`. The caller should `deleteDownloaded` it once the book is imported.
 */
async function epubLinks(book: CatalogBook, signal?: AbortSignal, access: CatalogAccess = {}): Promise<string[]> {
  if (book.source && extraSource(book.source)) return extraEpubLinks(book, access, signal);
  if (book.source === 'standard') {
    const detail = sourceUrl(book.detailUrl, ['standardebooks.org']);
    if (!detail) throw new CatalogError('unavailable');
    const links = standardEpubLinks(await catalogRequest(detail, 'text', signal) as string, detail);
    if (!links.length) throw new CatalogError('unavailable');
    return links;
  }
  if (book.source === 'archive') {
    const identifier = book.id.replace(/^archive-/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(identifier)) throw new CatalogError('unavailable');
    const links = archiveEpubLinks(await catalogRequest(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, 'json', signal), identifier);
    if (!links.length) throw new CatalogError('unavailable');
    return links;
  }
  const id = /^gutenberg-(\d+)$/.exec(book.id)?.[1];
  const supplied = sourceUrl(book.epubUrl, ['www.gutenberg.org', 'gutenberg.org']);
  return [...new Set([...(id ? [`https://www.gutenberg.org/ebooks/${id}.epub3.images`] : []), supplied, ...(id ? [`https://www.gutenberg.org/ebooks/${id}.epub.images`] : [])].filter(Boolean))].slice(0, 3);
}

const discovery = createDiscoveryCatalog({ search: searchCatalog, details: loadCatalogBookDetails, links: epubLinks });
export const searchDiscovery = discovery.search;
export const loadDiscoveryDetails = discovery.details;
export const checkDiscoverySource = discovery.checkSource;

/** Bounded, cancellable transfers. Reject HTML error pages before EPUB parsing. */
export async function downloadEpub(book: CatalogBook, onProgress?: (percent: number) => void, signal?: AbortSignal, access: CatalogAccess = {}): Promise<string> {
  if (signal?.aborted) throw catalogCancelled();
  const links = await epubLinks(book, signal, access);
  if (!links.length) throw new CatalogError('unavailable');
  let lastError: unknown;
  for (const [attempt, url] of links.entries()) {
    if (signal?.aborted) throw catalogCancelled();
    const dest = new File(Paths.cache, `catalog-${book.id.replace(/[^a-z0-9-]/gi, '').slice(0, 100)}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.epub`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, onAbort: () => void;
    let completed = false;
    let expired = false;
    const clean = () => { try { if (dest.exists) dest.delete(); } catch { /* disposable cache */ } };
    let rejectStopped: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStopped = reject;
      onAbort = () => { expired = true; reject(catalogCancelled()); controller.abort(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { expired = true; reject(new CatalogError('timeout')); controller.abort(); }, book.source === 'wikisource' ? 120000 : 60000);
    });
    let task: ReturnType<typeof File.createDownloadTask> | undefined;
    try {
      onProgress?.(0);
      task = File.createDownloadTask(url, dest, { signal: controller.signal, headers: { Accept: EPUB_MIME },
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (expired) return;
          if (bytesWritten > 40 * 1024 * 1024 || totalBytes > 40 * 1024 * 1024) { expired = true; rejectStopped(new CatalogError('size')); controller.abort(); return; }
          if (totalBytes > 0) onProgress?.(Math.max(0, Math.min(99, Math.floor(bytesWritten / totalBytes * 100))));
        } });
      const transfer = task.downloadAsync().then(file => {
        if (expired || signal?.aborted) { clean(); throw catalogCancelled(); }
        return file;
      });
      const file = await Promise.race([transfer, stopped]);
      if (!file || !file.exists || file.size < 22) throw new CatalogError('file');
      if (file.size > 40 * 1024 * 1024) throw new CatalogError('size');
      const handle = file.open();
      let signature: Uint8Array;
      try { signature = handle.readBytes(4); } finally { handle.close(); }
      if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) throw new CatalogError('file');
      completed = true;
      onProgress?.(100);
      return file.uri;
    } catch (error) {
      if (signal?.aborted) throw catalogCancelled();
      lastError = error instanceof CatalogError ? error : new CatalogError(/429/.test(String(error)) ? 'rate' : 'file');
      if (lastError instanceof CatalogError && ['timeout', 'rate', 'size'].includes(lastError.kind)) throw lastError;
      if (attempt === links.length - 1) throw lastError;
    } finally {
      clearTimeout(timer!);
      signal?.removeEventListener('abort', onAbort!);
      controller.abort();
      try { task?.release(); } catch { /* Cleanup must not mask the transfer result. */ }
      if (!completed) clean();
    }
  }
  throw lastError ?? new CatalogError('file');
}

export function deleteDownloaded(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* cache files are disposable */
  }
}

// ---------------------------------------------------------------------------
// "Already in my library" bookkeeping
// ---------------------------------------------------------------------------

const ADDED_KEY = 'catalog.added';

/** catalog id → library book id, persisted for Browse membership badges and the Read action in details. */
export async function loadAdded(storage: Pick<LocalStore, 'loadJSON' | 'saveJSON'> = { loadJSON, saveJSON }): Promise<Record<string, string>> {
  const value = await storage.loadJSON<unknown>(ADDED_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, id]) => /^(gutenberg-|standard-|archive-|openlibrary-|google-|oapen-|doab-|wikisource-|feedbooks-)/.test(key) && typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id)));
}

export async function rememberAdded(
  current: Record<string, string>,
  catalogId: string,
  bookId: string,
  storage: Pick<LocalStore, 'loadJSON' | 'saveJSON'> & Partial<Pick<LocalStore, 'saveJSONStrict'>> = { loadJSON, saveJSON }
): Promise<Record<string, string>> {
  const next = { ...current, [catalogId]: bookId };
  await (storage.saveJSONStrict ?? storage.saveJSON)(ADDED_KEY, next);
  return next;
}
