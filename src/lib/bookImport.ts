import type { Book, BookContentPage } from '../types';

export class ImportStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportStorageError';
  }
}
/** An identifier collision must not roll back an existing book's files. */
export class ImportCollisionError extends ImportStorageError {}

interface ImportStorage {
  commitKey?: string;
  assertReady?(): void | Promise<void>;
  savePages(bookId: string, pages: BookContentPage[]): void;
  beginImport?(book: Book): Promise<void>;
  clearImport?(): Promise<void>;
  saveLibraryEntry(book: Book): Promise<void>;
  removeFiles(bookId: string, coverUrl?: string): boolean;
}
const commits = new Map<string, Promise<void>>();
export async function waitForImportCommits(key: string): Promise<void> {
  let queued: Promise<void> | undefined;
  while ((queued = commits.get(key))) await queued;
}

/** Commit new imports in order. Publish UI state only after this resolves. */
export function createImportCommitter(storage: ImportStorage) {
  let pending = Promise.resolve();
  return (book: Book, pages: BookContentPage[]) => {
    const operation = (storage.commitKey ? commits.get(storage.commitKey) ?? Promise.resolve() : pending).then(async () => {
      let intentAttempted = false;
      try {
        await storage.assertReady?.();
        if (!book.fileLocation || !pages.length) {
          throw new ImportStorageError('This book could not be saved. Try importing the original EPUB again.');
        }
        storage.savePages(book.id, pages);
        if (storage.beginImport) { intentAttempted = true; await storage.beginImport(book); }
        await storage.saveLibraryEntry(book);
        // The library entry is confirmed. An uncleared intent is safe to replay.
        try { await storage.clearImport?.(); } catch { /* Reopening retries this acknowledgement. */ }
      } catch (error) {
        if (error instanceof ImportCollisionError) throw error;
        if (intentAttempted) throw new ImportStorageError('This import could not be confirmed. Reopen this reading space to finish recovery. Its files have been kept.');
        let cleaned = false;
        try { cleaned = storage.removeFiles(book.id, book.coverUrl); } catch { /* Preserve the original failure. */ }
        const reason = error instanceof ImportStorageError ? error.message
          : 'Could not save this book on your device. Check available storage and try again.';
        throw new ImportStorageError(cleaned ? reason : `${reason} Some incomplete import files could not be removed.`);
      }
    });
    pending = operation.catch(() => undefined);
    if (storage.commitKey) {
      const key = storage.commitKey, settled = pending;
      commits.set(key, settled);
      void settled.then(() => { if (commits.get(key) === settled) commits.delete(key); });
    }
    return operation;
  };
}
