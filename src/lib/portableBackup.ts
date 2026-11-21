import JSZip from 'jszip';
import type { Book, BookContentPage, Bookmark, HighlightEntry, LexiconEntry, ReadingGoal, ReadingSettings } from '../types';
import { validLibraryBook } from './libraryStore';
import { validHighlight } from './highlightArchive';
import { validLexiconEntry } from './lexiconArchive';
import { readBookmarks } from './bookmarks';
import { normalizeReaderSettings } from './readerPreferences';
import { validSourceAnchor } from './sourceAnchors';
import { validatedBookPages } from './bookPages';

// This in-memory implementation deliberately bounds both compressed and expanded data.
export const BACKUP_LIMIT = 48 * 1024 * 1024;
const EXPANDED_LIMIT = 96 * 1024 * 1024;
const ENTRY_LIMIT = 1200;
const MANIFEST_LIMIT = 8 * 1024 * 1024;
const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw Error('This safety copy is damaged, too large, or uses an unsupported format. No saved work was changed.'); };
interface BackupBook { book: Book; pages?: string; epub?: string; cover?: string }
export interface BackupSnapshot {
  books: Book[]; highlights: HighlightEntry[]; lexicon: LexiconEntry[]; bookmarks: Bookmark[];
  settings: ReadingSettings; goal: ReadingGoal | null;
}
interface Manifest extends Omit<BackupSnapshot, 'books'> {
  format: 'folio-backup'; version: 1; createdAt: string; books: BackupBook[];
}
export interface PreparedBackup {
  manifest: Manifest;
  files: ReadonlyMap<string, Uint8Array>;
  summary: { books: number; originals: number; readable: number; highlights: number; vocabulary: number; bookmarks: number };
}
export interface BackupAssets {
  readPages(bookId: string): Promise<Uint8Array | null>;
  readOriginal(book: Book): Promise<Uint8Array | null>;
  readCover(book: Book): Promise<{ bytes: Uint8Array; extension: string } | null>;
}

/** Strip device paths and unknown fields; only explicitly supported metadata travels. */
export function portableBook(value: unknown): Book {
  if (!validLibraryBook(value)) return fail();
  const b = value as Book;
  if (![b.minutesLeft, b.currentLoc ?? 0, b.totalLoc ?? 0].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) ||
    ![b.currentChapter, b.lastOpened, b.coverAlt].every(s => typeof s === 'string') ||
    (b.genres !== undefined && (!Array.isArray(b.genres) || !b.genres.every(s => typeof s === 'string')))) return fail();
  const result: Book = { id: b.id, title: b.title, author: b.author, coverUrl: '', currentPage: b.currentPage, totalPages: b.totalPages,
    progressPercent: b.progressPercent, minutesLeft: b.minutesLeft, currentChapter: b.currentChapter, lastOpened: b.lastOpened, coverAlt: b.coverAlt };
  for (const key of ['annotation', 'documentLanguage', 'documentIdentifier', 'documentFingerprint', 'fileFormat'] as const) {
    if (b[key] !== undefined) { if (typeof b[key] !== 'string') return fail(); result[key] = b[key]; }
  }
  for (const key of ['isFinished', 'isWantToRead'] as const) {
    if (b[key] !== undefined) { if (typeof b[key] !== 'boolean') return fail(); result[key] = b[key]; }
  }
  if (b.genres) result.genres = [...b.genres];
  if (b.coverStyle === 'image' || b.coverStyle === 'typographic') result.coverStyle = b.coverStyle;
  if (['parchment', 'terracotta', 'slate', 'sage'].includes(b.coverTint ?? '')) result.coverTint = b.coverTint;
  if (b.currentLoc !== undefined) result.currentLoc = b.currentLoc;
  if (b.totalLoc !== undefined) result.totalLoc = b.totalLoc;
  if (b.fileSizeBytes !== undefined && Number.isSafeInteger(b.fileSizeBytes) && b.fileSizeBytes >= 0) result.fileSizeBytes = b.fileSizeBytes;
  if (b.readingPosition) {
    const p = b.readingPosition;
    if (!Number.isSafeInteger(p.pageNumber) || p.pageNumber < 1 || (p.wordOffset !== undefined && (!Number.isSafeInteger(p.wordOffset) || p.wordOffset < 0))) return fail();
    // Device-specific pixel offsets do not travel between screens.
    result.readingPosition = { pageNumber: p.pageNumber, ...(p.wordOffset !== undefined ? { wordOffset: p.wordOffset } : {}) };
    if (p.anchor !== undefined) { if (!validSourceAnchor(p.anchor)) return fail(); result.readingPosition.anchor = { ...p.anchor }; }
  }
  return result;
}

export function validateBackupPages(value: unknown): BookContentPage[] {
  try { return validatedBookPages(value); } catch { return fail(); }
}

export function backupGoal(value: unknown): ReadingGoal | null {
  if (value === null) return null;
  if (!isRecord(value) || !['minutesReadToday', 'dailyTargetMinutes', 'streakDays', 'booksFinishedYear', 'yearTargetBooks'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)) return fail();
  return value as ReadingGoal;
}
function uniqueEntries<T extends { id: string }>(items: unknown, valid: (item: unknown) => boolean): T[] {
  if (!Array.isArray(items) || items.length > 50000 || !items.every(valid) || new Set(items.map(item => item.id)).size !== items.length) return fail();
  return items;
}
function parseManifest(value: unknown): Manifest {
  if (!isRecord(value) || value.format !== 'folio-backup' || value.version !== 1 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.books) || value.books.length > 350 || !isRecord(value.settings)) return fail();
  const books: BackupBook[] = value.books.map((item: unknown, index: number) => {
    if (!isRecord(item)) return fail();
    const book = portableBook(item.book), result: BackupBook = { book };
    for (const key of ['pages', 'epub', 'cover'] as const) {
      if (item[key] === undefined) continue;
      const expected = key === 'pages' ? `pages/${index}.json` : key === 'epub' ? `books/${index}.epub` : null;
      if (expected ? item[key] !== expected : typeof item[key] !== 'string' || !new RegExp(`^covers/${index}\\.(png|jpg|jpeg|webp|gif|avif|heic|heif)$`).test(item[key])) return fail();
      result[key] = item[key];
    }
    return result;
  });
  if (new Set(books.map(b => b.book.id)).size !== books.length) return fail();
  return { format: 'folio-backup', version: 1, createdAt: value.createdAt, books,
    highlights: uniqueEntries<HighlightEntry>(value.highlights, validHighlight), lexicon: uniqueEntries<LexiconEntry>(value.lexicon, validLexiconEntry),
    bookmarks: readBookmarks(JSON.stringify(value.bookmarks)), settings: normalizeReaderSettings(value.settings), goal: backupGoal(value.goal) };
}

/** Inspect ZIP directory sizes before JSZip can inflate any entry (including a ZIP bomb). */
function inspectZip(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  if (bytes.length > BACKUP_LIMIT || bytes.length < 22) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65557) || end + 22 + view.getUint16(end + 20, true) !== bytes.length || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) return fail();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > ENTRY_LIMIT || count !== view.getUint16(end + 8, true) || offset + directorySize !== end) return fail();
  let at = offset, expanded = 0;
  const names = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50 || (view.getUint16(at + 8, true) & 1) || ![0, 8].includes(view.getUint16(at + 10, true))) return fail();
    const size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength + extraLength + commentLength > end || size === 0xffffffff || view.getUint32(at + 20, true) === 0xffffffff || view.getUint32(at + 42, true) >= offset) return fail();
    let name = ''; for (const byte of bytes.subarray(at + 46, at + 46 + nameLength)) name += String.fromCharCode(byte);
    if (!/^(?:folio\.json|(?:pages\/\d+\.json)|(?:books\/\d+\.epub)|(?:covers\/\d+\.(?:png|jpg|jpeg|webp|gif|avif|heic|heif)))$/.test(name) || names.has(name)) return fail();
    names.set(name, { size, crc: view.getUint32(at + 16, true) }); expanded += size;
    if (expanded > EXPANDED_LIMIT || (name === 'folio.json' && size > MANIFEST_LIMIT)) return fail();
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end || !names.has('folio.json')) return fail();
  return names;
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
interface InflateStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): InflateStream;
  on(event: 'error', callback: (error: Error) => void): InflateStream;
  on(event: 'end', callback: () => void): InflateStream;
  pause(): InflateStream;
  resume(): InflateStream;
}
/** Bound actual inflated bytes too: directory sizes can lie. Stop the stream immediately. */
function inflate(entry: JSZip.JSZipObject, expected: { size: number; crc: number }): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let length = 0, crc = -1, failed = false;
    // JSZip documents this browser stream helper but omits it from JSZipObject's typings.
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): InflateStream }).internalStream('uint8array');
    const stop = () => { failed = true; stream.pause(); reject(Error('Invalid safety copy data.')); };
    stream.on('data', (chunk: Uint8Array) => {
      if (failed) return;
      length += chunk.length;
      if (length > expected.size || length > EXPANDED_LIMIT) { stop(); return; }
      for (const byte of chunk) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
      chunks.push(chunk);
    }).on('error', reject).on('end', () => {
      if (failed) return;
      if (length !== expected.size || ((crc ^ -1) >>> 0) !== expected.crc) { stop(); return; }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}
const decodeJSON = async (bytes: Uint8Array) => JSON.parse(await new JSZip().file('text', bytes).file('text')!.async('string'));
export async function inspectPortableBackup(bytes: Uint8Array): Promise<PreparedBackup> {
  try {
    const directory = inspectZip(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = parseManifest(await decodeJSON(await inflate(zip.file('folio.json')!, directory.get('folio.json')!)));
    const expected = new Set(['folio.json']), files = new Map<string, Uint8Array>();
    for (const item of manifest.books) for (const key of ['pages', 'epub', 'cover'] as const) {
      const path = item[key]; if (!path) continue;
      const entry = zip.file(path); if (!entry || expected.has(path)) return fail();
      expected.add(path);
      const content = await inflate(entry, directory.get(path)!); if (!content.length) return fail();
      if (key === 'pages') validateBackupPages(await decodeJSON(content));
      if (key === 'epub' && (content[0] !== 0x50 || content[1] !== 0x4b)) return fail();
      files.set(path, content);
    }
    if (Object.keys(zip.files).some(path => !expected.has(path))) return fail();
    return { manifest, files, summary: { books: manifest.books.length, originals: manifest.books.filter(b => b.epub).length, readable: manifest.books.filter(b => b.pages).length,
      highlights: manifest.highlights.length, vocabulary: manifest.lexicon.length, bookmarks: manifest.bookmarks.length } };
  } catch { return fail(); }
}

export async function buildPortableBackup(snapshot: BackupSnapshot, assets: BackupAssets, includeOriginals: boolean): Promise<Uint8Array> {
  const zip = new JSZip();
  const books: BackupBook[] = []; let expanded = 0;
  const add = (name: string, bytes: Uint8Array) => {
    expanded += bytes.length;
    if (expanded > EXPANDED_LIMIT) throw Error('This library is too large for one safety copy. Try excluding original EPUB files.');
    zip.file(name, bytes, { createFolders: false });
  };
  for (const [index, source] of snapshot.books.entries()) {
    const item: BackupBook = { book: portableBook(source) };
    const pages = await assets.readPages(source.id);
    if (pages) { item.pages = `pages/${index}.json`; add(item.pages, pages); }
    const original = includeOriginals ? await assets.readOriginal(source) : null;
    if (original) { item.epub = `books/${index}.epub`; add(item.epub, original); }
    const cover = await assets.readCover(source);
    if (cover) { item.cover = `covers/${index}.${cover.extension}`; add(item.cover, cover.bytes); }
    books.push(item);
  }
  const manifest: Manifest = { ...snapshot, books, format: 'folio-backup', version: 1, createdAt: new Date().toISOString() };
  const json = JSON.stringify(manifest);
  if (json.length > MANIFEST_LIMIT) throw Error('Saved notes are too large for one safety copy. Export a smaller collection.');
  zip.file('folio.json', json, { createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  if (bytes.length > BACKUP_LIMIT) throw Error('This safety copy is too large. Try excluding original EPUB files.');
  // Export must pass exactly the same checks used by restore before it can be shared.
  await inspectPortableBackup(bytes);
  return bytes;
}
