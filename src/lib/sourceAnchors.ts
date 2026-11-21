import type { BookContentPage, ReadingPosition, SourceAnchor } from '../types';

export function validSourceAnchor(value: unknown): value is SourceAnchor {
  const a = value as SourceAnchor;
  return Boolean(a) && a.version === 1 && typeof a.edition === 'string' && /^[a-f0-9]{64}$/.test(a.edition) &&
    typeof a.href === 'string' && a.href.length > 0 && a.href.length <= 2000 && !/^(?:[a-z]+:|\/)/i.test(a.href) && !a.href.split('/').includes('..') &&
    typeof a.path === 'string' && /^body(?:\/\d+)+$/.test(a.path) && a.path.length <= 4000 &&
    (a.wordOffset === undefined || Number.isSafeInteger(a.wordOffset) && a.wordOffset >= 0);
}
export function validPageSource(value: unknown): value is NonNullable<BookContentPage['source']> {
  const s = value as NonNullable<BookContentPage['source']>;
  return Boolean(s) && s.version === 1 && Array.isArray(s.paths) && s.paths.length >= 1 && s.paths.length <= 2 && new Set(s.paths).size === s.paths.length &&
    s.paths.every(path => validSourceAnchor({ version: s.version, edition: s.edition, href: s.href, path }));
}
const firstWords = (page: BookContentPage) => (page.dropCap + page.paragraph1).trim().split(/\s+/).filter(Boolean).length;
const validPassageText = (page: BookContentPage) => ['dropCap', 'paragraph1', 'paragraph2Lead', 'highlightedText', 'paragraph2Rest'].every(key => typeof page[key as keyof BookContentPage] === 'string');
export function sourceAnchorForPosition(page: BookContentPage, position: Pick<ReadingPosition, 'wordOffset'> = {}): SourceAnchor | undefined {
  const source = page.source;
  if (!validPageSource(source) || !validPassageText(page)) return;
  const offset = Number.isSafeInteger(position.wordOffset) && position.wordOffset! >= 0 ? position.wordOffset! : 0;
  const second = source.paths.length > 1 && offset >= firstWords(page);
  const anchor: SourceAnchor = { version: 1, edition: source.edition, href: source.href, path: source.paths[second ? 1 : 0], wordOffset: second ? offset - firstWords(page) : offset };
  return validSourceAnchor(anchor) ? anchor : undefined;
}

/** An unresolved edition/path never falls through to an unrelated synthetic page. */
export function resolveSourceAnchor(anchor: SourceAnchor, pages: readonly BookContentPage[]): { index: number; wordOffset: number } | null {
  if (!validSourceAnchor(anchor)) return null;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index], source = page.source;
    if (!validPageSource(source) || !validPassageText(page) || source.edition !== anchor.edition || source.href !== anchor.href) continue;
    const block = source.paths.indexOf(anchor.path);
    if (block < 0 || block > 1) continue;
    const text = block === 0 ? page.dropCap + page.paragraph1 : page.paragraph2Lead + page.highlightedText + page.paragraph2Rest;
    const count = text.trim().split(/\s+/).filter(Boolean).length;
    if ((anchor.wordOffset ?? 0) > count) return null;
    return { index, wordOffset: (block === 1 ? firstWords(page) : 0) + (anchor.wordOffset ?? 0) };
  }
  return null;
}
export function sourceAnchorForQuote(page: BookContentPage, quote: string): SourceAnchor | undefined {
  if (!validPassageText(page)) return;
  const p1 = page.dropCap + page.paragraph1, p2 = page.paragraph2Lead + page.highlightedText + page.paragraph2Rest;
  const wordsBefore = (text: string, at: number) => text.slice(0, at).trim().split(/\s+/).filter(Boolean).length;
  const first = p1.indexOf(quote), second = p2.indexOf(quote);
  if (!quote || first < 0 && second < 0) return undefined;
  return sourceAnchorForPosition(page, { wordOffset: first >= 0 ? wordsBefore(p1, first) : firstWords(page) + wordsBefore(p2, second) });
}
