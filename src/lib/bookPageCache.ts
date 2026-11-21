import type { BookContentPage } from '../types';
/** Bounded LRU text cache. Opening Library never calls the loader. */
export function createBookPageCache(loader: (id: string) => Promise<BookContentPage[] | null>, capacity = 2) {
  const pages = new Map<string, BookContentPage[]>(), pending = new Map<string, Promise<BookContentPage[]>>();
  const remember = (id: string, value: BookContentPage[]) => {
    pages.delete(id); pages.set(id, value);
    while (pages.size > Math.max(1, capacity)) pages.delete(pages.keys().next().value!);
  };
  return {
    snapshot: () => Object.fromEntries(pages),
    put: remember,
    remove: (id: string) => { pages.delete(id); },
    load: (id: string): Promise<BookContentPage[]> => {
      const cached = pages.get(id); if (cached) { remember(id, cached); return Promise.resolve(cached); }
      const old = pending.get(id); if (old) return old;
      const request = Promise.resolve().then(() => loader(id)).then(value => {
        if (!value?.length) throw Error('The saved reading text is missing or damaged. Import its original EPUB to recover this book.');
        remember(id, value); return value;
      });
      pending.set(id, request);
      void request.finally(() => { if (pending.get(id) === request) pending.delete(id); }).catch(() => undefined);
      return request;
    },
  };
}
