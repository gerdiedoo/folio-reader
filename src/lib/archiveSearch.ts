import type { Book, BookContentPage, HighlightEntry, LexiconEntry } from '../types';
import { browseLibrary } from './libraryBrowser';
import { browseNotebook } from './notebookBrowser';

export type ArchiveSearchFilter = 'all' | 'books' | 'quotes' | 'vocabulary';
export type SearchLoadStatus = 'loading' | 'ready' | 'error';
export type SearchBookPages = Readonly<Record<string, readonly Pick<BookContentPage, 'pageNumber'>[]>>;
export type ArchiveSearchResult =
  | { kind: 'book'; id: string; book: Book }
  | { kind: 'quote'; id: string; quote: HighlightEntry }
  | { kind: 'vocabulary'; id: string; vocabulary: LexiconEntry };
export interface ArchiveSearchSection { key: string; title: string; data: ArchiveSearchResult[] }

/** Match the same title/author and entry fields as Library and Notebook. */
export function searchArchive(books: Book[], highlights: HighlightEntry[], lexicon: LexiconEntry[], query: string, filter: ArchiveSearchFilter) {
  const bounded = query.slice(0, 200);
  const categories = { books: filter === 'all' || filter === 'books', quotes: filter === 'all' || filter === 'quotes', vocabulary: filter === 'all' || filter === 'vocabulary' };
  if (!bounded.trim()) return { sections: [] as ArchiveSearchSection[], count: 0, categories };
  const entries = categories.quotes || categories.vocabulary
    ? browseNotebook(books, highlights, lexicon, { bookId: 'all', filter: categories.quotes && categories.vocabulary ? 'all' : categories.quotes ? 'highlights' : 'lexicon', query: bounded })
    : { highlights: [], lexicon: [] };
  const sections: ArchiveSearchSection[] = [];
  if (categories.books) {
    const matches = browseLibrary(books, [], bounded, 'all', 'recent', new Set()).books;
    if (matches.length) sections.push({ key: 'books', title: 'Books', data: matches.map(book => ({ kind: 'book', id: book.id, book })) });
  }
  if (categories.quotes && entries.highlights.length) sections.push({ key: 'quotes', title: 'Quotes & notes', data: entries.highlights.map(quote => ({ kind: 'quote', id: quote.id, quote })) });
  if (categories.vocabulary && entries.lexicon.length) sections.push({ key: 'vocabulary', title: 'Vocabulary', data: entries.lexicon.map(vocabulary => ({ kind: 'vocabulary', id: vocabulary.id, vocabulary })) });
  return { sections, count: sections.reduce((count, section) => count + section.data.length, 0), categories };
}

/** A stored reference must point to a real loaded passage in an existing book. */
export function canOpenSavedPassage(books: Pick<Book, 'id'>[], pages: SearchBookPages, bookId: string, page: number): boolean {
  const bookPages = Object.prototype.hasOwnProperty.call(pages, bookId) ? pages[bookId] : undefined;
  return Number.isSafeInteger(page) && page > 0 && books.some(book => book.id === bookId) &&
    Array.isArray(bookPages) && bookPages.some(passage => passage.pageNumber === page);
}
