import type { Book, BookContentPage, ReadingPosition } from '../types';
import { resolveSourceAnchor, sourceAnchorForPosition } from './sourceAnchors';

export function savedReadingPosition(book: Book | undefined, pages: BookContentPage[]) {
  const anchor = book?.readingPosition?.anchor;
  if (anchor) {
    const target = resolveSourceAnchor(anchor, pages);
    if (!target) return { index: 0, position: { pageNumber: pages[0]?.pageNumber ?? 1 } as ReadingPosition, anchorUnresolved: true };
    const matched = pages[target.index];
    const samePassage = book?.readingPosition?.pageNumber === matched.pageNumber;
    const scroll = samePassage ? book?.readingPosition?.scroll : undefined;
    const validScroll = scroll && typeof scroll.layout === 'string' && Number.isFinite(scroll.offset) && scroll.offset >= 0 &&
      Array.isArray(scroll.sourcePaths) && JSON.stringify(scroll.sourcePaths) === JSON.stringify(matched.source?.paths);
    return { index: target.index, position: { pageNumber: matched.pageNumber, wordOffset: target.wordOffset, anchor, ...(validScroll ? { scroll: { ...scroll } } : {}) } as ReadingPosition };
  }
  const number = typeof book?.currentPage === 'number' && Number.isFinite(book.currentPage) ? Math.floor(book.currentPage) : 1;
  let index = pages.findIndex(page => page.pageNumber === number);
  if (index < 0) index = Math.max(0, Math.min(pages.length - 1, number - 1));
  const pageNumber = pages[index]?.pageNumber ?? 1;
  const saved = book?.readingPosition;
  const valid = saved?.pageNumber === pageNumber;
  const scroll = valid && saved.scroll && typeof saved.scroll.layout === 'string' &&
    Number.isFinite(saved.scroll.offset) && saved.scroll.offset >= 0 ? { ...saved.scroll } : undefined;
  const wordOffset = valid && Number.isSafeInteger(saved.wordOffset) && saved.wordOffset! >= 0 ? saved.wordOffset : undefined;
  return { index, position: { pageNumber, ...(wordOffset !== undefined ? { wordOffset } : {}), ...(scroll ? { scroll } : {}) } as ReadingPosition };
}

export interface ScrollRow { pageNumber: number; y: number; height: number }
/** Use measured cells and their source IDs, never a stale window-relative index. */
export function scrollPositionAtOffset(rows: Iterable<ScrollRow>, offset: number, layout: string): ReadingPosition | null {
  if (!Number.isFinite(offset)) return null;
  const top = Math.max(0, offset);
  const sorted = [...rows].filter(row => row.height > 0).sort((a, b) => a.y - b.y);
  const row = sorted.find(item => top >= item.y && top < item.y + item.height) ??
    (sorted[0] && top < sorted[0].y ? sorted[0] : null);
  return row ? { pageNumber: row.pageNumber, scroll: { offset: Math.max(0, top - row.y), layout } } : null;
}

export function applyReadingPosition(book: Book, page: BookContentPage, total: number, position: ReadingPosition, at: string): Book {
  const anchor = sourceAnchorForPosition(page, position);
  return { ...book, currentPage: page.pageNumber, currentChapter: page.chapterNumber, currentLoc: page.locNumber,
    progressPercent: Math.round((page.pageNumber / Math.max(1, total)) * 100), lastOpened: at, readingPosition: { ...position,
      ...(anchor ? { anchor, ...(position.scroll ? { scroll: { ...position.scroll, sourcePaths: [...page.source!.paths] } } : {}) } : {}) } };
}

/** A cloud snapshot cannot rewind a book already being read on this device. */
export function mergeCloudBookForDevice(local: Book | undefined, remote: Book): Book {
  if (!local) return remote;
  return { ...remote, ...local };
}

/** Local saves do not wait for the network; cloud progress stays ordered per book. */
export function createReadingProgressWriter(saveBooks: (books: Book[], changedBook?: Book) => Promise<void>, uploadBook: (book: Book) => Promise<unknown>, onSaveError: () => void) {
  const uploads = new Map<string, Promise<unknown>>();
  return (books: Book[], book: Book): Promise<boolean> => {
    const saved = Promise.resolve().then(() => saveBooks(books, book)).then(() => true, () => { onSaveError(); return false; });
    const upload = (uploads.get(book.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (await saved) await uploadBook(book);
    }).catch(() => undefined);
    uploads.set(book.id, upload);
    void upload.then(() => { if (uploads.get(book.id) === upload) uploads.delete(book.id); });
    return saved;
  };
}
