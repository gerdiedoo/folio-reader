import { DEFAULT_READER_SETTINGS } from '../lib/readerPreferences';
import {
  Book,
  BookContentPage,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
} from '../types';

export const INITIAL_SETTINGS: ReadingSettings = { ...DEFAULT_READER_SETTINGS };

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
