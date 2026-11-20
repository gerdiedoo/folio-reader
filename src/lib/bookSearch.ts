import type { BookContentPage } from '../types';

export interface BookSearchMatch {
  id: string;
  sourceIndex: number;
  pageNumber: number;
  chapterTitle: string;
  paragraph: 0 | 1;
  start: number;
  end: number;
  /** Word ordinal within the imported passage, used to find its reflowed page. */
  wordIndex: number;
  before: string;
  match: string;
  after: string;
  leadingEllipsis: boolean;
  trailingEllipsis: boolean;
}

interface SearchOptions {
  signal?: Pick<AbortSignal, 'aborted'>;
  limit?: number;
  yieldControl?: () => Promise<void>;
}

export class BookSearchCancelled extends Error {}

function paragraphs(page: BookContentPage): [string, string] {
  return [page.dropCap + page.paragraph1, page.paragraph2Lead + page.highlightedText + page.paragraph2Rest];
}

interface FoldedText { value: string; starts: number[]; ends: number[] }

/** Map folded characters back to complete original code points, including marks. */
function* foldSteps(text: string): Generator<void, FoldedText> {
  const chunks: string[] = [];
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  let space = false;
  let nextYield = 4096;
  for (const point of text) {
    const end = offset + point.length;
    const normalized = point.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').replace(/ß/g, 'ss');
    if (!normalized && /\p{M}/u.test(point) && ends.length) ends[ends.length - 1] = end;
    for (const character of normalized) {
      const next = /\s/u.test(character) ? ' ' : character;
      if (next === ' ' && space) { ends[ends.length - 1] = end; continue; }
      chunks.push(next);
      space = next === ' ';
      for (let unit = 0; unit < next.length; unit++) { starts.push(offset); ends.push(end); }
    }
    offset = end;
    if (offset >= nextYield) { nextYield = offset + 4096; yield; }
  }
  return { value: chunks.join(''), starts, ends };
}

function fold(text: string): FoldedText {
  const work = foldSteps(text);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

async function foldInChunks(text: string, yieldControl: () => Promise<void>, check: () => void): Promise<FoldedText> {
  const work = foldSteps(text);
  let step = work.next();
  while (!step.done) {
    await yieldControl();
    check();
    step = work.next();
  }
  return step.value;
}

function wordCount(text: string): number { return text.match(/\S+/g)?.length ?? 0; }

function snippetBoundary(text: string, offset: number, direction: -1 | 1): number {
  // Do not cut an emoji/supplementary character in half at a context boundary.
  if (offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset]) && /[\uD800-\uDBFF]/.test(text[offset - 1])) return offset + direction;
  return offset;
}

/** Literal, offline search. Whitespace, case and decomposable accents are folded. */
export async function searchBookPages(pages: BookContentPage[], query: string, options: SearchOptions = {}) {
  const { signal, yieldControl = () => new Promise<void>(resolve => setTimeout(resolve, 0)) } = options;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 100;
  const check = () => { if (signal?.aborted) throw new BookSearchCancelled(); };
  check();
  if (query.length > 200) throw new Error('Use a search phrase of 200 characters or fewer.');
  const needle = fold(query).value.trim();
  const matches: BookSearchMatch[] = [];
  if (!needle) return { matches, hasMore: false };

  for (let sourceIndex = 0; sourceIndex < pages.length; sourceIndex++) {
    if (sourceIndex % 8 === 0) { await yieldControl(); check(); }
    const page = pages[sourceIndex];
    const parts = paragraphs(page);
    for (const paragraph of [0, 1] as const) {
      const text = parts[paragraph];
      const haystack = await foldInChunks(text, yieldControl, check);
      const baseWord = paragraph === 1 ? wordCount(parts[0]) : 0;
      const words = text.matchAll(/\S+/g);
      let currentWord = words.next(), wordIndex = 0;
      let cursor = 0, lastStart = -1, lastEnd = -1;
      while (cursor <= haystack.value.length - needle.length) {
        const at = haystack.value.indexOf(needle, cursor);
        if (at < 0) break;
        cursor = at + needle.length;
        const start = haystack.starts[at], end = haystack.ends[cursor - 1];
        // A folded ligature can match twice inside one original glyph.
        if (start === lastStart && end === lastEnd) continue;
        lastStart = start; lastEnd = end;
        if (matches.length === limit) return { matches, hasMore: true };
        // Advance one iterator across ordered matches rather than rescanning the
        // entire paragraph for every result. Long walks remain cancellable.
        while (!currentWord.done && currentWord.value.index! + currentWord.value[0].length <= start) {
          wordIndex++;
          currentWord = words.next();
          if (wordIndex % 4096 === 0) { await yieldControl(); check(); }
        }
        const from = snippetBoundary(text, Math.max(0, start - 64), -1);
        const to = snippetBoundary(text, Math.min(text.length, end + 64), 1);
        matches.push({
          id: `${sourceIndex}:${paragraph}:${start}:${end}`,
          sourceIndex, pageNumber: page.pageNumber, chapterTitle: page.chapterTitle,
          paragraph, start, end,
          wordIndex: baseWord + wordIndex,
          before: text.slice(from, start), match: text.slice(start, end), after: text.slice(end, to),
          leadingEllipsis: from > 0, trailingEllipsis: to < text.length,
        });
      }
    }
  }
  check();
  return { matches, hasMore: false };
}

/** Find the reflowed page containing the first matched word, preserving Pages mode. */
export function searchDisplayPage(segments: { sourceIndex: number; page: BookContentPage }[], match: BookSearchMatch): number {
  let seen = 0, first = -1;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.sourceIndex !== match.sourceIndex) continue;
    if (first < 0) first = index;
    const count = paragraphs(segment.page).reduce((sum, text) => sum + wordCount(text), 0);
    if (match.wordIndex < seen + count) return index;
    seen += count;
  }
  return first;
}
