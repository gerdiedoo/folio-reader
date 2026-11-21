import { createLibraryStore } from './libraryStore';
import { createHighlightArchive } from './highlightArchive';
import { createLexiconArchive } from './lexiconArchive';
import { createReaderSettingsStore } from './readerSettingsStore';
import { readBookmarks } from './bookmarks';
import { backupGoal, portableBook, type BackupSnapshot, type PreparedBackup } from './portableBackup';
import type { Book } from '../types';

interface Storage {
  storageKey(key: string): string;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
export interface RestoreFiles {
  write(id: string, kind: 'pages' | 'epub' | 'cover', bytes: Uint8Array, extension?: string): string;
  remove(id: string, cover?: string): boolean;
}
const KEY = 'restoreJournal';
const TARGETS = ['libraryArchive', 'highlightArchive', 'lexiconArchive', 'bookmarks', 'settingsArchive', 'goal'] as const;
type Values = { [K in typeof TARGETS[number]]: unknown };
interface Journal { version: 1; kind: 'portable-restore' | 'book-removal'; values: Values }

/** Call with the reading UI unmounted. Queue barriers drain all earlier archive writes. */
export async function readBackupSnapshot(storage: Storage): Promise<BackupSnapshot> {
  const [library, notes, words, preferences] = await Promise.all([
    createLibraryStore(storage).load(), createHighlightArchive(storage).load(), createLexiconArchive(storage).load(), createReaderSettingsStore(storage).load(),
  ]);
  const [bookmarks, goal] = await Promise.all([storage.loadJSONEntryStrict('bookmarks'), storage.loadJSONEntryStrict('goal')]);
  return { books: library.books, highlights: notes.items, lexicon: words.items,
    bookmarks: readBookmarks(bookmarks.present ? JSON.stringify(bookmarks.value) : null), settings: preferences.settings, goal: goal.present ? backupGoal(goal.value) : null };
}

async function validateJournal(value: unknown): Promise<Journal> {
  const j = value as Journal;
  if (!j || j.version !== 1 || !['portable-restore', 'book-removal'].includes(j.kind) || !j.values || Object.keys(j.values).length !== TARGETS.length || TARGETS.some(key => !Object.hasOwn(j.values, key))) throw Error('The recovery journal could not be read. Existing saved work has been kept.');
  // Reuse the real archive validators before replaying any partially applied write.
  const preview: Storage = { storageKey: key => `journal-check:${key}`, saveJSONStrict: async () => { throw Error('Read only'); },
    loadJSONEntryStrict: async key => ({ present: Object.hasOwn(j.values, key), value: j.values[key as keyof Values] }) };
  await readBackupSnapshot(preview);
  return j;
}

export async function hasPendingRestore(storage: Storage): Promise<boolean> {
  const entry = await storage.loadJSONEntryStrict(KEY);
  return entry.present && entry.value !== null;
}

/** Idempotent roll-forward: the library stays closed until every journaled key is acknowledged. */
export async function recoverPortableRestore(storage: Storage): Promise<void> {
  const entry = await storage.loadJSONEntryStrict(KEY);
  if (!entry.present || entry.value === null) return;
  const journal = await validateJournal(entry.value);
  for (const key of TARGETS) await storage.saveJSONStrict(key, journal.values[key]);
  await storage.saveJSONStrict(KEY, null);
}

/** Run with archive hooks unmounted. A saved intent completes before reopening Library. */
export async function removeBookWithRecovery(storage: Storage, bookId: string): Promise<string> {
  await recoverPortableRestore(storage);
  const [library, notes, words] = await Promise.all([createLibraryStore(storage).load(), createHighlightArchive(storage).load(), createLexiconArchive(storage).load()]);
  const current = await readBackupSnapshot(storage);
  const book = library.books.find(item => item.id === bookId);
  if (!book) throw Error('This book is no longer in this reading space.');
  const journal: Journal = { version: 1, kind: 'book-removal', values: {
    libraryArchive: { ...library, books: library.books.filter(item => item.id !== bookId), removedBookIds: [...new Set([...library.removedBookIds, bookId])],
      pendingFileRemovals: [...library.pendingFileRemovals.filter(item => item.id !== bookId), { id: bookId, coverUrl: book.coverUrl }] },
    highlightArchive: { ...notes, items: notes.items.filter(item => item.bookId !== bookId), removedBookIds: [...new Set([...notes.removedBookIds, bookId])],
      removedIds: [...new Set([...notes.removedIds, ...notes.items.filter(item => item.bookId === bookId).map(item => item.id)])] },
    lexiconArchive: { ...words, items: words.items.filter(item => item.bookId !== bookId), removedBookIds: [...new Set([...words.removedBookIds, bookId])] },
    bookmarks: current.bookmarks.filter(item => item.bookId !== bookId),
    settingsArchive: { version: 1, settings: current.settings }, goal: current.goal,
  } };
  await validateJournal(journal);
  await storage.saveJSONStrict(KEY, journal);
  await recoverPortableRestore(storage);
  return book.title;
}

/** Add independently identified copies; existing books, annotations and deletion markers survive. */
export async function restorePortableBackup(storage: Storage, backup: PreparedBackup, files: RestoreFiles, restorePreferences = false, nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(nonce)) throw Error('Invalid recovery identifier.');
  await recoverPortableRestore(storage);
  const [library, notes, words, preferences] = await Promise.all([
    createLibraryStore(storage).load(), createHighlightArchive(storage).load(), createLexiconArchive(storage).load(), createReaderSettingsStore(storage).load(),
  ]);
  const current = await readBackupSnapshot(storage);
  const source = backup.manifest;
  const links = new Map<string, string>();
  for (const [index, item] of source.books.entries()) links.set(item.book.id, `restore-${nonce}-${index}`);
  const relatedId = (id: string) => {
    if (!links.has(id)) links.set(id, `restore-${nonce}-reference-${links.size}`);
    return links.get(id)!;
  };
  const created: Book[] = []; let journalAttempted = false;
  try {
    for (const item of source.books) {
      const id = relatedId(item.book.id);
      if (library.books.some(book => book.id === id) || library.removedBookIds.includes(id)) throw Error('This recovery copy already exists. Choose the file again to make a new copy.');
      const book = { ...portableBook(item.book), id, isDownloaded: Boolean(item.pages) };
      created.push(book); // Track partial file writes for cleanup before the journal exists.
      for (const key of ['pages', 'epub', 'cover'] as const) {
        const path = item[key]; if (!path) continue;
        const bytes = backup.files.get(path); if (!bytes) throw Error('A recovery file is missing.');
        const uri = files.write(id, key, bytes, key === 'cover' ? path.split('.').pop() : undefined);
        if (key === 'epub') book.fileLocation = uri;
        if (key === 'cover') book.coverUrl = uri;
      }
    }
    const highlights = source.highlights.map((item, index) => ({ ...item, id: `restore-${nonce}-note-${index}`, bookId: relatedId(item.bookId) }));
    const lexicon = source.lexicon.map((item, index) => ({ ...item, id: `restore-${nonce}-word-${index}`, bookId: relatedId(item.bookId),
      phonetic: item.phonetic ?? '', partOfSpeech: item.partOfSpeech ?? '', contextPassage: item.contextPassage ?? '', chapter: item.chapter ?? '' }));
    const bookmarks = source.bookmarks.map(item => { const bookId = relatedId(item.bookId); return { ...item, bookId, id: `${bookId}:${item.pageNumber}` }; });
    const journal: Journal = { version: 1, kind: 'portable-restore', values: {
      libraryArchive: { ...library, books: [...created, ...library.books] },
      highlightArchive: { ...notes, items: [...highlights, ...notes.items] },
      lexiconArchive: { ...words, items: [...lexicon, ...words.items] },
      bookmarks: [...current.bookmarks, ...bookmarks],
      settingsArchive: { version: 1, settings: restorePreferences ? source.settings : preferences.settings },
      goal: current.goal ?? source.goal,
    } };
    await validateJournal(journal);
    // A failed acknowledgement can still have reached storage. Keep staged files
    // from this point onward so a possibly durable journal can always roll forward.
    journalAttempted = true;
    await storage.saveJSONStrict(KEY, journal);
    await recoverPortableRestore(storage);
  } catch (error) {
    if (!journalAttempted) {
      let cleaned = true;
      for (const book of created) { try { if (!files.remove(book.id, book.coverUrl)) cleaned = false; } catch { cleaned = false; } }
      if (!cleaned) throw Error('Recovery stopped before changing your library. Some incomplete recovery files could not be removed.');
    }
    throw error;
  }
}
