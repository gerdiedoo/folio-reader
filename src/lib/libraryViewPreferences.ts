import type { LibraryFilter, LibrarySort } from './libraryBrowser';
export interface LibraryViewPreferences { query: string; filter: LibraryFilter; sort: LibrarySort; viewMode: 'grid' | 'list' }
export function libraryViewPreferences(value: unknown): LibraryViewPreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { query: typeof v.query === 'string' ? v.query.slice(0,200) : '',
    filter: ['all','reading','finished','downloaded','want'].includes(String(v.filter)) ? v.filter as LibraryFilter : 'all',
    sort: ['recent','title','progress'].includes(String(v.sort)) ? v.sort as LibrarySort : 'recent',
    viewMode: v.viewMode === 'list' ? 'list' : 'grid' };
}
