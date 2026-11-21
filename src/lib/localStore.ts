import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Book, BookContentPage } from '../types';
import { CoverSaveError } from './bookCover';
import { ImportStorageError, ImportCollisionError } from './bookImport';

/**
 * Local-first persistence. The web app kept imported EPUB text only in memory,
 * so it vanished on reload; on a phone that would be painful, so we persist:
 *  - small JSON state (books, settings, goal, highlights, lexicon) in AsyncStorage
 *  - parsed book pages and covers as files in the app's document directory
 */

const pendingWrites = new Map<string, Promise<void>>();

export function createLocalStore(scope?: string) {
  const KEY_PREFIX = scope ? `folio.v2.${encodeURIComponent(scope)}.` : 'folio.v1.';
  const ROOT = scope ? new Directory(Paths.document, 'folio', 'accounts', encodeURIComponent(scope)) : new Directory(Paths.document, 'folio');
  const storageKey = (key: string) => KEY_PREFIX + key;
  function fileKey(bookId: string): string {
    if (typeof bookId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(bookId)) {
      throw new Error('Invalid local book identifier.');
    }
    return bookId;
  }

  async function loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }> {
    await pendingWrites.get(storageKey(key))?.catch(() => undefined);
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    return raw === null ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
  }

  async function loadJSONStrict<T>(key: string): Promise<T | null> {
    const entry = await loadJSONEntryStrict(key);
    return entry.present ? entry.value as T : null;
  }

  async function loadJSON<T>(key: string): Promise<T | null> {
    try { return await loadJSONStrict<T>(key); }
    catch { return null; }
  }

  /** Queue each key so an older asynchronous write cannot finish after a newer one. */
  function saveJSONStrict(key: string, value: unknown): Promise<void> {
    const data = JSON.stringify(value);
    const previous = pendingWrites.get(storageKey(key)) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => AsyncStorage.setItem(KEY_PREFIX + key, data));
    pendingWrites.set(storageKey(key), operation);
    void operation.finally(() => {
      if (pendingWrites.get(storageKey(key)) === operation) pendingWrites.delete(storageKey(key));
    }).catch(() => undefined);
    return operation;
  }

  async function saveJSON(key: string, value: unknown): Promise<void> {
    try {
      await saveJSONStrict(key, value);
    } catch (err) {
      console.warn(`Failed to persist ${key}:`, err);
    }
  }

  function ensureDir(...segments: string[]): Directory {
    const dir = new Directory(ROOT, ...segments);
    if (!dir.exists) dir.create({ intermediates: true });
    return dir;
  }

  function coversDir(): Directory {
    return ensureDir('covers');
  }

  function savePages(bookId: string, pages: BookContentPage[]): void {
    try {
      const dir = ensureDir('pages');
      const file = new File(dir, `${fileKey(bookId)}.json`);
      if (file.exists) throw new ImportCollisionError('A saved reading copy already uses this identifier. Its files have been kept. Import the EPUB again.');
      if (!file.exists) file.create();
      file.write(JSON.stringify(pages));
    } catch (err) {
      if (err instanceof ImportCollisionError) throw err;
      console.warn('Failed to save book pages:', err);
      throw new ImportStorageError('Could not save the reading text. Check available storage and try importing again.');
    }
  }

  function getBookPagesLocation(bookId: string): string {
    return new File(ROOT, 'pages', `${fileKey(bookId)}.json`).uri;
  }

  function persistBookFile(sourceUri: string, bookId: string): string {
    try {
      const dir = ensureDir('books');
      const destination = new File(dir, `${fileKey(bookId)}.epub`);
      if (destination.exists) throw new ImportCollisionError('A saved original already uses this identifier. Its files have been kept. Import the EPUB again.');
      const source = new File(sourceUri);
      source.copy(destination);
      if (!destination.exists || !destination.size || destination.size !== source.size) throw new Error('Incomplete EPUB copy');
      return destination.uri;
    } catch (err) {
      if (err instanceof ImportCollisionError) throw err;
      console.warn(`Failed to persist EPUB file for book ${bookId}:`, err);
      throw new ImportStorageError('Could not save the EPUB file. Check available storage and try importing again.');
    }
  }

  function customCoverName(bookId: string, uri: string): string | null {
    const id = fileKey(bookId);
    const prefix = new Directory(ROOT, 'covers').uri.replace(/\/?$/, '/');
    if (!uri.startsWith(prefix)) return null;
    const name = uri.slice(prefix.length);
    // Double separators keep IDs ending in digits distinct from another book's timestamp.
    const owned = new RegExp(`^(?:custom-${id}--[0-9]+-[a-z0-9]+|custom-${id}-[0-9]{13})\\.(?:jpg|jpeg|png|webp|heic|heif|avif|gif)$`);
    return owned.test(name) ? name : null;
  }

  function removeBookFiles(bookId: string, coverUrl?: string): boolean {
    try { fileKey(bookId); } catch { return false; }
    let cleaned = true;
    const remove = (createFile: () => File) => {
      try {
        const file = createFile();
        if (file.exists) file.delete();
      } catch (error) { cleaned = false; console.warn('Could not remove a local book file:', error); }
    };
    // Try every file even if an earlier deletion fails. Never delete the source EPUB.
    remove(() => new File(ROOT, 'pages', `${fileKey(bookId)}.json`));
    remove(() => new File(ROOT, 'books', `${fileKey(bookId)}.epub`));
    try {
      const coverDirectoryUri = new Directory(ROOT, 'covers').uri.replace(/\/?$/, '/');
      const isImportedCover = coverUrl?.startsWith(`${coverDirectoryUri}${bookId}.`);
      const isCustomCover = coverUrl ? customCoverName(bookId, coverUrl) !== null : false;
      if (coverUrl?.startsWith('file://') && (isImportedCover || isCustomCover)) remove(() => new File(coverUrl));
    } catch (error) { cleaned = false; console.warn('Could not locate the cover for cleanup:', error); }
    return cleaned;
  }

  async function loadPages(bookId: string): Promise<BookContentPage[] | null> {
    try {
      const file = new File(ROOT, 'pages', `${fileKey(bookId)}.json`);
      if (!file.exists) return null;
      return JSON.parse(await file.text()) as BookContentPage[];
    } catch {
      return null;
    }
  }

  async function verifyImportedBook(book: Book): Promise<boolean> {
    const original = new File(ROOT, 'books', `${fileKey(book.id)}.epub`);
    if (book.fileLocation !== original.uri || !original.exists || !original.size || (book.fileSizeBytes !== undefined && original.size !== book.fileSizeBytes)) return false;
    const pages = await loadPages(book.id);
    return Array.isArray(pages) && pages.length > 0 && pages.length === book.totalPages && new Set(pages.map(page => page?.pageNumber)).size === pages.length &&
      pages.every(page => page && ['chapterTitle', 'chapterNumber', 'folioNumber', 'dropCap', 'paragraph1', 'paragraph2Lead', 'highlightedText', 'paragraph2Rest'].every(key => typeof page[key as keyof BookContentPage] === 'string') &&
        ['pageNumber', 'totalBookPages', 'locNumber', 'totalLoc', 'minutesLeftInChapter'].every(key => { const value = page[key as keyof BookContentPage]; return typeof value === 'number' && Number.isFinite(value) && value >= 0; }) && Number.isSafeInteger(page.pageNumber) && page.pageNumber > 0);
  }

  /** Delete only owned custom-cover filenames; imported/original/other-account files stay intact. */
  function removeCustomCover(bookId: string, uri: string): boolean {
    try {
      const name = customCoverName(bookId, uri);
      if (!name) return true;
      const file = new File(ROOT, 'covers', name);
      if (file.exists) file.delete();
      return true;
    } catch { return false; }
  }

  /** Return a durable photo copy or throw; never substitute an ephemeral picker URI. */
  function persistCoverImage(sourceUri: string, bookId: string): string {
    let destination: File | undefined;
    let copyStarted = false;
    try {
      const id = fileKey(bookId);
      if (!/^(?:file|content):\/\//i.test(sourceUri)) throw new Error('Unsupported picked photo URI');
      const suffix = sourceUri.split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
      const ext = suffix && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'gif'].includes(suffix) ? suffix : 'jpg';
      const suffixId = Math.random().toString(36).slice(2, 10) || '0';
      const name = `custom-${id}--${Date.now()}-${suffixId}.${ext}`;
      destination = new File(coversDir(), name);
      if (destination.exists) throw new Error('Cover destination already exists');
      copyStarted = true;
      new File(sourceUri).copy(destination);
      if (!destination.exists || !destination.size) throw new Error('Empty cover copy');
      return destination.uri;
    } catch {
      let cleaned = true;
      try { if (copyStarted && destination?.exists) destination.delete(); } catch { cleaned = false; }
      throw new CoverSaveError(cleaned ? 'Could not save the selected photo on this device. Your current cover has been kept.'
        : 'Could not save the selected photo. Some incomplete cover files could not be removed.');
    }
  }

  async function readBackupAsset(bookId: string, kind: 'pages' | 'epub' | 'cover', coverUrl?: string): Promise<Uint8Array | null> {
    const id = fileKey(bookId);
    const file = kind === 'pages' ? new File(ROOT, 'pages', `${id}.json`) : kind === 'epub' ? new File(ROOT, 'books', `${id}.epub`) : (() => {
      if (!coverUrl) return null;
      const prefix = new Directory(ROOT, 'covers').uri.replace(/\/?$/, '/');
      const imported = coverUrl.startsWith(prefix) && new RegExp(`^${id}\\.(?:png|jpg|jpeg|webp|gif|avif|heic|heif)$`).test(coverUrl.slice(prefix.length));
      return imported || customCoverName(id, coverUrl) ? new File(coverUrl) : null;
    })();
    if (!file?.exists) return null;
    // Inspect before allocating an entire file in JavaScript memory.
    if (file.size > 48 * 1024 * 1024) throw new Error('A book file is too large for this safety copy. Try excluding original EPUB files.');
    return file.bytes();
  }

  function writeRecoveryAsset(bookId: string, kind: 'pages' | 'epub' | 'cover', bytes: Uint8Array, extension = 'jpg'): string {
    const id = fileKey(bookId);
    if (kind === 'cover' && !['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'heif'].includes(extension)) throw new Error('Unsupported recovery artwork.');
    const folder = kind === 'pages' ? 'pages' : kind === 'epub' ? 'books' : 'covers';
    const suffix = kind === 'pages' ? 'json' : kind === 'epub' ? 'epub' : extension;
    const file = new File(ensureDir(folder), `${id}.${suffix}`);
    if (file.exists) throw new Error('This recovery file already exists.');
    try {
      file.create(); file.write(bytes);
      if (!file.exists || file.size !== bytes.length) throw new Error('Incomplete recovery file');
      return file.uri;
    } catch {
      let cleaned = true;
      try { if (file.exists) file.delete(); } catch { cleaned = false; }
      throw new Error(cleaned ? 'The recovery file could not be saved completely. Check available storage.' : 'The recovery file could not be saved completely, and an incomplete file remains on this device.');
    }
  }

  return { storageKey, loadJSON, loadJSONStrict, loadJSONEntryStrict, saveJSON, saveJSONStrict, coversDir, savePages, getBookPagesLocation, persistBookFile, removeBookFiles, removeCustomCover, loadPages, persistCoverImage, readBackupAsset, writeRecoveryAsset, verifyImportedBook };
}

export type LocalStore = ReturnType<typeof createLocalStore>;
export const { loadJSON, loadJSONStrict, saveJSON, saveJSONStrict, coversDir, savePages, getBookPagesLocation, persistBookFile, removeBookFiles, removeCustomCover, loadPages, persistCoverImage } = createLocalStore();
