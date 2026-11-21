import type { Book } from '../types';
import { createLibraryStore, validLibraryBook } from './libraryStore';
import { ImportStorageError } from './bookImport';
type Storage = Parameters<typeof createLibraryStore>[0];
export const IMPORT_JOURNAL = 'importJournal';
interface Intent { version: 1; book: Book }
export async function hasPendingOriginalImport(storage: Storage): Promise<boolean> {
  const pending = await storage.loadJSONEntryStrict(IMPORT_JOURNAL);
  return pending.present && pending.value !== null;
}

export async function beginOriginalImport(storage: Storage, book: Book): Promise<void> {
  const pending = await storage.loadJSONEntryStrict(IMPORT_JOURNAL);
  if (pending.present && pending.value !== null) throw new ImportStorageError('An earlier import is waiting for recovery. Reopen this reading space before importing another book.');
  if (!validLibraryBook(book) || typeof book.fileLocation !== 'string') throw new ImportStorageError('This import has no saved original EPUB.');
  await storage.saveJSONStrict(IMPORT_JOURNAL, { version: 1, book } satisfies Intent);
}

/** Import intent is replayed before archive hooks; an existing removal marker wins. */
export async function recoverOriginalImport(storage: Storage, verify: (book: Book) => Promise<boolean>): Promise<void> {
  const saved = await storage.loadJSONEntryStrict(IMPORT_JOURNAL);
  if (!saved.present || saved.value === null) return;
  const intent = saved.value as Intent;
  if (!intent || intent.version !== 1 || !validLibraryBook(intent.book) || typeof intent.book.fileLocation !== 'string') throw Error('The interrupted import could not be read safely. Its files have been kept.');
  const library = createLibraryStore(storage), current = await library.load();
  if (current.removedBookIds.includes(intent.book.id)) { await storage.saveJSONStrict(IMPORT_JOURNAL, null); return; }
  const existing = current.books.find(book => book.id === intent.book.id);
  if (existing && (existing.title !== intent.book.title || existing.author !== intent.book.author || existing.fileLocation !== intent.book.fileLocation)) throw Error('This interrupted import conflicts with an existing book. Both copies have been kept.');
  if (existing) { await storage.saveJSONStrict(IMPORT_JOURNAL, null); return; }
  if (!await verify(intent.book)) throw Error('The interrupted import’s saved text or original EPUB is unavailable. Its remaining files have been kept.');
  await library.add(intent.book);
  await storage.saveJSONStrict(IMPORT_JOURNAL, null);
}
