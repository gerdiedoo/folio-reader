import type { Book } from '../types';
import type { LibraryRecoveryBook } from './catalog';

export type LibraryFilter = 'all' | 'reading' | 'finished' | 'downloaded' | 'want';
export type LibrarySort = 'recent' | 'title' | 'progress';

function folded(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ') : '';
}
function matches(book: { title: string; author: string }, terms: string[]): boolean {
  const text = `${folded(book.title)} ${folded(book.author)}`;
  return terms.every(term => text.includes(term));
}
export function readingDate(value: unknown): number {
  const date = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : 0;
}
export function bookProgress(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}
export function hasReadingHistory(book: Book): boolean {
  return readingDate(book.lastOpened) > 0 || book.currentPage > 1 || bookProgress(book.progressPercent) > 1 ||
    Boolean(book.readingPosition && Number.isInteger(book.readingPosition.pageNumber) && book.readingPosition.pageNumber > 0);
}
export function displayedBookProgress(book: Book): number {
  return book.isFinished ? 100 : hasReadingHistory(book) ? bookProgress(book.progressPercent) : 0;
}
export function libraryBookStatus(book: Book): string {
  if (book.isFinished) return 'Finished';
  if (hasReadingHistory(book)) return `Reading, ${bookProgress(book.progressPercent)}%`;
  return book.isWantToRead ? 'Want to read' : 'Not started';
}

/** Only books with text on this device can be offered as Continue Reading. */
export function continueReadingBook(books: Book[], available: ReadonlySet<string>): Book | undefined {
  return books.filter(book => !book.isFinished && available.has(book.id) && hasReadingHistory(book))
    .sort((a, b) => readingDate(b.lastOpened) - readingDate(a.lastOpened))[0];
}

export function browseLibrary(books: Book[], recovery: LibraryRecoveryBook[], query: string, filter: LibraryFilter, sort: LibrarySort, available: ReadonlySet<string>) {
  const terms = folded(query.slice(0, 200)).trim().split(/\s+/u).filter(Boolean);
  const visible = books.filter(book => {
    if (!matches(book, terms)) return false;
    switch (filter) {
      case 'reading': return !book.isFinished && hasReadingHistory(book);
      case 'finished': return Boolean(book.isFinished);
      case 'downloaded': return available.has(book.id);
      case 'want': return Boolean(book.isWantToRead);
      default: return true;
    }
  });
  const compare = (a: { title: string; progressPercent?: number }, b: { title: string; progressPercent?: number }) =>
    sort === 'title' ? folded(a.title).localeCompare(folded(b.title))
      : sort === 'progress' ? bookProgress(b.progressPercent) - bookProgress(a.progressPercent) : 0;
  visible.sort(sort === 'recent' ? (a, b) => readingDate(b.lastOpened) - readingDate(a.lastOpened)
    : sort === 'progress' ? (a, b) => displayedBookProgress(b) - displayedBookProgress(a) : compare);
  // Recovery rows have no reliable last-read timestamp and do not claim to be downloaded.
  const missing = filter === 'all' ? recovery.filter(book => matches(book, terms)).sort(compare) : [];
  return { books: visible, recovery: missing };
}
