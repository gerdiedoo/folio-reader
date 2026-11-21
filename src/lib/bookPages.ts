import type { BookContentPage } from '../types';
import { validPageSource } from './sourceAnchors';
import { validRichBlock } from './epubStructure';

/** Validate cache/backup data before any of it reaches a native text/image renderer. */
export function validatedBookPages(value: unknown): BookContentPage[] {
  const strings = ['chapterTitle','chapterNumber','folioNumber','dropCap','paragraph1','paragraph2Lead','highlightedText','paragraph2Rest'];
  const numbers = ['pageNumber','totalBookPages','locNumber','totalLoc','minutesLeftInChapter'];
  if (!Array.isArray(value) || value.length === 0 || value.length > 50000 || !value.every(p => p && typeof p === 'object' &&
    strings.every(k => typeof p[k] === 'string') && numbers.every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0) && Number.isSafeInteger(p.pageNumber) && p.pageNumber >= 1 &&
    (p.source === undefined || validPageSource(p.source)) &&
    (p.rich === undefined || Array.isArray(p.rich) && p.rich.length <= 2 && p.rich.every((block: unknown, index: number) => block === null || validRichBlock(block) && block.text === (index === 0 ? p.dropCap + p.paragraph1 : p.paragraph2Lead + p.highlightedText + p.paragraph2Rest)))) ||
    new Set(value.map(p => p.pageNumber)).size !== value.length) throw Error('The saved reading text is damaged or unsupported. Its original files have been kept.');
  return value;
}
