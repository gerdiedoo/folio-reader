import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { BookContentPage } from '../types';
import { ImportStorageError } from './bookImport';

/**
 * Local-first persistence. The web app kept imported EPUB text only in memory,
 * so it vanished on reload; on a phone that would be painful, so we persist:
 *  - small JSON state (books, settings, goal, highlights, lexicon) in AsyncStorage
 *  - parsed book pages and covers as files in the app's document directory
 */

const KEY_PREFIX = 'folio.v1.';
const pendingWrites = new Map<string, Promise<void>>();

export async function loadJSONStrict<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
  return raw === null ? null : JSON.parse(raw) as T;
}

export async function loadJSON<T>(key: string): Promise<T | null> {
  try { return await loadJSONStrict<T>(key); }
  catch { return null; }
}

/** Queue each key so an older asynchronous write cannot finish after a newer one. */
export function saveJSONStrict(key: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => AsyncStorage.setItem(KEY_PREFIX + key, data));
  pendingWrites.set(key, operation);
  void operation.finally(() => {
    if (pendingWrites.get(key) === operation) pendingWrites.delete(key);
  }).catch(() => undefined);
  return operation;
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await saveJSONStrict(key, value);
  } catch (err) {
    console.warn(`Failed to persist ${key}:`, err);
  }
}

function ensureDir(...segments: string[]): Directory {
  const dir = new Directory(Paths.document, ...segments);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function coversDir(): Directory {
  return ensureDir('folio', 'covers');
}

export function savePages(bookId: string, pages: BookContentPage[]): void {
  try {
    const dir = ensureDir('folio', 'pages');
    const file = new File(dir, `${bookId}.json`);
    if (!file.exists) file.create();
    file.write(JSON.stringify(pages));
  } catch (err) {
    console.warn('Failed to save book pages:', err);
    throw new ImportStorageError('Could not save the reading text. Check available storage and try importing again.');
  }
}

export function getBookPagesLocation(bookId: string): string {
  return new File(Paths.document, 'folio', 'pages', `${bookId}.json`).uri;
}

export function persistBookFile(sourceUri: string, bookId: string): string {
  try {
    const dir = ensureDir('folio', 'books');
    const destination = new File(dir, `${bookId}.epub`);
    new File(sourceUri).copy(destination);
    return destination.uri;
  } catch (err) {
    console.warn(`Failed to persist EPUB file for book ${bookId}:`, err);
    throw new ImportStorageError('Could not save the EPUB file. Check available storage and try importing again.');
  }
}

export function removeBookFiles(bookId: string, coverUrl?: string): boolean {
  let cleaned = true;
  const remove = (createFile: () => File) => {
    try {
      const file = createFile();
      if (file.exists) file.delete();
    } catch (error) { cleaned = false; console.warn('Could not remove a local book file:', error); }
  };
  // Try every file even if an earlier deletion fails. Never delete the source EPUB.
  remove(() => new File(Paths.document, 'folio', 'pages', `${bookId}.json`));
  remove(() => new File(Paths.document, 'folio', 'books', `${bookId}.epub`));
  try {
    const coverDirectoryUri = new Directory(Paths.document, 'folio', 'covers').uri.replace(/\/?$/, '/');
    const isImportedCover = coverUrl?.startsWith(`${coverDirectoryUri}${bookId}.`);
    const isCustomCover = coverUrl?.startsWith(`${coverDirectoryUri}custom-${bookId}-`);
    if (coverUrl?.startsWith('file://') && (isImportedCover || isCustomCover)) remove(() => new File(coverUrl));
  } catch (error) { cleaned = false; console.warn('Could not locate the cover for cleanup:', error); }
  return cleaned;
}

export async function loadPages(bookId: string): Promise<BookContentPage[] | null> {
  try {
    const file = new File(Paths.document, 'folio', 'pages', `${bookId}.json`);
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as BookContentPage[];
  } catch {
    return null;
  }
}

/** Copies a picked image (cache location) into permanent storage and returns its URI. */
export function persistCoverImage(sourceUri: string, bookId: string): string {
  try {
    const dir = coversDir();
    const ext = (sourceUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
    const dest = new File(dir, `custom-${bookId}-${Date.now()}.${ext}`);
    new File(sourceUri).copy(dest);
    return dest.uri;
  } catch (err) {
    console.warn('Failed to persist cover image:', err);
    return sourceUri;
  }
}
