import type { BookContentPage } from '../types';

export interface LineChapter {
  words: { text: string; start: number; end: number; segment: number }[];
  segments: { text: string; page: BookContentPage; startWord: number; endWord: number }[];
}

/** Keep original paragraph offsets so saved quotes remain findable in the reader. */
export function createLineChapter(pages: BookContentPage[]): LineChapter {
  const chapter: LineChapter = { words: [], segments: [] };
  for (const page of pages) {
    for (const text of [page.dropCap + page.paragraph1, page.paragraph2Lead + page.highlightedText + page.paragraph2Rest]) {
      const segment = chapter.segments.length;
      const startWord = chapter.words.length;
      for (const match of text.matchAll(/\S+/g)) {
        chapter.words.push({ text: match[0], start: match.index!, end: match.index! + match[0].length, segment });
      }
      if (chapter.words.length > startWord) chapter.segments.push({ text, page, startWord, endWord: chapter.words.length });
    }
  }
  return chapter;
}

export function firstLineWord(chapter: LineChapter, pageNumber: number): number {
  return chapter.segments.find(segment => segment.page.pageNumber === pageNumber)?.startWord ?? 0;
}

export function linePassage(chapter: LineChapter, index: number): BookContentPage | undefined {
  const token = chapter.words[index];
  return token ? chapter.segments[token.segment]?.page : undefined;
}

/** Quotes stay within one source paragraph, with its exact punctuation/spacing. */
export function lineQuote(chapter: LineChapter, index: number): { text: string; page: BookContentPage } | null {
  const token = chapter.words[index];
  const segment = token && chapter.segments[token.segment];
  if (!segment) return null;
  const first = chapter.words[Math.max(segment.startWord, index - 6)];
  const last = chapter.words[Math.min(segment.endWord - 1, index + 7)];
  return { text: segment.text.slice(first.start, last.end), page: segment.page };
}

export function lineSpeed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(60, Math.min(600, Math.round(value))) : 240;
}
