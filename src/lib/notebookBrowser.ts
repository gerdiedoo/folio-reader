import type { Book, HighlightEntry, LexiconEntry } from '../types';

export type NotebookFilter = 'all' | 'highlights' | 'notes' | 'lexicon';

function folded(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ')
    : '';
}

/** Local, literal search; all terms must match fields within the same entry. */
export function browseNotebook(
  books: Book[], highlights: HighlightEntry[], lexicon: LexiconEntry[],
  options: { bookId: string; filter: NotebookFilter; query: string },
) {
  const titles = new Map(books.map(book => [book.id, book.title]));
  const terms = folded(options.query.slice(0, 200)).trim().split(/\s+/u).filter(Boolean);
  const matches = (fields: unknown[]) => {
    const content = fields.map(folded).join(' ');
    return terms.every(term => content.includes(term));
  };
  const bookHighlights = highlights.filter(entry => options.bookId === 'all' || entry.bookId === options.bookId);
  const bookLexicon = lexicon.filter(entry => options.bookId === 'all' || entry.bookId === options.bookId);
  return {
    bookHighlights, bookLexicon,
    highlights: options.filter === 'lexicon' ? [] : bookHighlights.filter(entry =>
      (options.filter !== 'notes' || Boolean(entry.note?.trim())) &&
      matches([entry.text, entry.note, entry.chapter, entry.bookTitle, titles.get(entry.bookId)])),
    lexicon: options.filter !== 'all' && options.filter !== 'lexicon' ? [] : bookLexicon.filter(entry =>
      matches([entry.word, entry.definition, entry.contextPassage, entry.chapter, entry.partOfSpeech, titles.get(entry.bookId)])),
  };
}
