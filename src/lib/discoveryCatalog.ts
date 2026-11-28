import type { CatalogBook, CatalogPage, CatalogSource, CatalogSort } from './catalog';
import type { CatalogAccess } from './extraCatalog';
import { catalogCancelled, CatalogError } from './catalogRequest';
import { discoveryLandingUrl, discoveryMatchUrl, discoverySearchUrl, discoveryWorkDetails, isDiscoveryLanding, matchingDiscoveryWork, mergeDiscoveryBooks, parseDiscoveryLanding, parseDiscoveryPage } from './openLibraryMetadata';
import { requestOpenLibrary } from './openLibraryRequest';
import type { DiscoveryPageCache } from './discoveryPageCache';

export type DiscoveryFilter = 'all' | Exclude<CatalogSource, 'openlibrary'>;
export interface SourceAvailability {
  source: Exclude<CatalogSource, 'openlibrary'>;
  state: 'available' | 'not-found' | 'error' | 'key-required';
  editions: CatalogBook[];
  message?: string;
}
interface Dependencies {
  search(opts: { source?: CatalogSource; query?: string; topic?: string; page?: number; sort?: CatalogSort; googleBooksKey?: string | null }, signal?: AbortSignal): Promise<CatalogPage>;
  details(book: CatalogBook, signal?: AbortSignal, access?: CatalogAccess): Promise<CatalogBook>;
  links(book: CatalogBook, signal?: AbortSignal, access?: CatalogAccess): Promise<string[]>;
  metadata?: (url: string, signal?: AbortSignal) => Promise<unknown>;
}

export function createDiscoveryCatalog(deps: Dependencies) {
  const metadata = deps.metadata ?? requestOpenLibrary;
  return {
    async search(opts: { source?: DiscoveryFilter; query?: string; topic?: string; page?: number; sort?: CatalogSort; googleBooksKey?: string | null; cache?: DiscoveryPageCache; onCached?: (page: CatalogPage) => void }, signal?: AbortSignal): Promise<CatalogPage> {
      if (signal?.aborted) throw catalogCancelled();
      const page = Number.isSafeInteger(opts.page) && opts.page! > 0 ? opts.page! : 1;
      if (!opts.source || opts.source === 'all') {
        const landing = isDiscoveryLanding(opts.query ?? '', opts.topic ?? '', opts.sort);
        const url = landing ? discoveryLandingUrl(page) : discoverySearchUrl(opts.query ?? '', opts.topic ?? '', page, opts.sort);
        const saved = await opts.cache?.read(url).catch(() => undefined);
        if (signal?.aborted) throw catalogCancelled();
        if (saved) opts.onCached?.({ ...saved.page, noticeKind: 'info', notice: 'Showing saved Open Library results while checking for updates…' });
        try {
          let value: unknown;
          try { value = await metadata(url, signal); }
          catch (error) {
            if (signal?.aborted) throw catalogCancelled();
            // Older deployments may expose the daily feed without the now route.
            // Never fall back to an expensive match-all search on startup.
            if (!landing || !(error instanceof CatalogError) || !['unavailable', 'invalid'].includes(error.kind) && error.status !== 422) throw error;
            value = await metadata(discoveryLandingUrl(page, 'daily'), signal);
          }
          if (signal?.aborted) throw catalogCancelled();
          const result = landing ? parseDiscoveryLanding(value) : parseDiscoveryPage(value, page);
          void opts.cache?.write(url, result).catch(() => undefined);
          return result;
        } catch (error) {
          if (signal?.aborted) throw catalogCancelled();
          if (saved) return { ...saved.page, noticeKind: 'recovery', notice: `Open Library could not refresh these results. Showing saved books from ${new Date(saved.savedAt).toLocaleDateString()}. Retry to check for updates.` };
          throw error;
        }
      }
      const provider = await deps.search({ ...opts, source: opts.source, page }, signal);
      if (signal?.aborted) throw catalogCancelled();
      const matches: CatalogBook[] = [];
      let metadataFailed = false;
      // Batch metadata matching instead of one Open Library request per thumbnail.
      for (let index = 0; index < provider.books.length; index += 8) {
        if (signal?.aborted) throw catalogCancelled();
        try { matches.push(...parseDiscoveryPage(await metadata(discoveryMatchUrl(provider.books.slice(index, index + 8)), signal)).books); }
        catch { if (signal?.aborted) throw catalogCancelled(); metadataFailed = true; break; }
      }
      const books = provider.books.map(edition => {
        const work = matches.find(book => matchingDiscoveryWork(book, edition));
        return { ...(work ?? { ...edition, coverUrl: '', catalogKind: 'work' as const }), epubEditions: [edition] };
      });
      return { ...provider, books: mergeDiscoveryBooks([], books), total: null,
        noticeKind: metadataFailed || provider.notice && provider.noticeKind !== 'info' ? 'recovery' : 'info',
        notice: [provider.notice, metadataFailed ? 'Open Library metadata could not be loaded. Source titles use typography covers.' : '', 'Books listed by this EPUB source. Availability is checked in book details.'].filter(Boolean).join(' ') };
    },
    async details(book: CatalogBook, signal?: AbortSignal, access: CatalogAccess = {}): Promise<CatalogBook> {
      if (signal?.aborted) throw catalogCancelled();
      if (book.openLibraryWorkId && /^OL\d+W$/.test(book.openLibraryWorkId)) {
        const value = await metadata(`https://openlibrary.org/works/${book.openLibraryWorkId}.json`, signal);
        if (signal?.aborted) throw catalogCancelled();
        return discoveryWorkDetails(value, book);
      }
      // Source-only matches stay usable if Open Library has no corresponding work.
      if (book.epubEditions?.length) {
        const details = await deps.details(book.epubEditions[0], signal, access);
        if (signal?.aborted) throw catalogCancelled();
        return { ...book, description: details.description, subjects: details.subjects, languages: details.languages };
      }
      throw new CatalogError('invalid');
    },
    async checkSource(book: CatalogBook, source: SourceAvailability['source'], signal?: AbortSignal, access: CatalogAccess = {}): Promise<SourceAvailability> {
      if (signal?.aborted) throw catalogCancelled();
      if (source === 'google' && !access.googleBooksKey) return { source, state: 'key-required', editions: [] };
      let candidates = (book.epubEditions ?? []).filter(edition => edition.source === source);
      if (source === 'archive' && book.archiveIds?.length) candidates = [...candidates, ...book.archiveIds.map(id => ({ ...book, id: `archive-${id}`, source: 'archive' as const, catalogKind: undefined, epubEditions: undefined, detailUrl: `https://archive.org/metadata/${encodeURIComponent(id)}` }))];
      try {
        if (!candidates.length) {
          const found = await deps.search({ source, query: book.title.slice(0, 160), page: 1, googleBooksKey: access.googleBooksKey }, signal);
          if (signal?.aborted) throw catalogCancelled();
          candidates = found.books.filter(edition => matchingDiscoveryWork(book, edition));
          if (!candidates.length && found.notice && found.noticeKind !== 'info') return { source, state: 'error', editions: [], message: found.notice };
        }
        const unique = [...new Map(candidates.map(edition => [edition.id, edition])).values()].slice(0, 3);
        const editions: CatalogBook[] = [];
        let lastError: unknown;
        for (const candidate of unique) {
          try {
            const details = await deps.details(candidate, signal, access);
            if (signal?.aborted) throw catalogCancelled();
            if (details.id !== candidate.id || !matchingDiscoveryWork(book, details)) continue;
            if ((await deps.links(details, signal, access)).length) editions.push(details);
          } catch (error) {
            if (signal?.aborted) throw catalogCancelled();
            if (!(error instanceof CatalogError) || error.kind !== 'unavailable') lastError = error;
          }
        }
        if (signal?.aborted) throw catalogCancelled();
        if (editions.length) return { source, state: 'available', editions, message: lastError ? 'Some other editions could not be checked.' : undefined };
        if (lastError) throw lastError;
        return { source, state: 'not-found', editions: [] };
      } catch (error) {
        if (signal?.aborted) throw catalogCancelled();
        return { source, state: 'error', editions: [], message: error instanceof Error ? error.message : 'This source could not be checked.' };
      }
    },
  };
}
