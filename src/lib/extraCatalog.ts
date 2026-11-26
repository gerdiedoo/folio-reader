import type { CatalogBook, CatalogPage, CatalogSource, CatalogSort } from './catalog';
import { archiveEpubLinks, sourceUrl, record } from './catalogProviders';
import { archiveBookDetails } from './catalogDetails';
import { CatalogError, catalogCancelled, catalogRequest } from './catalogRequest';
import { FEEDBOOKS_HOSTS, PAGE_SIZE, REPOSITORIES, feedXml, feedbooksPage, googleBook, googlePage, list, oapenHandle, openLibraryPage, repositoryBook, repositoryEpubs, repositoryItems, text, validId, wikiEpub, wikiPage } from './extraCatalogProviders';

export type ExtraSource = Exclude<CatalogSource, 'gutenberg' | 'standard' | 'archive'>;
export interface CatalogAccess { googleBooksKey?: string | null }
export const extraSource = (source: CatalogSource): source is ExtraSource => ['openlibrary', 'google', 'oapen', 'doab', 'wikisource', 'feedbooks'].includes(source);
const googleKey = (access: CatalogAccess) => {
  const key = access.googleBooksKey?.trim();
  if (!key) throw new CatalogError('configuration');
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(key)) throw new CatalogError('configuration');
  return key;
};
function googleUrl(path: string, access: CatalogAccess): string {
  return `https://www.googleapis.com/books/v1/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(googleKey(access))}`;
}
async function json(url: string, signal?: AbortSignal) { return catalogRequest(url, 'json', signal); }
async function checkedArchive(identifier: string, signal?: AbortSignal): Promise<{ links: string[]; data: unknown }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(identifier)) throw new CatalogError('unavailable');
  const data = await json(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, signal);
  return { data, links: archiveEpubLinks(data, identifier) };
}
async function openLibraryLinks(book: CatalogBook, signal?: AbortSignal): Promise<{ book: CatalogBook; links: string[] }> {
  for (const id of book.archiveIds?.slice(0, 3) ?? []) {
    const result = await checkedArchive(id, signal);
    if (result.links.length) return { book: archiveBookDetails(result.data, book), links: result.links };
  }
  throw new CatalogError('unavailable');
}

async function repositoryFileGraph(item: Record<string, unknown>, source: 'oapen' | 'doab', signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (Array.isArray(item.bitstreams)) return item;
  const id = String(item.uuid ?? item.id ?? '');
  if (!validId(id)) throw new CatalogError('invalid');
  const origin = REPOSITORIES[source];
  const payload = await json(`${origin}/server/api/core/items/${id}/bundles?size=20`, signal);
  if (!record(payload) || !record(payload._embedded)) throw new CatalogError('invalid');
  const originals = list(payload._embedded.bundles).filter(record).filter(bundle => bundle.name === 'ORIGINAL').slice(0, 3);
  const bitstreams: Record<string, unknown>[] = [];
  for (const bundle of originals) {
    const bundleId = String(bundle.uuid ?? bundle.id ?? '');
    if (!validId(bundleId)) continue;
    const files = await json(`${origin}/server/api/core/bundles/${bundleId}/bitstreams?size=100`, signal);
    if (!record(files) || !record(files._embedded)) throw new CatalogError('invalid');
    bitstreams.push(...list(files._embedded.bitstreams).filter(record));
  }
  return { ...item, bitstreams };
}
async function repositoryItem(source: 'oapen' | 'doab', id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!validId(id)) throw new CatalogError('invalid');
  let item: unknown;
  try { item = await json(`${REPOSITORIES[source]}/rest/items/${id}?expand=metadata,bitstreams`, signal); }
  catch (error) {
    if (!(error instanceof CatalogError) || error.kind !== 'unavailable') throw error;
    item = await json(`${REPOSITORIES[source]}/server/api/core/items/${id}`, signal);
  }
  if (!record(item) || String(item.uuid ?? item.id) !== id) throw new CatalogError('invalid');
  return source === 'oapen' ? repositoryFileGraph(item, source, signal) : item;
}
async function repositoryLinks(item: Record<string, unknown>, source: 'oapen' | 'doab', signal?: AbortSignal): Promise<string[]> {
  if (source === 'oapen') return repositoryEpubs(await repositoryFileGraph(item, source, signal));
  // DOAB describes books; it is not a file host. Follow only OAPEN's public handle API.
  const handle = oapenHandle(item);
  if (!handle) return [];
  let referenced: unknown;
  try { referenced = await json(`${REPOSITORIES.oapen}/rest/handle/${handle}?expand=metadata,bitstreams`, signal); }
  catch (error) {
    if (!(error instanceof CatalogError) || error.kind !== 'unavailable') throw error;
    referenced = await json(`${REPOSITORIES.oapen}/server/api/pid/find?${new URLSearchParams({ id: handle })}`, signal);
  }
  if (!record(referenced)) return [];
  const expanded = await repositoryFileGraph(referenced, 'oapen', signal);
  return repositoryEpubs(expanded);
}
async function repositorySearch(source: 'oapen' | 'doab', query: string, page: number, signal?: AbortSignal): Promise<CatalogPage> {
  const params = new URLSearchParams({ query, expand: 'metadata,bitstreams', limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  let value: unknown;
  try { value = await json(`${REPOSITORIES[source]}/rest/search?${params}`, signal); }
  catch (error) {
    if (!(error instanceof CatalogError) || error.kind !== 'unavailable') throw error;
    const modern = new URLSearchParams({ query, size: String(PAGE_SIZE), page: String(page - 1), dsoType: 'item' });
    value = await json(`${REPOSITORIES[source]}/server/api/discover/search/objects?${modern}`, signal);
  }
  const raw = repositoryItems(value);
  const books: (CatalogBook | null)[] = new Array(raw.items.length).fill(null);
  let cursor = 0;
  // Bound parallel metadata lookups; every request shares source-change cancellation.
  await Promise.all(Array.from({ length: Math.min(3, raw.items.length) }, async () => {
    while (cursor < raw.items.length) {
      const index = cursor++, item = raw.items[index];
      if (signal?.aborted) throw catalogCancelled();
      try { books[index] = repositoryBook(item, source, await repositoryLinks(item, source, signal)); }
      catch (error) { if (signal?.aborted) throw catalogCancelled(); if (error instanceof CatalogError && error.kind === 'unavailable') continue; throw error; }
    }
  }));
  return { books: books.filter((b): b is CatalogBook => Boolean(b)), hasMore: raw.hasMore, total: null,
    noticeKind: 'info', notice: `${source === 'oapen' ? 'OAPEN' : 'DOAB'} has many PDF-only books. Only confirmed EPUB editions hosted by OAPEN are shown.` };
}
const wikiQuery = (parameters: Record<string, string>) => `https://en.wikisource.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', prop: 'info|pageprops|links', inprop: 'url', plnamespace: '102', pllimit: '50', ...parameters })}`;
async function wikiDetails(book: CatalogBook, signal?: AbortSignal) {
  if (!/^\d+$/.test(book.sourceRecordId ?? '')) throw new CatalogError('invalid');
  const page = wikiPage(await json(wikiQuery({ pageids: book.sourceRecordId! }), signal));
  const current = page.books.find(b => b.id === book.id);
  if (!current) throw new CatalogError('unavailable');
  return current;
}

const feedSessions = new Map<string, { next: string; at: number }>();
function templateUrl(template: string, query: string, page: number): string {
  const values: Record<string, string> = { searchTerms: query, startPage: String(page), startIndex: String((page - 1) * PAGE_SIZE + 1), count: String(PAGE_SIZE), language: 'en' };
  const resolved = template.replace(/(?:\{|%7B)([a-zA-Z]+)(?:\?|%3F)?(?:\}|%7D)/gi, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) throw new CatalogError('invalid');
    return encodeURIComponent(values[name]);
  });
  const url = sourceUrl(resolved, FEEDBOOKS_HOSTS);
  if (!url || /[{}]|%7B|%7D/i.test(url)) throw new CatalogError('invalid');
  return url;
}
async function feedbooksSearch(query: string, page: number, signal?: AbortSignal): Promise<CatalogPage> {
  const session = feedSessions.get(`${query}:${page}`);
  let url = session && Date.now() - session.at < 120000 ? session.next : 'https://www.feedbooks.com/publicdomain/catalog.atom';
  let xml = await catalogRequest(url, 'text', signal) as string;
  let parsed = feedbooksPage(xml, url);
  if (!session && query) {
    if (!parsed.search) throw new CatalogError('unavailable');
    let template = parsed.search;
    if (!/\{|%7B/i.test(template)) {
      const descriptor = feedXml(await catalogRequest(template, 'text', signal) as string);
      const search = descriptor.OpenSearchDescription;
      if (!record(search)) throw new CatalogError('invalid');
      const entry = list(search.Url).filter(record).find(u => /^application\/atom\+xml/.test(text(u['@_type'])));
      template = sourceUrl(entry?.['@_template'], FEEDBOOKS_HOSTS, template);
    }
    url = templateUrl(template, query, page); xml = await catalogRequest(url, 'text', signal) as string; parsed = feedbooksPage(xml, url);
  } else if (!session && page > 1) throw new CatalogError('unavailable');
  const visited = new Set([url]);
  for (let hop = 0; hop < 3 && !parsed.page.books.length && parsed.sections.length; hop++) {
    url = parsed.sections.find(section => !visited.has(section)) ?? '';
    if (!url) throw new CatalogError('invalid');
    visited.add(url); parsed = feedbooksPage(await catalogRequest(url, 'text', signal) as string, url);
  }
  if (parsed.next) feedSessions.set(`${query}:${page + 1}`, { next: parsed.next, at: Date.now() });
  if (feedSessions.size > 60) feedSessions.delete(feedSessions.keys().next().value!);
  return { ...parsed.page, noticeKind: 'info', notice: 'Legacy public-domain OPDS catalog. If the service is unavailable, choose another source.' };
}

export async function searchExtraCatalog(source: ExtraSource, query: string, topic: string, page: number, sort: CatalogSort, access: CatalogAccess, signal?: AbortSignal): Promise<CatalogPage> {
  const terms = [query, topic].filter(Boolean).join(' ');
  if (source === 'openlibrary') {
    const literal = terms.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const params = new URLSearchParams({ q: `${literal ? `(${literal}) AND ` : ''}ebook_access:public AND public_scan_b:true`, ebook_access: 'public', public_scan_b: 'true', fields: 'key,title,author_name,ia,public_scan_b,ebook_access,cover_i', limit: String(PAGE_SIZE), page: String(page) });
    if (sort === 'descending') params.set('sort', 'new');
    return openLibraryPage(await json(`https://openlibrary.org/search.json?${params}`, signal), page);
  }
  if (source === 'google') {
    const params = new URLSearchParams({ q: terms || 'subject:fiction', filter: 'free-ebooks', download: 'epub', printType: 'books', maxResults: String(PAGE_SIZE), startIndex: String((page - 1) * PAGE_SIZE), orderBy: sort === 'descending' ? 'newest' : 'relevance' });
    return googlePage(await json(googleUrl(`volumes?${params}`, access), signal), page);
  }
  if (source === 'oapen' || source === 'doab') return repositorySearch(source, terms, page, signal);
  if (source === 'wikisource') return wikiPage(await json(wikiQuery({ generator: 'search', gsrnamespace: '0', gsrlimit: String(PAGE_SIZE), gsroffset: String((page - 1) * PAGE_SIZE), gsrsearch: terms || 'incategory:"Featured texts"' }), signal));
  return feedbooksSearch(terms, page, signal);
}

export async function extraBookDetails(book: CatalogBook, access: CatalogAccess, signal?: AbortSignal): Promise<CatalogBook> {
  if (book.source === 'openlibrary') {
    if (!/^OL\d+W$/.test(book.sourceRecordId ?? '')) throw new CatalogError('invalid');
    const work = await json(`https://openlibrary.org/works/${book.sourceRecordId}.json`, signal);
    if (!record(work)) throw new CatalogError('invalid');
    const available = await openLibraryLinks(book, signal);
    return { ...available.book, description: text(record(work.description) ? work.description.value : work.description) || available.book.description };
  }
  if (book.source === 'google') {
    if (!validId(book.sourceRecordId)) throw new CatalogError('invalid');
    const current = googleBook(await json(googleUrl(`volumes/${book.sourceRecordId}`, access), signal));
    if (!current || current.id !== book.id) throw new CatalogError('unavailable');
    return current;
  }
  if (book.source === 'oapen' || book.source === 'doab') {
    const item = await repositoryItem(book.source, book.sourceRecordId ?? '', signal);
    const current = repositoryBook(item, book.source, await repositoryLinks(item, book.source, signal));
    if (!current) throw new CatalogError('unavailable');
    return current;
  }
  if (book.source === 'wikisource') return wikiDetails(book, signal);
  return book;
}
export async function extraEpubLinks(book: CatalogBook, access: CatalogAccess, signal?: AbortSignal): Promise<string[]> {
  if (book.source === 'openlibrary') return (await openLibraryLinks(book, signal)).links;
  const current = await extraBookDetails(book, access, signal);
  if (current.source === 'wikisource') return [wikiEpub(current)];
  const hosts = current.source === 'google' ? ['books.google.com', 'books.googleusercontent.com'] : current.source === 'feedbooks' ? FEEDBOOKS_HOSTS : ['library.oapen.org'];
  const url = sourceUrl(current.epubUrl, hosts);
  if (!url) throw new CatalogError('unavailable');
  return [url];
}
