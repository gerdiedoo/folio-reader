import { canonical } from './stableValue';
export { canonical } from './stableValue';
import type { Book } from '../types';
import { validLibraryBook } from './libraryStore';
import { validHighlight } from './highlightArchive';
import { validLexiconEntry } from './lexiconArchive';
import { readBookmarks } from './bookmarks';
import { normalizeReaderSettings } from './readerPreferences';

export const SYNC_KEYS = { book: 'libraryArchive', highlight: 'highlightArchive', lexicon: 'lexiconArchive', bookmark: 'bookmarks', settings: 'settingsArchive' } as const;
export type SyncKind = keyof typeof SYNC_KEYS;
export type Payload = Record<string, any>;
export interface RemoteRecord { kind: SyncKind; id: string; revision: number; payload: Payload | null; mutationId: string; changeId?: number }
export interface PendingRecord { token: string; baseRevision: number; payload: Payload | null }
export interface RecordState { id: string; server?: RemoteRecord; pending?: PendingRecord; conflict?: RemoteRecord }
export interface Replica { version: 1; value?: unknown; states: RecordState[]; cursor?: number }
export const keyKind = (key: string): SyncKind | undefined => (Object.keys(SYNC_KEYS) as SyncKind[]).find(kind => SYNC_KEYS[kind] === key);
const object = (v: unknown): v is Payload => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** Canonical serialization prevents object-key order or omitted optional values causing false edits. */
export function syncPayload(kind: SyncKind, value: unknown): Payload {
  if (!object(value)) throw Error('An account record could not be read.');
  if (kind === 'book') {
    if (!validLibraryBook(value)) throw Error('An account book could not be read.');
    const result: Payload = {};
    for (const key of ['id','title','author','coverStyle','coverTint','progressPercent','currentPage','readingPosition','totalPages','minutesLeft','currentChapter','lastOpened','isFinished','isWantToRead','totalLoc','currentLoc','coverAlt','genres','annotation','documentLanguage','documentIdentifier','documentFingerprint','fileFormat','fileSizeBytes'] as const) {
      if (value[key] !== undefined) result[key] = value[key];
    }
    result.coverUrl = typeof value.coverUrl === 'string' && /^https?:\/\//i.test(value.coverUrl) ? value.coverUrl : '';
    result.minutesLeft ??= 0; result.currentChapter ??= ''; result.lastOpened ??= ''; result.coverAlt ??= `Cover of ${value.title}`;
    if (result.readingPosition) { const { scroll: _devicePixels, ...position } = result.readingPosition; result.readingPosition = position; }
    return JSON.parse(JSON.stringify(result));
  }
  if (kind === 'highlight') {
    if (!validHighlight(value)) throw Error('An account highlight could not be read.');
    return JSON.parse(JSON.stringify({ id: value.id, bookId: value.bookId, bookTitle: value.bookTitle, chapter: value.chapter, page: value.page, loc: value.loc ?? undefined,
      text: value.text, colorName: value.colorName, colorHex: value.colorHex, note: value.note ?? undefined, dateAdded: value.dateAdded, anchor: value.anchor }));
  }
  if (kind === 'lexicon') {
    if (!validLexiconEntry(value)) throw Error('An account vocabulary card could not be read.');
    return JSON.parse(JSON.stringify({ id: value.id, bookId: value.bookId, word: value.word, definition: value.definition, masteryLevel: value.masteryLevel,
      phonetic: value.phonetic ?? '', partOfSpeech: value.partOfSpeech ?? '', contextPassage: value.contextPassage ?? '', chapter: value.chapter ?? '', page: value.page, anchor: value.anchor }));
  }
  if (kind === 'bookmark') { const [item] = readBookmarks(JSON.stringify([value])); return item as unknown as Payload; }
  return { ...normalizeReaderSettings(value), id: 'reader' };
}
export function recordsFor(kind: SyncKind, value: unknown): Map<string, Payload | null> {
  const result = new Map<string, Payload | null>(); if (value === undefined) return result;
  const v = value as Payload;
  if (kind !== 'bookmark' && (!object(v) || v.version !== 1 || kind !== 'settings' && (!Array.isArray(v.removedBookIds) || !v.removedBookIds.every((id: unknown) => typeof id === 'string')))) throw Error('Unsupported saved account archive.');
  const items = kind === 'book' ? v.books : kind === 'bookmark' ? value : kind === 'settings' ? [v.settings] : v.items;
  if (!Array.isArray(items)) throw Error('Saved account records could not be read.');
  for (const item of items) { const p = syncPayload(kind, item); if (result.has(p.id)) throw Error('Duplicate account records.'); result.set(p.id, p); }
  const removed = kind === 'book' ? v.removedBookIds : kind === 'highlight' ? v.removedIds : [];
  if (!Array.isArray(removed) || !removed.every(id => typeof id === 'string')) throw Error('Saved account removals could not be read.');
  for (const id of removed) { if (result.has(id)) throw Error('An account record is inconsistent with its removal marker.'); result.set(id, null); }
  return result;
}
export function emptyArchive(kind: SyncKind): any {
  if (kind === 'bookmark') return [];
  if (kind === 'settings') return { version: 1, settings: normalizeReaderSettings(null) };
  if (kind === 'book') return { version: 1, books: [], removedBookIds: [], pendingFileRemovals: [] };
  return { version: 1, items: [], removedBookIds: [], ...(kind === 'highlight' ? { removedIds: [] } : {}) };
}
/** Apply a reviewed/unchanged remote revision, preserving device-owned file paths and covers. */
export function applyRecord(kind: SyncKind, value: unknown, id: string, payload: Payload | null): unknown {
  const v: any = value ?? emptyArchive(kind);
  if (kind === 'settings') return payload ? { version: 1, settings: normalizeReaderSettings(payload) } : emptyArchive(kind);
  if (kind === 'bookmark') return [...(v as Payload[]).filter(item => item.id !== id), ...(payload ? [payload] : [])];
  if (kind === 'book') {
    const existing = (v.books as Book[]).find(book => book.id === id);
    if (payload && existing?.fileLocation && existing.documentFingerprint && payload.documentFingerprint && existing.documentFingerprint !== payload.documentFingerprint) throw Error('This account book uses a different edition. Keep your device version and recover the other edition as a separate book.');
    const localPosition = existing?.readingPosition;
    const { scroll: localScroll, ...localSource } = localPosition ?? {};
    const keepScroll = localScroll && payload?.readingPosition && canonical(localSource) === canonical(payload.readingPosition);
    const book = payload ? { ...payload, ...(keepScroll ? { readingPosition: { ...payload.readingPosition, scroll: localScroll } } : {}), ...(existing?.documentFingerprint && !payload.documentFingerprint ? { documentFingerprint: existing.documentFingerprint } : {}), ...(existing?.fileLocation ? { fileLocation: existing.fileLocation } : {}),
      ...(existing?.coverUrl?.startsWith('file://') ? { coverUrl: existing.coverUrl } : {}), isDownloaded: existing?.isDownloaded ?? false } : null;
    const pending = (v.pendingFileRemovals ?? []).filter((item: Payload) => item.id !== id);
    if (!book && existing) pending.push({ id, coverUrl: existing.coverUrl });
    return { ...v, books: [...v.books.filter((b: Payload) => b.id !== id), ...(book ? [book] : [])],
      removedBookIds: book ? v.removedBookIds.filter((key: string) => key !== id) : [...new Set([...v.removedBookIds, id])], pendingFileRemovals: pending };
  }
  return { ...v, items: [...v.items.filter((item: Payload) => item.id !== id), ...(payload ? [payload] : [])],
    removedBookIds: payload ? v.removedBookIds.filter((bookId: string) => bookId !== payload.bookId) : v.removedBookIds,
    ...(kind === 'highlight' ? { removedIds: payload ? v.removedIds.filter((key: string) => key !== id) : [...new Set([...v.removedIds, id])] } : {}) };
}
