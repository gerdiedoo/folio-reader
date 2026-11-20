import type { CatalogBook } from '../lib/catalog';

// A small, explicitly labeled fallback, not a replacement for a live catalog.
const classics: [number, string, string, string][] = [
  [1342, 'Pride and Prejudice', 'Jane Austen', 'fiction romance love stories'],
  [11, "Alice’s Adventures in Wonderland", 'Lewis Carroll', 'fiction children adventure'],
  [84, 'Frankenstein', 'Mary Wollstonecraft Shelley', 'fiction horror gothic science fiction'],
  [1661, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 'fiction detective and mystery'],
  [345, 'Dracula', 'Bram Stoker', 'fiction gothic horror'],
  [2701, 'Moby Dick', 'Herman Melville', 'fiction adventure'],
  [98, 'A Tale of Two Cities', 'Charles Dickens', 'fiction history'],
  [76, 'Adventures of Huckleberry Finn', 'Mark Twain', 'fiction adventure'],
  [174, 'The Picture of Dorian Gray', 'Oscar Wilde', 'fiction gothic horror'],
  [74, 'The Adventures of Tom Sawyer', 'Mark Twain', 'fiction children adventure'],
  [120, 'Treasure Island', 'Robert Louis Stevenson', 'fiction adventure children'],
  [43, 'The Strange Case of Dr. Jekyll and Mr. Hyde', 'Robert Louis Stevenson', 'fiction gothic horror'],
  [768, 'Wuthering Heights', 'Emily Brontë', 'fiction romance love stories gothic'],
  [514, 'Little Women', 'Louisa May Alcott', 'fiction children'],
  [2600, 'War and Peace', 'Leo Tolstoy', 'fiction history'],
  [1260, 'Jane Eyre: An Autobiography', 'Charlotte Brontë', 'fiction romance love stories'],
  [1232, 'The Prince', 'Niccolò Machiavelli', 'philosophy history'],
  [1514, 'A Midsummer Night’s Dream', 'William Shakespeare', 'plays drama poetry'],
  [132, 'The Art of War', 'Sun Tzu', 'philosophy history'],
];
export const STARTER_BOOKS: CatalogBook[] = classics.map(([id, title, author, topics]) => ({
  id: `gutenberg-${id}`, source: 'gutenberg', title, author,
  coverUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
  epubUrl: `https://www.gutenberg.org/ebooks/${id}.epub3.images`, downloads: 0, subjects: topics.split(' '),
}));
export function starterBooks(query: string, topic: string): CatalogBook[] {
  const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  return STARTER_BOOKS.filter(book => terms.every(term => fold(`${book.title} ${book.author}`).includes(term)) && (!topic || fold(book.subjects.join(' ')).includes(fold(topic))));
}
