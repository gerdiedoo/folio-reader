import type { Book, BookContentPage, ReadingPosition } from '../types';
import type { LibraryBackupEntry } from './catalog';
import { applyReadingPosition } from './readingPosition';
import { resolveSourceAnchor, validSourceAnchor } from './sourceAnchors';

const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const unreadable = () => new Error('Your account backup could not be read safely. It has been kept unchanged; try again or use a portable safety copy.');

/** Read old book-list entries while validating new, edition-specific checkpoints. */
export function readLibraryBackupEntry(value: unknown): LibraryBackupEntry {
  if (!value || typeof value !== 'object') throw unreadable();
  const entry = value as LibraryBackupEntry;
  if (typeof entry.title !== 'string' || typeof entry.author !== 'string' || entry.title.length > 10000 || entry.author.length > 10000) throw unreadable();
  const result: LibraryBackupEntry = { title: entry.title, author: entry.author };
  if (positive(entry.gutenbergId)) result.gutenbergId = entry.gutenbergId;
  if (positive(entry.currentPage)) result.currentPage = entry.currentPage;
  if (typeof entry.progressPercent === 'number' && Number.isFinite(entry.progressPercent)) result.progressPercent = Math.max(0, Math.min(100, entry.progressPercent));
  if (typeof entry.currentChapter === 'string' && entry.currentChapter.length <= 10000) result.currentChapter = entry.currentChapter;
  if (typeof entry.currentLoc === 'number' && Number.isFinite(entry.currentLoc) && entry.currentLoc >= 0) result.currentLoc = entry.currentLoc;
  if (typeof entry.isFinished === 'boolean') result.isFinished = entry.isFinished;
  if (entry.documentFingerprint !== undefined) {
    if (!fingerprint(entry.documentFingerprint)) throw unreadable();
    result.documentFingerprint = entry.documentFingerprint;
  }
  if (entry.readingPosition !== undefined) {
    const position = entry.readingPosition;
    if (!position || !positive(position.pageNumber) || !validSourceAnchor(position.anchor) ||
      position.anchor.edition !== result.documentFingerprint ||
      (position.wordOffset !== undefined && (!Number.isSafeInteger(position.wordOffset) || position.wordOffset < 0))) throw unreadable();
    result.readingPosition = { pageNumber: position.pageNumber, anchor: { ...position.anchor },
      ...(position.wordOffset !== undefined ? { wordOffset: position.wordOffset } : {}) };
  }
  return result;
}

/** Original files, local paths and viewport pixel offsets never enter this backup. */
export function libraryBackupEntry(book: Book, gutenbergId?: number): LibraryBackupEntry {
  const anchor = book.readingPosition?.anchor;
  return readLibraryBackupEntry({ title: book.title, author: book.author, gutenbergId,
    currentPage: book.currentPage, progressPercent: book.progressPercent, currentChapter: book.currentChapter,
    currentLoc: book.currentLoc, isFinished: book.isFinished,
    ...(fingerprint(book.documentFingerprint) ? { documentFingerprint: book.documentFingerprint } : {}),
    ...(validSourceAnchor(anchor) && anchor.edition === book.documentFingerprint ? { readingPosition: book.readingPosition } : {}),
  });
}

export type BackupProgressResult = { book: Book; restored: true } | { book: Book; restored: false; reason: 'missing-anchor' | 'different-edition' | 'missing-passage' };
/** Resolve against imported text. Never apply another edition's synthetic page number. */
export function restoreLibraryProgress(book: Book, entry: LibraryBackupEntry, pages: readonly BookContentPage[]): BackupProgressResult {
  // Completion belongs to the matching work; it does not supply a reading location.
  if (typeof entry.isFinished === 'boolean' && (backupBookKey(book) === backupBookKey(entry) ||
    fingerprint(book.documentFingerprint) && entry.documentFingerprint === book.documentFingerprint)) book = { ...book, isFinished: entry.isFinished };
  const saved = entry.readingPosition, anchor = saved?.anchor;
  if (!validSourceAnchor(anchor)) return { book, restored: false, reason: 'missing-anchor' };
  if (!fingerprint(book.documentFingerprint) || entry.documentFingerprint !== book.documentFingerprint || anchor.edition !== book.documentFingerprint) return { book, restored: false, reason: 'different-edition' };
  const target = resolveSourceAnchor(anchor, pages);
  if (!target) return { book, restored: false, reason: 'missing-passage' };
  const page = pages[target.index];
  const position: ReadingPosition = { pageNumber: page.pageNumber, wordOffset: target.wordOffset, anchor };
  const restored = applyReadingPosition(book, page, pages.length, position, book.lastOpened);
  return { restored: true, book: { ...restored, isFinished: entry.isFinished ?? book.isFinished } };
}

export function backupProgressNotice(result: BackupProgressResult): string {
  if (result.restored) return `Restored the saved passage in “${result.book.title}”.`;
  if (result.reason === 'different-edition') return 'This edition differs from your backup. Reading starts at the beginning; import the original EPUB to recover its saved passage.';
  if (result.reason === 'missing-passage') return 'The saved passage could not be found in this copy. Reading starts at the beginning; your backup is unchanged.';
  return 'This older backup has no exact saved passage. Reading starts at the beginning; your backup is unchanged.';
}

export function hasBackupReadingProgress(entry: LibraryBackupEntry): boolean {
  return Boolean(entry.readingPosition || entry.isFinished || (entry.currentPage ?? 1) > 1 || (entry.progressPercent ?? 0) > 1);
}
export function backupBookKey(book: Pick<Book, 'title' | 'author'>): string {
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return JSON.stringify([normalize(book.title), normalize(book.author)]);
}
export function matchingLibraryBackupEntry(book: Book, entries: readonly LibraryBackupEntry[]): LibraryBackupEntry | undefined {
  return (fingerprint(book.documentFingerprint) ? entries.find(entry => entry.documentFingerprint === book.documentFingerprint) : undefined)
    ?? entries.find(entry => backupBookKey(entry) === backupBookKey(book));
}
