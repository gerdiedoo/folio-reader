import {
  Book,
  BookContentPage,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
} from '../types';

export const FOLIO_LOGO_URL =
  'https://lh3.googleusercontent.com/aida/AEtjO1UXLuWCfkKXvpz-OtLptikncopV0oOntb0G8X538706zJdZQbqkZbE04iUx5ainRrjLJr_-4MMX1Y1S1JRz5XX7OYiaXEwCQ7J9RohsVqkjJ1XxqnZEqj4PDl4QnO9rQdg5CDNYLPOf_JsY4KjQdB0R-pKBuiQ_PLaHAhs1IpoGDYdFK5P1SsIHYmXluFosdHmGFq3zGhTzHOBRm8h6Lb-qi-orPACspk_XkOf7k1nJJqVPC9GtbramTNit';

export const INITIAL_SETTINGS: ReadingSettings = {
  theme: 'parchment',
  font: 'Literata',
  fontSizeStep: 4,
  lineSpacing: 'standard',
  margins: 'regular',
  usePublisherDefaults: false,
  displayReadingPace: true,
  readingFlowMode: 'continuous',
};

export const INITIAL_GOAL: ReadingGoal = {
  minutesReadToday: 0,
  dailyTargetMinutes: 45,
  streakDays: 0,
  booksFinishedYear: 0,
  yearTargetBooks: 24,
};

// Clean slate: no placeholder books / highlights / vocabulary
export const INITIAL_BOOKS: Book[] = [];
export const INITIAL_HIGHLIGHTS: HighlightEntry[] = [];
export const INITIAL_LEXICON: LexiconEntry[] = [];

export const BOOK_PAGES: Record<string, BookContentPage[]> = {};
