import type { CatalogBook, CatalogPage, CatalogSort } from './catalog';
import { record } from './catalogProviders';
import { CatalogError } from './catalogRequest';

export const DISCOVERY_PAGE_SIZE = 18;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map(v => v.trim()) : [];
export const discoveryText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const literal = (value: string) => discoveryText(value).slice(0, 120).trim();
export function openLibraryCover(id: unknown): string {
  return Number.isSafeInteger(id) && Number(id) > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false` : '';
}
const fields = 'key,title,author_name,cover_i,first_publish_year,edition_count,ia';
export function discoverySearchUrl(query: string, topic: string, page: number, sort: CatalogSort = 'popular'): string {
  const params = new URLSearchParams({ q: literal(query) || (topic ? `subject:"${literal(topic)}"` : '*:*'), fields, limit: String(DISCOVERY_PAGE_SIZE), page: String(page) });
  if (sort === 'descending') params.set('sort', 'new');
  else if (!query.trim()) params.set('sort', 'editions');
  params.set('spellcheck_count', '0');
  return `https://openlibrary.org/search.json?${params}`;
}
export function discoveryMatchUrl(books: readonly CatalogBook[]): string {
  const clauses = books.slice(0, 8).map(book => {
    const author = literal(book.author.replace(/\b\d{4}\b/g, '')).split(' ').filter(token => token.length > 1).slice(0, 8);
    return `(title:"${literal(book.title.split(/[:;]/)[0])}"${author.length && !/^unknown author$/i.test(book.author) ? ` AND author:(${author.map(token => `"${token}"`).join(' AND ')})` : ''})`;
  });
  return `https://openlibrary.org/search.json?${new URLSearchParams({ q: clauses.join(' OR '), fields, limit: '100', spellcheck_count: '0' })}`;
}
export function parseDiscoveryPage(value: unknown, page = 1): CatalogPage {
  if (!record(value) || !Array.isArray(value.docs) || !Number.isSafeInteger(value.numFound) || Number(value.numFound) < 0) throw new CatalogError('invalid');
  const books: CatalogBook[] = [];
  for (const doc of value.docs) {
    if (!record(doc) || typeof doc.key !== 'string' || !/^\/works\/OL\d+W$/.test(doc.key) || typeof doc.title !== 'string' || !doc.title.trim()) continue;
    const id = doc.key.slice(7), authors = strings(doc.author_name);
    books.push({ id: `openlibrary-${id}`, source: 'openlibrary', catalogKind: 'work', openLibraryWorkId: id, sourceRecordId: id,
      title: doc.title.trim(), author: authors.join(', ') || 'Unknown Author', authors, coverUrl: openLibraryCover(doc.cover_i),
      epubUrl: '', epubEditions: [], downloads: 0, subjects: [], languages: strings(doc.language).slice(0, 12),
      publicationYear: Number.isSafeInteger(doc.first_publish_year) ? Number(doc.first_publish_year) : undefined,
      editionCount: Number.isSafeInteger(doc.edition_count) && Number(doc.edition_count) > 0 ? Number(doc.edition_count) : undefined,
      archiveIds: strings(doc.ia).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id)).slice(0, 3),
      detailUrl: `https://openlibrary.org${doc.key}.json` });
  }
  if (value.docs.length && !books.length) throw new CatalogError('invalid');
  return { books: mergeDiscoveryBooks([], books), hasMore: page * DISCOVERY_PAGE_SIZE < Number(value.numFound), total: Number(value.numFound) };
}
function sameAuthor(a: string, b: string): boolean {
  const tokens = (name: string) => discoveryText(name.replace(/\b\d{4}\b/g, '')).split(' ').filter(part => part.length > 1);
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length || /^(unknown|anonymous)/i.test(a) || /^(unknown|anonymous)/i.test(b)) return false;
  return x.length >= 2 && y.length >= 2 ? (x.every(token => y.includes(token)) || y.every(token => x.includes(token))) : discoveryText(a) === discoveryText(b);
}
/** Conservative work matching: a shared title alone is never enough. */
export function matchingDiscoveryWork(work: CatalogBook, edition: CatalogBook): boolean {
  const fullA = discoveryText(work.title), fullB = discoveryText(edition.title);
  const base = (title: string) => discoveryText(title.split(/[:;]/)[0]);
  const a = base(work.title), b = base(edition.title);
  const sameTitle = fullA === fullB || a === b && a.length >= 5 && (fullA === a || fullB === b);
  if (!sameTitle) return false;
  if (work.epubEditions?.some(known => known.id === edition.id && known.source === edition.source && discoveryText(known.title) === fullB)) return true;
  if (edition.source === 'archive' && work.archiveIds?.includes(edition.id.replace(/^archive-/, ''))) return true;
  return (work.authors?.length ? work.authors : [work.author]).some(author => sameAuthor(author, edition.author));
}
export function mergeDiscoveryBooks(current: readonly CatalogBook[], incoming: readonly CatalogBook[]): CatalogBook[] {
  const result = new Map(current.map(book => [book.id, book]));
  for (const book of incoming) {
    const old = result.get(book.id);
    const editions = new Map([...(old?.epubEditions ?? []), ...(book.epubEditions ?? [])].map(edition => [edition.id, edition]));
    result.set(book.id, old ? { ...old, coverUrl: old.coverUrl || book.coverUrl, epubEditions: [...editions.values()] } : book);
  }
  return [...result.values()];
}
export function discoveryWorkDetails(value: unknown, book: CatalogBook): CatalogBook {
  if (!record(value) || value.key !== `/works/${book.openLibraryWorkId}`) throw new CatalogError('invalid');
  const description = typeof value.description === 'string' ? value.description : record(value.description) && typeof value.description.value === 'string' ? value.description.value : '';
  return { ...book, description: description || book.description, subjects: strings(value.subjects).slice(0, 40),
    coverUrl: book.coverUrl || (Array.isArray(value.covers) ? value.covers.map(openLibraryCover).find(Boolean) ?? '' : '') };
}
