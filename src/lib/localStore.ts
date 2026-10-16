import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { BookContentPage } from '../types';

/**
 * Local-first persistence. The web app kept imported EPUB text only in memory,
 * so it vanished on reload; on a phone that would be painful, so we persist:
 *  - small JSON state (books, settings, goal, highlights, lexicon) in AsyncStorage
 *  - parsed book pages and covers as files in the app's document directory
 */

const KEY_PREFIX = 'folio.v1.';

export async function loadJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
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
  }
}

export function getBookPagesLocation(bookId: string): string {
  return new File(Paths.document, 'folio', 'pages', `${bookId}.json`).uri;
}

export function persistBookFile(sourceUri: string, bookId: string): string | undefined {
  try {
    const dir = ensureDir('folio', 'books');
    const destination = new File(dir, `${bookId}.epub`);
    new File(sourceUri).copy(destination);
    return destination.uri;
  } catch (err) {
    console.warn(`Failed to persist EPUB file for book ${bookId}:`, err);
    return undefined;
  }
}

export function removeBookFiles(bookId: string, coverUrl?: string): void {
  try {
    const pagesFile = new File(Paths.document, 'folio', 'pages', `${bookId}.json`);
    if (pagesFile.exists) pagesFile.delete();
    const epubFile = new File(Paths.document, 'folio', 'books', `${bookId}.epub`);
    if (epubFile.exists) epubFile.delete();

    const coverDirectoryUri = `${coversDir().uri.replace(/\/?$/, '/')}`;
    const isImportedCover = coverUrl?.startsWith(`${coverDirectoryUri}${bookId}.`);
    const isCustomCover = coverUrl?.includes(`/custom-${bookId}-`);
    if (coverUrl?.startsWith('file://') && (isImportedCover || isCustomCover)) {
      const coverFile = new File(coverUrl);
      if (coverFile.exists) coverFile.delete();
    }
  } catch (err) {
    console.warn(`Failed to remove local files for book ${bookId}:`, err);
  }
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
