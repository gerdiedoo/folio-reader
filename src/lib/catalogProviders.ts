import { parse } from 'node-html-parser';
import type { CatalogBook, CatalogPage, CatalogSource, CatalogSort } from './catalog';

export const CATALOG_SOURCES: { id: CatalogSource; label: string; description: string }[] = [
  { id: 'gutenberg', label: 'Project Gutenberg', description: 'Public-domain classics · English EPUBs' },
  { id: 'standard', label: 'Standard Ebooks', description: 'Carefully edited classics with illustrated covers' },
  { id: 'archive', label: 'Internet Archive', description: 'Unrestricted EPUBs from editions dated before 1931' },
];
export const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const firstText = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : text(value);
export function sourceUrl(value: unknown, hosts: string[], base?: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}
export function gutenbergBook(value: unknown): CatalogBook | null {
  if (!record(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1 || !record(value.formats)) return null;
  const epub = sourceUrl(value.formats['application/epub+zip'], ['www.gutenberg.org', 'gutenberg.org']);
  if (!epub || !text(value.title)) return null;
  const authors = Array.isArray(value.authors) ? value.authors.filter(record) : [];
  const rawAuthor = text(authors[0]?.name);
  const parts = rawAuthor.split(',').map(part => part.trim());
  return { id: `gutenberg-${value.id}`, source: 'gutenberg', title: text(value.title), author: parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawAuthor || 'Unknown Author',
    coverUrl: sourceUrl(value.formats['image/jpeg'], ['www.gutenberg.org', 'gutenberg.org']), epubUrl: epub,
    downloads: typeof value.download_count === 'number' && Number.isFinite(value.download_count) ? Math.max(0, value.download_count) : 0,
    subjects: Array.isArray(value.subjects) ? value.subjects.map(text).filter(Boolean) : [],
    description: Array.isArray(value.summaries) ? value.summaries.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).join('\n\n') : '',
    languages: Array.isArray(value.languages) ? value.languages.map(text).filter(Boolean) : [] };
}
export function parseGutenbergPage(value: unknown): CatalogPage {
  if (!record(value) || !Array.isArray(value.results) || typeof value.count !== 'number' || !Number.isFinite(value.count) || value.count < 0 || !(value.next === null || typeof value.next === 'string')) throw Error('unreadable');
  const books = value.results.map(gutenbergBook).filter((book): book is CatalogBook => Boolean(book));
  if (value.results.length && !books.length) throw Error('unreadable');
  return { books, hasMore: Boolean(value.next), total: value.count };
}
export function standardSearchUrl(query: string, topic: string, page: number, sort: CatalogSort): string {
  const params = new URLSearchParams({ query: [query, topic].filter(Boolean).join(' '), page: String(page), 'per-page': '24', sort: sort === 'descending' ? 'newest' : 'popularity' });
  return `https://standardebooks.org/ebooks?${params}`;
}
/** Parse the public website, not its subscription OPDS feed. */
export function parseStandardPage(html: string): CatalogPage {
  const root = parse(html);
  const container = root.querySelector('ol.ebooks-list');
  if (!container) {
    if (root.querySelector('main.ebooks .no-results')) return { books: [], hasMore: false, total: 0 };
    throw Error('unreadable');
  }
  const books: CatalogBook[] = [];
  for (const row of container.querySelectorAll('li[typeof="schema:Book"]')) {
    if (row.querySelector('.placeholder-cover') || row.classList.contains('ribbon')) continue;
    const url = sourceUrl(row.getAttribute('about') || row.querySelector('a[property="schema:url"]')?.getAttribute('href'), ['standardebooks.org'], 'https://standardebooks.org');
    if (!url || !/^\/ebooks\/[a-z0-9-]+\/[a-z0-9_/-]+$/.test(new URL(url).pathname)) continue;
    const title = text(row.querySelector('p a span[property="schema:name"]')?.textContent);
    if (!title) continue;
    books.push({ id: `standard-${new URL(url).pathname.slice(8).replace(/\//g, '--')}`, source: 'standard', title,
      author: row.querySelectorAll('.author').map(node => text(node.textContent)).filter(Boolean).join(', ') || 'Unknown Author',
      coverUrl: sourceUrl(row.querySelector('img')?.getAttribute('src'), ['standardebooks.org'], url),
      epubUrl: '', detailUrl: url, downloads: 0, subjects: [] });
  }
  if (container.querySelectorAll('li[typeof="schema:Book"]').length && !books.length && !container.querySelector('.placeholder-cover')) throw Error('unreadable');
  return { books, hasMore: Boolean(root.querySelector('nav.pagination a[rel="next"][href]')), total: null };
}
export function standardEpubLinks(html: string, detailUrl: string): string[] {
  const root = parse(html);
  return [...new Set(root.querySelectorAll('a.epub[href]').map(node => sourceUrl(node.getAttribute('href'), ['standardebooks.org'], detailUrl))
    .filter(url => url && /\.epub(?:\?|$)/.test(url) && !/\.kepub\.epub/.test(url))
    .map(value => { const url = new URL(value); url.searchParams.set('source', 'download'); return url.href; }))].slice(0, 2);
}
export function archiveSearchUrl(query: string, topic: string, page: number, sort: CatalogSort): string {
  // Keep user text literal inside the Archive query language.
  const terms = [query, topic].filter(Boolean).join(' ').replace(/["\\]/g, ' ').trim();
  const q = 'mediatype:texts AND format:EPUB AND access-restricted-item:false AND year:[* TO 1930]' + (terms ? ` AND (title:"${terms}" OR creator:"${terms}" OR subject:"${terms}")` : '');
  const params = new URLSearchParams({ q, output: 'json', rows: '24', page: String(page), 'sort[]': sort === 'descending' ? 'addeddate desc' : 'downloads desc' });
  for (const field of ['identifier', 'title', 'creator', 'downloads']) params.append('fl[]', field);
  return `https://archive.org/advancedsearch.php?${params}`;
}
export function parseArchivePage(value: unknown, page: number): CatalogPage {
  if (!record(value) || !record(value.response) || !Array.isArray(value.response.docs) || typeof value.response.numFound !== 'number' || !Number.isFinite(value.response.numFound) || value.response.numFound < 0) throw Error('unreadable');
  const books: CatalogBook[] = [];
  for (const doc of value.response.docs) {
    if (!record(doc) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(text(doc.identifier)) || !text(doc.title)) continue;
    const id = text(doc.identifier);
    books.push({ id: `archive-${id}`, source: 'archive', title: text(doc.title), author: firstText(doc.creator) || 'Unknown Author', coverUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      epubUrl: '', detailUrl: `https://archive.org/metadata/${encodeURIComponent(id)}`, downloads: typeof doc.downloads === 'number' && Number.isFinite(doc.downloads) ? Math.max(0, doc.downloads) : 0, subjects: [] });
  }
  if (value.response.docs.length && !books.length) throw Error('unreadable');
  return { books, hasMore: page * 24 < value.response.numFound, total: value.response.numFound };
}
export function archiveEpubLinks(value: unknown, identifier: string): string[] {
  if (!record(value) || value.is_dark || !record(value.metadata) || /^(true|1)$/i.test(String(value.metadata['access-restricted-item'])) || !Array.isArray(value.files)) return [];
  return value.files.filter(record).filter(file => typeof file.name === 'string' && /\.epub$/i.test(file.name) && !file.private && !/encrypted|lcp|drm/i.test(text(file.format)) && !file.name.split('/').some(part => part === '..'))
    .sort((a, b) => Number(b.source === 'original') - Number(a.source === 'original'))
    .slice(0, 2).map(file => `https://archive.org/download/${encodeURIComponent(identifier)}/${(file.name as string).split('/').map(encodeURIComponent).join('/')}`);
}
