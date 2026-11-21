import type { Book, CoverTint } from '../types';

export type CoverStyle = 'image' | 'typographic';
export interface BookCoverDraft {
  style: CoverStyle;
  tint: CoverTint;
  image: { kind: 'keep' } | { kind: 'url'; url: string } | { kind: 'photo'; uri: string };
}
export interface CoverSaveResult { saved: boolean; message: string }
export class CoverSaveError extends Error {}

export function normalizeCoverTint(value: unknown): CoverTint {
  switch (value) {
    case 'parchment': case 'terracotta': case 'slate': case 'sage': return value;
    default: return 'parchment';
  }
}

export function coverImageUrl(value: string): string {
  const input = value.trim();
  try {
    const url = new URL(input);
    if (!/^https?:\/\//i.test(input) || !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname || url.username || url.password) throw new Error('Unsupported URL');
    return url.href;
  } catch { throw new CoverSaveError('Enter a valid public HTTP or HTTPS image URL, or leave it blank to keep the current image.'); }
}

type CoverPatch = Pick<Book, 'coverStyle' | 'coverUrl' | 'coverTint'>;
interface CoverStorage {
  getBooks(): Book[];
  persistPhoto(uri: string, bookId: string): string;
  removeCustomCover(bookId: string, uri: string): boolean;
  saveBooks?(books: Book[]): Promise<void>;
  savePatch?(bookId: string, patch: CoverPatch): Promise<void>;
  publish(bookId: string, patch: CoverPatch): void;
  upload(book: Book): Promise<unknown>;
}

/** Copy/confirm first; publish only cover fields so a stale editor cannot rewind reading. */
export async function saveBookCover(bookId: string, draft: BookCoverDraft, storage: CoverStorage): Promise<CoverSaveResult> {
  const original = storage.getBooks().find(book => book.id === bookId);
  if (!original) return { saved: false, message: 'This book is no longer available in this Library.' };
  let created: string | undefined;
  let patch: CoverPatch;
  try {
    if (!['image', 'typographic'].includes(draft.style)) throw new CoverSaveError('Choose a supported cover style.');
    let uri = original.coverUrl;
    if (draft.style === 'image' && draft.image.kind === 'url') uri = coverImageUrl(draft.image.url);
    if (draft.style === 'image' && draft.image.kind === 'photo') {
      created = storage.persistPhoto(draft.image.uri, bookId);
      uri = created;
    }
    patch = { coverStyle: draft.style, coverUrl: uri, coverTint: normalizeCoverTint(draft.tint) };
    const next = storage.getBooks().map(book => book.id === bookId ? { ...book, ...patch } : book);
    if (!next.some(book => book.id === bookId)) throw new CoverSaveError('This book is no longer available in this Library.');
    if (storage.savePatch) await storage.savePatch(bookId, patch);
    else if (storage.saveBooks) await storage.saveBooks(next);
    else throw new CoverSaveError('Cover storage is unavailable.');
  } catch (error) {
    let cleaned = true;
    if (created) { try { cleaned = storage.removeCustomCover(bookId, created); } catch { cleaned = false; } }
    const message = error instanceof CoverSaveError ? error.message : 'Could not save the cover on this device. Your draft is still here. Try again.';
    return { saved: false, message: cleaned ? message : `${message} Some incomplete cover files could not be removed.` };
  }

  storage.publish(bookId, patch);
  let cleaned = true;
  if (original.coverUrl && original.coverUrl !== patch.coverUrl) {
    try { cleaned = storage.removeCustomCover(bookId, original.coverUrl); } catch { cleaned = false; }
  }
  const saved = storage.getBooks().find(book => book.id === bookId);
  if (saved) void Promise.resolve().then(() => storage.upload(saved)).catch(() => undefined);
  return { saved: true, message: cleaned ? 'Book cover saved on this device.' : 'Book cover saved on this device. Some previous cover files could not be removed.' };
}
