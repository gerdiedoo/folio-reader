import { XMLParser } from 'fast-xml-parser';
import type { CatalogBook, CatalogPage, CatalogSource } from './catalog';
import { record, sourceUrl } from './catalogProviders';
import { CatalogError } from './catalogRequest';

export const PAGE_SIZE = 20;
export const text = (v: unknown): string => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v];
const strings = (v: unknown) => list(v).map(text).filter(Boolean);
export const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(v);
const empty = (books: CatalogBook[], hasMore: boolean, notice?: string): CatalogPage => ({ books, hasMore, total: null, ...(notice ? { notice, noticeKind: 'info' as const } : {}) });

export function openLibraryPage(value: unknown, page: number): CatalogPage {
  if (!record(value) || !Array.isArray(value.docs) || !Number.isSafeInteger(value.numFound) || Number(value.numFound) < 0) throw new CatalogError('invalid');
  const books: CatalogBook[] = [];
  for (const raw of value.docs.slice(0, PAGE_SIZE)) {
    if (!record(raw) || raw.public_scan_b !== true || raw.ebook_access !== 'public' || !/^\/works\/OL\d+W$/.test(text(raw.key)) || !text(raw.title)) continue;
    const archiveIds = strings(raw.ia).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id));
    if (!archiveIds.length) continue;
    const id = text(raw.key).split('/').pop()!;
    books.push({ id: `openlibrary-${id}`, source: 'openlibrary', sourceRecordId: id, archiveIds: archiveIds.slice(0, 3),
      title: text(raw.title), author: strings(raw.author_name).join(', ') || 'Unknown Author', downloads: 0, subjects: [],
      coverUrl: Number.isSafeInteger(raw.cover_i) && Number(raw.cover_i) > 0 ? `https://covers.openlibrary.org/b/id/${raw.cover_i}-L.jpg` : '',
      detailUrl: `https://openlibrary.org/works/${id}.json`, epubUrl: '' });
  }
  return empty(books, page * PAGE_SIZE < Number(value.numFound), 'Open Library lists public-access scans. EPUB availability is checked against Internet Archive before download.');
}

export function googleBook(value: unknown): CatalogBook | null {
  if (!record(value) || !validId(value.id) || !record(value.volumeInfo) || !record(value.accessInfo)) return null;
  const volume = value.volumeInfo, access = value.accessInfo;
  const sale = record(value.saleInfo) ? value.saleInfo : {};
  if (!text(volume.title) || access.viewability !== 'ALL_PAGES' || !(access.publicDomain === true || sale.saleability === 'FREE') ||
    !record(access.epub) || access.epub.isAvailable !== true || record(access.downloadAccess) && access.downloadAccess.restricted === true) return null;
  const epub = sourceUrl(access.epub.downloadLink, ['books.google.com', 'books.googleusercontent.com']);
  if (!epub || /\.acsm(?:$|\?)/i.test(epub)) return null;
  const images = record(volume.imageLinks) ? volume.imageLinks : {};
  return { id: `google-${value.id}`, source: 'google', sourceRecordId: value.id, title: text(volume.title), author: strings(volume.authors).join(', ') || 'Unknown Author',
    coverUrl: sourceUrl(images.thumbnail || images.smallThumbnail, ['books.google.com', 'books.googleusercontent.com']), epubUrl: epub,
    detailUrl: `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(value.id)}`, downloads: 0,
    subjects: strings(volume.categories), description: text(volume.description), languages: strings(volume.language) };
}
export function googlePage(value: unknown, page: number): CatalogPage {
  if (!record(value) || !Number.isSafeInteger(value.totalItems) || Number(value.totalItems) < 0 || value.items !== undefined && !Array.isArray(value.items)) throw new CatalogError('invalid');
  const raw = list(value.items), books = raw.map(googleBook).filter((b): b is CatalogBook => Boolean(b));
  return empty(books, raw.length === PAGE_SIZE && page * PAGE_SIZE < Number(value.totalItems), 'Only free, fully viewable EPUBs with direct downloads are shown. Availability can vary by country.');
}

export const REPOSITORIES = { oapen: 'https://library.oapen.org', doab: 'https://directory.doabooks.org' } as const;
export function metadata(item: Record<string, unknown>, key: string): string[] {
  const fields = item.metadata;
  if (Array.isArray(fields)) return fields.filter(record).filter(f => f.key === key).map(f => text(f.value)).filter(Boolean);
  if (record(fields)) return list(fields[key]).map(f => record(f) ? text(f.value) : text(f)).filter(Boolean);
  return [];
}
export function repositoryItems(value: unknown): { items: Record<string, unknown>[]; hasMore: boolean } {
  if (Array.isArray(value)) return { items: value.slice(0, PAGE_SIZE).filter(record), hasMore: value.length >= PAGE_SIZE };
  if (!record(value)) throw new CatalogError('invalid');
  const embedded = record(value._embedded) ? value._embedded : {};
  const search = record(embedded.searchResult) ? embedded.searchResult : value;
  const results = record(search._embedded) ? search._embedded.objects : undefined;
  if (!Array.isArray(results)) throw new CatalogError('invalid');
  const pagination = record(search.page) ? search.page : record(value.page) ? value.page : {};
  return { items: results.slice(0, PAGE_SIZE).filter(record).map(row => record(row._embedded) && record(row._embedded.indexableObject) ? row._embedded.indexableObject : row),
    hasMore: Boolean(record(search._links) && search._links.next) || Boolean(record(value._links) && value._links.next) || Boolean(Number(pagination.number) + 1 < Number(pagination.totalPages)) };
}
export function repositoryEpubs(item: Record<string, unknown>, origin = REPOSITORIES.oapen): string[] {
  if (item.withdrawn === true || item.discoverable === false) return [];
  return list(item.bitstreams).filter(record).filter(file => {
    const mime = text(file.mimeType || file.mimetype || file.format);
    return file.private !== true && (mime === 'application/epub+zip' || !mime && /\.epub$/i.test(text(file.name))) && !/drm|encrypted|lcp/i.test(mime);
  }).map(file => sourceUrl(file.retrieveLink || file.url || (record(file._links) && record(file._links.content) ? file._links.content.href : '') || (validId(String(file.uuid ?? file.id)) ? `/rest/bitstreams/${file.uuid ?? file.id}/retrieve` : ''), [new URL(origin).hostname], origin)).filter(Boolean);
}
export function repositoryBook(item: Record<string, unknown>, source: 'oapen' | 'doab', epubUrls: string[]): CatalogBook | null {
  const id = String(item.uuid ?? item.id ?? '');
  if (!validId(id) || item.withdrawn === true || item.discoverable === false || !epubUrls.length) return null;
  const title = metadata(item, 'dc.title')[0] || text(item.name);
  if (!title) return null;
  return { id: `${source}-${id}`, source, sourceRecordId: id, title,
    author: [...metadata(item, 'dc.contributor.author'), ...metadata(item, 'dc.creator')].join(', ') || 'Unknown Author',
    coverUrl: '', epubUrl: epubUrls[0], detailUrl: `${REPOSITORIES[source]}/rest/items/${id}?expand=metadata,bitstreams`, downloads: 0,
    description: metadata(item, 'dc.description.abstract').join('\n\n'), languages: metadata(item, 'dc.language.iso'), subjects: metadata(item, 'dc.subject') };
}
export function oapenHandle(item: Record<string, unknown>): string | null {
  for (const field of list(item.metadata).filter(record)) {
    const url = sourceUrl(field.value, ['library.oapen.org']);
    if (!url) continue;
    const match = /^\/handle\/(\d+(?:\.\d+)*\/\d+)$/.exec(new URL(url).pathname);
    if (match) return match[1];
  }
  if (record(item.metadata)) for (const values of Object.values(item.metadata)) for (const field of list(values).filter(record)) {
    const url = sourceUrl(field.value, ['library.oapen.org']);
    const match = url && /^\/handle\/(\d+(?:\.\d+)*\/\d+)$/.exec(new URL(url).pathname);
    if (match) return match[1];
  }
  return null;
}

export function wikiPage(value: unknown): CatalogPage {
  if (!record(value) || value.error || !record(value.query) || !record(value.query.pages)) {
    if (record(value) && !value.error && (value.batchcomplete !== undefined || record(value.query))) return empty([], false);
    throw new CatalogError('invalid');
  }
  const books: CatalogBook[] = [];
  const pages = Object.values(value.query.pages).filter(record).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  for (const page of pages) {
    const title = text(page.title);
    if (!Number.isSafeInteger(page.pageid) || Number(page.pageid) < 1 || page.ns !== 0 || !title || title.includes('/') || page.missing !== undefined || record(page.pageprops) && page.pageprops.disambiguation !== undefined) continue;
    const authors = list(page.links).filter(record).filter(link => link.ns === 102).map(link => text(link.title).replace(/^Author:/, '')).filter(Boolean);
    books.push({ id: `wikisource-en-${page.pageid}`, source: 'wikisource', sourceRecordId: String(page.pageid), exportTitle: title,
      title, author: authors.slice(0, 4).join(', ') || 'Unknown Author', coverUrl: '', epubUrl: '', detailUrl: `https://en.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      downloads: 0, subjects: [], languages: ['en'], description: 'Transcribed work from English Wikisource. Its EPUB is generated on request; formatting depends on the transcription.' });
  }
  return empty(books, record(value.continue) && typeof value.continue.gsroffset === 'number', 'English transcribed works. EPUBs are generated on demand by WS Export.');
}
export function wikiEpub(book: CatalogBook): string {
  if (!book.exportTitle || book.exportTitle.length > 500 || /[\u0000-\u001f#|]/.test(book.exportTitle)) throw new CatalogError('unavailable');
  return `https://ws-export.wmcloud.org/?${new URLSearchParams({ lang: 'en', page: book.exportTitle, format: 'epub-3' })}`;
}

export const FEEDBOOKS_HOSTS = ['www.feedbooks.com', 'feedbooks.com', 'catalog.feedbooks.com'];
export function feedXml(source: string): Record<string, unknown> {
  if (source.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new CatalogError('invalid');
  try { const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: true }).parse(source); if (!record(parsed)) throw Error(); return parsed; }
  catch { throw new CatalogError('invalid'); }
}
const atomText = (v: unknown) => text(record(v) ? v['#text'] : v);
export function feedbooksPage(source: string, base: string): { page: CatalogPage; search: string; next: string; sections: string[] } {
  const doc = feedXml(source), feed = doc.feed;
  if (!record(feed)) throw new CatalogError('invalid');
  const links = list(feed.link).filter(record);
  const link = (rel: string) => sourceUrl(links.find(l => l['@_rel'] === rel)?.['@_href'], FEEDBOOKS_HOSTS, base);
  const books: CatalogBook[] = [];
  for (const entry of list(feed.entry).filter(record)) {
    const entryLinks = list(entry.link).filter(record);
    const epub = entryLinks.find(l => l['@_type'] === 'application/epub+zip' && ['http://opds-spec.org/acquisition', 'http://opds-spec.org/acquisition/open-access'].includes(String(l['@_rel'])));
    const epubUrl = sourceUrl(epub?.['@_href'], FEEDBOOKS_HOSTS, base);
    const id = epubUrl && /\/book\/(\d+)(?:\.epub|\/)/.exec(new URL(epubUrl).pathname)?.[1];
    if (!id || !atomText(entry.title)) continue;
    const image = entryLinks.find(l => ['http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail'].includes(String(l['@_rel'])));
    books.push({ id: `feedbooks-${id}`, source: 'feedbooks', sourceRecordId: id, title: atomText(entry.title),
      author: list(entry.author).filter(record).map(a => atomText(a.name)).filter(Boolean).join(', ') || 'Unknown Author',
      coverUrl: sourceUrl(image?.['@_href'], FEEDBOOKS_HOSTS, base), epubUrl, downloads: 0, subjects: [], description: atomText(entry.summary || entry.content) });
  }
  const sections = list(feed.entry).filter(record).flatMap(entry => list(entry.link).filter(record))
    .filter(l => l['@_rel'] === 'subsection' || l['@_rel'] === 'http://opds-spec.org/sort/popular').map(l => sourceUrl(l['@_href'], FEEDBOOKS_HOSTS, base)).filter(Boolean);
  return { page: empty(books, Boolean(link('next'))), search: link('search'), next: link('next'), sections };
}
