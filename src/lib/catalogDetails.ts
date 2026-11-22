import { parse } from 'node-html-parser';
import type { CatalogBook } from './catalog';
import { record } from './catalogProviders';
import { CatalogError } from './catalogRequest';

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [value])
  .filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim());

export function standardBookDetails(html: string, book: CatalogBook): CatalogBook {
  const root = parse(html);
  const description = root.querySelector('#description')?.innerHTML
    || root.querySelector('[property="schema:description"]')?.innerHTML
    || root.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  if (!description && !root.querySelector('a.epub')) throw new CatalogError('invalid');
  const language = root.querySelector('[property="schema:inLanguage"]')?.getAttribute('content')
    || root.querySelector('html')?.getAttribute('lang');
  return { ...book, description, languages: language ? [language] : book.languages };
}

export function archiveBookDetails(value: unknown, book: CatalogBook): CatalogBook {
  if (!record(value) || !record(value.metadata)) throw new CatalogError('invalid');
  const metadata = value.metadata;
  return { ...book, description: strings(metadata.description).join('\n\n'),
    languages: strings(metadata.language), subjects: strings(metadata.subject) };
}
