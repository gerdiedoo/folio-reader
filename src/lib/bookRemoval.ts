export interface BookRemovalResult {
  removed: boolean;
  message: string;
}

interface RemovalSteps {
  bookmarks(): Promise<void>;
  highlights(): Promise<boolean>;
  vocabulary(): Promise<boolean>;
  saveLibrary(): Promise<void>;
  publishRemoval(): void;
  removeFiles(): boolean;
  removeCloud(): Promise<boolean>;
  reportCloudFailure(filesRemoved: boolean): void;
}

/** Local removal is acknowledged before deleting files or attempting cloud cleanup. */
export async function removeBookLocally(title: string, steps: RemovalSteps): Promise<BookRemovalResult> {
  let stage: 'bookmarks' | 'notes' | 'vocabulary' | 'library' = 'bookmarks';
  try {
    await steps.bookmarks();
    stage = 'notes';
    if (!await steps.highlights()) throw new Error('Notes not confirmed');
    stage = 'vocabulary';
    if (!await steps.vocabulary()) throw new Error('Vocabulary not confirmed');
    stage = 'library';
    await steps.saveLibrary();
  } catch {
    const messages = {
      bookmarks: 'Book kept. Its bookmarks could not be removed. Try again.',
      notes: 'Book kept. Its notes could not be removed. Its bookmarks were already removed. Try again.',
      vocabulary: 'Book kept. Its vocabulary could not be removed. Its bookmarks and notes were already removed. Try again.',
      library: 'Book kept because the library change could not be saved. Its bookmarks, notes and vocabulary were already removed. Try again.',
    };
    return { removed: false, message: messages[stage] };
  }

  steps.publishRemoval();
  let filesRemoved = false;
  try { filesRemoved = steps.removeFiles(); } catch { /* The confirmed library removal still stands. */ }
  // Device completion must not wait for an offline server. Reporting stays account-scoped.
  void Promise.resolve().then(() => steps.removeCloud()).then(confirmed => {
    if (!confirmed) steps.reportCloudFailure(filesRemoved);
  }).catch(() => steps.reportCloudFailure(filesRemoved));
  return {
    removed: true,
    message: filesRemoved ? `“${title}” removed on this device.`
      : `“${title}” removed from Library, but some local files could not be deleted.`,
  };
}
