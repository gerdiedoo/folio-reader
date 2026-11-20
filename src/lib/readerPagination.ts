import type { BookContentPage, ReadingPosition } from '../types';

export interface PaginatedPage {
  sourceIndex: number;
  page: BookContentPage;
  showChapterHeader: boolean;
  startWord: number;
  endWord: number;
}

function wrapText(text: string, charsPerLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  words.forEach((word) => {
    if (line && line.length + word.length + 1 > charsPerLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  });
  if (line) lines.push(line);
  return lines;
}

export function paginateContent(
  pages: BookContentPage[],
  maxLines: number,
  charsPerLine: number
): PaginatedPage[] {
  const result: PaginatedPage[] = [];

  pages.forEach((source, sourceIndex) => {
    const firstParagraph = wrapText(source.dropCap + source.paragraph1, charsPerLine);
    const secondParagraph = wrapText(
      source.paragraph2Lead + source.highlightedText + source.paragraph2Rest,
      charsPerLine
    );
    if (firstParagraph.length === 0 && secondParagraph.length === 0) {
      result.push({ sourceIndex, page: source, showChapterHeader: true, startWord: 0, endWord: 0 });
      return;
    }
    let wordOffset = 0;
    let firstOffset = 0;
    let secondOffset = 0;
    let firstSegment = true;

    while (firstOffset < firstParagraph.length || secondOffset < secondParagraph.length) {
      const chapterHeaderLines = firstSegment ? 3 : 0;
      let remainingLines = Math.max(1, maxLines - chapterHeaderLines);
      const firstStart = firstOffset;
      const firstCount = Math.min(remainingLines, firstParagraph.length - firstOffset);
      firstOffset += firstCount;
      remainingLines -= firstCount;

      const secondStart = secondOffset;
      if (firstOffset === firstParagraph.length && secondOffset < secondParagraph.length) {
        const paragraphGap = firstCount > 0 ? 1 : 0;
        if (remainingLines > paragraphGap) remainingLines -= paragraphGap;
        const secondCount = Math.min(remainingLines, secondParagraph.length - secondOffset);
        secondOffset += secondCount;
      }

      const firstText = firstParagraph.slice(firstStart, firstOffset).join(' ');
      const isInitialText = firstStart === 0;
      const firstCharacter = isInitialText ? source.dropCap : '';
      const paragraph1 = isInitialText ? firstText.slice(firstCharacter.length) : firstText;
      const secondText = secondParagraph.slice(secondStart, secondOffset).join(' ');

      const count = (firstText + ' ' + secondText).trim().split(/\s+/).filter(Boolean).length;
      result.push({
        sourceIndex,
        startWord: wordOffset,
        endWord: wordOffset + count,
        showChapterHeader: firstSegment,
        page: {
          ...source,
          dropCap: firstCharacter,
          paragraph1,
          paragraph2Lead: '',
          highlightedText: secondText,
          paragraph2Rest: '',
        },
      });
      wordOffset += count;
      firstSegment = false;

      if (firstCount === 0 && secondOffset === secondStart) break;
    }
  });

  return result;
}

/** Resolve a source word again after screen measurements or typography change. */
export function displayPageForPosition(segments: PaginatedPage[], position: ReadingPosition): number {
  const word = Number.isSafeInteger(position.wordOffset) && position.wordOffset! >= 0 ? position.wordOffset! : 0;
  let last = -1;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.page.pageNumber !== position.pageNumber) continue;
    last = index;
    if (word < segment.endWord) return index;
  }
  return last;
}
