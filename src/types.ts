export type TabType = 'library' | 'reading' | 'notebook' | 'settings';

export type PaperTheme = 'parchment' | 'white' | 'sepia' | 'charcoal';
export type Typeface = 'Literata' | 'Bookerly' | 'Georgia' | 'Inter' | 'OpenDyslexic';
export type LineSpacing = 'compact' | 'standard' | 'loose';
export type Margins = 'narrow' | 'regular' | 'wide';

export type ReadingFlowMode = 'paginated' | 'continuous' | 'single-line';

export type HighlightColorName =
  | 'Amber Crayon'
  | 'Terracotta Ink'
  | 'Sage Pencil'
  | 'Lavender Quill';

export interface ReadingSettings {
  theme: PaperTheme;
  font: Typeface;
  fontSizeStep: number; // 1 to 8, default 4
  lineSpacing: LineSpacing;
  margins: Margins;
  usePublisherDefaults: boolean;
  displayReadingPace: boolean;
  defaultCoverStyle?: 'image' | 'typographic';
  readingFlowMode?: ReadingFlowMode;
  wpm?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  coverStyle?: 'image' | 'typographic';
  progressPercent: number;
  currentPage: number;
  totalPages: number;
  minutesLeft: number;
  currentChapter: string;
  lastOpened: string;
  isFinished?: boolean;
  isDownloaded?: boolean;
  isWantToRead?: boolean;
  totalLoc?: number;
  currentLoc?: number;
  coverAlt: string;
}

export interface HighlightEntry {
  id: string;
  bookId: string;
  bookTitle: string;
  chapter: string;
  page: number;
  loc?: number;
  colorName: HighlightColorName;
  colorHex: string;
  text: string;
  note?: string;
  dateAdded: string;
}

export interface LexiconEntry {
  id: string;
  bookId: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  contextPassage: string;
  chapter: string;
  masteryLevel: number; // 1 to 5
}

export interface ReadingGoal {
  minutesReadToday: number;
  dailyTargetMinutes: number;
  streakDays: number;
  booksFinishedYear: number;
  yearTargetBooks: number;
}

export interface BookContentPage {
  chapterTitle: string;
  chapterNumber: string;
  folioNumber: string;
  dropCap: string;
  paragraph1: string;
  paragraph2Lead: string;
  highlightedText: string;
  paragraph2Rest: string;
  pageNumber: number;
  totalBookPages: number;
  locNumber: number;
  totalLoc: number;
  minutesLeftInChapter: number;
}

export interface UserProfile {
  id: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
}
