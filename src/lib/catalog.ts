import { File, Paths } from 'expo-file-system';
import { loadJSON, saveJSON } from './localStore';

/**
 * Free book catalog: Project Gutenberg (public-domain books) through the open Gutendex API.
 * https://gutendex.com  — no API key, JSON, and every result links straight to an EPUB.
 *
 * Everything here is source-agnostic on purpose (CatalogBook / searchCatalog / downloadEpub),
 * so another legal source such as Standard Ebooks or the Internet Archive can be added later
 * by returning the same shape.
 */

const API = 'https://gutendex.com/books/';
const EPUB_MIME = 'application/epub+zip';
const REQUEST_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHED_PAGES = 60;
const pageCache = new Map<string, { page: CatalogPage; cachedAt: number }>();

export interface CatalogBook {
  /** Stable id across sessions, e.g. "gutenberg-1342". */
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  epubUrl: string;
  downloads: number;
  subjects: string[];
}

export interface LibraryBackupEntry {
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
  restored: number;
  skipped: number;
  alreadyInLibrary: number;
  lookupFailed: number;
  failures: LibraryRestoreFailure[];
}

export interface CatalogPage {
  books: CatalogBook[];
  hasMore: boolean;
  total: number;
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

interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string }[];
  subjects?: string[];
  download_count?: number;
  formats: Record<string, string>;
}

/** "Austen, Jane" → "Jane Austen" */
function tidyAuthor(raw: string | undefined): string {
  if (!raw) return 'Unknown Author';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return raw.trim();
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

function mapBook(b: GutendexBook): CatalogBook | null {
  const epub = b.formats?.[EPUB_MIME];
  if (!epub) return null;
  return {
    id: `gutenberg-${b.id}`,
    title: (b.title || 'Untitled').replace(/\s+/g, ' ').trim(),
    author: tidyAuthor(b.authors?.[0]?.name),
    coverUrl: b.formats['image/jpeg'] ? toHttps(b.formats['image/jpeg']) : '',
    epubUrl: toHttps(epub),
    downloads: b.download_count ?? 0,
    subjects: b.subjects ?? [],
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      const error = new Error('The catalog request was cancelled.');
      error.name = 'AbortError';
      throw error;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const error = new Error(`The catalog returned an error (${res.status}).`);
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) continue;
        throw error;
      }
      return (await res.json()) as T;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timedOut) throw new Error('The catalog took too long to respond. Please try again.');
      lastError = err;
      if (attempt === 1) {
        throw lastError instanceof Error ? lastError : new Error('Could not reach the catalog.');
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not reach the catalog.');
}

export async function searchCatalog(
  opts: { query?: string; topic?: string; page?: number; sort?: CatalogSort },
  signal?: AbortSignal
): Promise<CatalogPage> {
  const params = new URLSearchParams();
  const q = opts.query?.trim();
  if (q) params.set('search', q);
  if (opts.topic) params.set('topic', opts.topic);
  params.set('languages', 'en');
  params.set('mime_type', EPUB_MIME);
  params.set('sort', opts.sort ?? 'popular');
  params.set('page', String(opts.page ?? 1));

  const url = `${API}?${params.toString()}`;
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    pageCache.delete(url);
    pageCache.set(url, cached);
    return cached.page;
  }

  const data = await fetchJson<{ count: number; next: string | null; results: GutendexBook[] }>(url, signal);
  const books = (data.results ?? []).map(mapBook).filter((b): b is CatalogBook => b !== null);
  const page = { books, hasMore: !!data.next, total: data.count ?? books.length };
  pageCache.set(url, { page, cachedAt: Date.now() });
  if (pageCache.size > MAX_CACHED_PAGES) {
    const oldest = pageCache.keys().next().value;
    if (oldest) pageCache.delete(oldest);
  }
  return page;
}

export async function getCatalogBook(gutenbergId: number): Promise<CatalogBook | null> {
  try {
    const data = await fetchJson<GutendexBook>(`${API}${gutenbergId}/`);
    return mapBook(data);
  } catch (err) {
    if (err instanceof Error && err.message.includes('(404)')) return null;
    throw err;
  }
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
export async function downloadEpub(book: CatalogBook, onProgress?: (percent: number) => void): Promise<string> {
  const safeId = book.id.replace(/[^a-z0-9-]/gi, '');
  const dest = new File(Paths.cache, `catalog-${safeId}-${Date.now()}.epub`);
  let lastReportedPercent = -1;
  const task = File.createDownloadTask(book.epubUrl, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (!onProgress || totalBytes <= 0) return;
      const percent = Math.min(100, Math.floor((bytesWritten / totalBytes) * 100));
      if (percent >= lastReportedPercent + 1) {
        lastReportedPercent = percent;
        onProgress(percent);
      }
    },
  });
  try {
    const file = await task.downloadAsync();
    if (!file || !file.exists || file.size < 1024) {
      throw new Error('The download looks incomplete. Please try again.');
    }
    onProgress?.(100);
    return file.uri;
  } finally {
    task.release();
  }
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

/** catalog id → library book id, persisted so the Browse screen can show "Read" instead of "Get". */
export async function loadAdded(): Promise<Record<string, string>> {
  return (await loadJSON<Record<string, string>>(ADDED_KEY)) ?? {};
}

export async function rememberAdded(
  current: Record<string, string>,
  catalogId: string,
  bookId: string
): Promise<Record<string, string>> {
  const next = { ...current, [catalogId]: bookId };
  await saveJSON(ADDED_KEY, next);
  return next;
}
