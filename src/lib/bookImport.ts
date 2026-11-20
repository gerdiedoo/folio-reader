import type { Book, BookContentPage } from '../types';

export class ImportStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportStorageError';
  }
}

interface ImportStorage {
  savePages(bookId: string, pages: BookContentPage[]): void;
  saveLibraryEntry(book: Book): Promise<void>;
  removeFiles(bookId: string, coverUrl?: string): boolean;
}

/** Commit new imports in order. Publish UI state only after this resolves. */
export function createImportCommitter(storage: ImportStorage) {
  let pending = Promise.resolve();
  return (book: Book, pages: BookContentPage[]) => {
    const operation = pending.then(async () => {
      try {
        if (!book.fileLocation || !pages.length) {
          throw new ImportStorageError('This book could not be saved. Try importing the original EPUB again.');
        }
        storage.savePages(book.id, pages);
        await storage.saveLibraryEntry(book);
      } catch (error) {
        let cleaned = false;
        try { cleaned = storage.removeFiles(book.id, book.coverUrl); } catch { /* Preserve the original failure. */ }
        const reason = error instanceof ImportStorageError ? error.message
          : 'Could not save this book on your device. Check available storage and try again.';
        throw new ImportStorageError(cleaned ? reason : `${reason} Some incomplete import files could not be removed.`);
      }
    });
    pending = operation.catch(() => undefined);
    return operation;
  };
}
