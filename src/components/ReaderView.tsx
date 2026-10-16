import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  GestureResponderEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';
import { BOOK_PAGES } from '../data/initialData';
import { colors, F, readerFontFamily, readerPaper, type } from '../theme';
import {
  Book,
  BookContentPage,
  HighlightEntry,
  PaperTheme,
  ReadingFlowMode,
  ReadingSettings,
} from '../types';
import { HIGHLIGHT_COLORS, PassageSheet } from './PassageSheet';
import { ChapterInfo, ChapterSheet, ScrubBar } from './ReaderNavigator';
import { SingleLineReader } from './SingleLineReader';
import { Icon } from './ui/Icon';
import { ProgressBar } from './ui/ProgressBar';

export interface JumpTarget {
  bookId: string;
  page: number;
  nonce: number;
}

interface ReaderViewProps {
  currentBook?: Book;
  customPages?: BookContentPage[];
  onUpdateReadingPosition: (bookId: string, page: BookContentPage, totalPages: number) => void;
  settings: ReadingSettings;
  onUpdateSettings: (partial: Partial<ReadingSettings>) => void;
  onOpenSettingsSheet: () => void;
  onOpenDictionary: (word: string, context?: string) => void;
  highlights: HighlightEntry[];
  onAddHighlight: (hl: Omit<HighlightEntry, 'id' | 'dateAdded'>) => void;
  onDeleteHighlight: (id: string) => void;
  onAddReflectionNote: (highlightId: string, note: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  isNavVisible: boolean;
  isImmersiveMode: boolean;
  onToggleNavVisibility: () => void;
  setNavVisibility: (visible: boolean) => void;
  showToast: (msg: string) => void;
  jumpTarget?: JumpTarget | null;
  /** Space to leave at the bottom (floating tab bar). */
  bottomSpace: number;
}

const MARGINS = { narrow: 14, regular: 20, wide: 30 } as const;
const LINE_MULT = { compact: 1.45, standard: 1.7, loose: 2.0 } as const;
const NO_HIGHLIGHTS: HighlightEntry[] = [];

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------------------------------------------------------------------------
// Paragraph rendering with inline highlights
// ---------------------------------------------------------------------------
interface Seg {
  start: number;
  end: number;
  hl?: HighlightEntry;
}

interface PaginatedPage {
  sourceIndex: number;
  page: BookContentPage;
  showChapterHeader: boolean;
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

function paginateContent(
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
      result.push({ sourceIndex, page: source, showChapterHeader: true });
      return;
    }
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

      result.push({
        sourceIndex,
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
      firstSegment = false;

      if (firstCount === 0 && secondOffset === secondStart) break;
    }
  });

  return result;
}

function buildSegments(full: string, hls: HighlightEntry[]): Seg[] {
  const ranges: Seg[] = [];
  const seen = new Set<string>();
  for (const h of hls) {
    if (!h.text || seen.has(h.id)) continue;
    seen.add(h.id);
    const idx = full.indexOf(h.text);
    if (idx >= 0) ranges.push({ start: idx, end: idx + h.text.length, hl: h });
  }
  ranges.sort((a, b) => a.start - b.start);

  const result: Seg[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue; // overlapping highlight
    result.push(r);
    cursor = r.end;
  }
  return result.sort((a, b) => a.start - b.start);
}

interface ParagraphProps {
  full: string;
  hls: HighlightEntry[];
  dropCap?: boolean;
  indent?: boolean;
  textStyle: object;
  dropStyle: object;
  onTap: (e: GestureResponderEvent) => void;
  onOpen: (full: string, existing?: HighlightEntry | null, initial?: string) => void;
}

const Paragraph = React.memo<ParagraphProps>(
  ({ full, hls, dropCap, indent, textStyle, dropStyle, onTap, onOpen }) => {
    const segs = useMemo(() => buildSegments(full, hls), [full, hls]);

    const pieces: React.ReactNode[] = [];
    let cursor = 0;

    const pushPlain = (from: number, to: number, key: string) => {
      if (to <= from) return;
      pieces.push(...splitDrop(full.slice(from, to), from, key, undefined));
    };

    // Drop cap = first character rendered large; works across plain & highlighted text
    const splitDrop = (
      s: string,
      absStart: number,
      key: string,
      markStyle: object | undefined,
      onPress?: () => void
    ): React.ReactNode[] => {
      if (dropCap && absStart === 0 && s.length > 0) {
        return [
          <Text key={key + 'd'} style={[dropStyle, markStyle]} onPress={onPress}>
            {s[0]}
          </Text>,
          s.length > 1 ? (
            <Text key={key + 'r'} style={markStyle} onPress={onPress}>
              {s.slice(1)}
            </Text>
          ) : null,
        ];
      }
      return [
        <Text key={key} style={markStyle} onPress={onPress}>
          {s}
        </Text>,
      ];
    };

    segs.forEach((seg, i) => {
      pushPlain(cursor, seg.start, `p${i}`);
      const mark = {
        backgroundColor: seg.hl ? `${seg.hl.colorHex}dd` : 'rgba(248,232,162,0.75)',
        color: '#1c1c18',
      };
      const text = full.slice(seg.start, seg.end);
      const onPress = seg.hl
        ? () => onOpen(full, seg.hl, undefined)
        : () => onOpen(full, null, text);
      pieces.push(...splitDrop(text, seg.start, `m${i}`, mark, onPress));
      cursor = seg.end;
    });
    pushPlain(cursor, full.length, 'tail');

    return (
      <Text
        style={textStyle}
        onPress={onTap}
        onLongPress={() => onOpen(full, null, undefined)}
        suppressHighlighting
      >
        {indent ? '\u2003' : ''}
        {pieces}
      </Text>
    );
  }
);

// ---------------------------------------------------------------------------
// One reading page (two paragraphs)
// ---------------------------------------------------------------------------
interface PageBlockProps {
  page: BookContentPage;
  showChapterHeader: boolean;
  hls: HighlightEntry[];
  textStyle: object;
  dropStyle: object;
  fg: string;
  accent: string;
  onTap: (e: GestureResponderEvent) => void;
  onOpen: (page: BookContentPage, full: string, existing?: HighlightEntry | null, initial?: string) => void;
}

const PageBlock = React.memo<PageBlockProps>(
  ({ page, showChapterHeader, hls, textStyle, dropStyle, fg, accent, onTap, onOpen }) => {
    const p1 = page.dropCap + page.paragraph1;
    const p2 = page.paragraph2Lead + page.highlightedText + page.paragraph2Rest;

    const open = useCallback(
      (full: string, existing?: HighlightEntry | null, initial?: string) =>
        onOpen(page, full, existing, initial),
      [onOpen, page]
    );

    return (
      <View style={{ marginBottom: 20 }}>
        {showChapterHeader && (
          <View style={styles.chapterHead}>
            <Text style={[styles.chapterNo, { color: accent }]}>{page.chapterNumber}</Text>
            <Text style={[styles.chapterTitle, { color: fg }]}>{page.chapterTitle}</Text>
            <View style={[styles.rule, { backgroundColor: accent }]} />
          </View>
        )}

        <Paragraph
          full={p1}
          hls={hls}
          dropCap
          textStyle={textStyle}
          dropStyle={dropStyle}
          onTap={onTap}
          onOpen={open}
        />
        {p2.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Paragraph
              full={p2}
              hls={hls}
              indent
              textStyle={textStyle}
              dropStyle={dropStyle}
              onTap={onTap}
              onOpen={open}
            />
          </View>
        )}

      </View>
    );
  }
);

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
export const ReaderView: React.FC<ReaderViewProps> = ({
  currentBook,
  customPages,
  onUpdateReadingPosition,
  settings,
  onUpdateSettings,
  onOpenSettingsSheet,
  onOpenDictionary,
  highlights,
  onAddHighlight,
  onDeleteHighlight,
  onAddReflectionNote,
  isBookmarked,
  onToggleBookmark,
  isNavVisible,
  isImmersiveMode,
  onToggleNavVisibility,
  setNavVisibility,
  showToast,
  jumpTarget,
  bottomSpace,
}) => {
  const pages = useMemo<BookContentPage[]>(
    () => customPages ?? (currentBook ? BOOK_PAGES[currentBook.id] : undefined) ?? [],
    [customPages, currentBook?.id]
  );
  const getSavedPageIndex = () => {
    if (!pages.length) return 0;
    const savedIndex = pages.findIndex((p) => p.pageNumber === currentBook?.currentPage);
    return savedIndex >= 0
      ? savedIndex
      : Math.max(0, Math.min(pages.length - 1, (currentBook?.currentPage ?? 1) - 1));
  };

  const flowMode: ReadingFlowMode = settings.readingFlowMode || 'continuous';
  const paper = readerPaper[settings.theme];
  const isDark = settings.theme === 'charcoal';
  const accent = isDark ? colors.primaryFixedDim : colors.primary;

  const [pageIndex, setPageIndex] = useState(getSavedPageIndex);
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
  const { width: winWidth } = useWindowDimensions();
  const winWidthRef = useRef(winWidth);
  winWidthRef.current = winWidth;
  const [chaptersOpen, setChaptersOpen] = useState(false);
  // Scroll mode renders a window of pages that starts at `listBase`. A jump just moves the
  // window (and remounts the list), so the destination shows instantly instead of the list
  // scrolling through pages whose heights it hasn't measured yet. Earlier pages are
  // prepended on demand when the reader scrolls back up.
  const [listBase, setListBase] = useState(pageIndex);
  const [listKey, setListKey] = useState(0);
  const listBaseRef = useRef(listBase);
  listBaseRef.current = listBase;
  const listData = useMemo(() => pages.slice(listBase), [pages, listBase]);
  const jumpList = useCallback((idx: number) => {
    listBaseRef.current = idx;
    setListBase(idx);
    setListKey((k) => k + 1);
  }, []);
  const handleStartReached = useCallback(() => {
    if (listBaseRef.current <= 0) return;
    const next = Math.max(0, listBaseRef.current - 6);
    listBaseRef.current = next;
    setListBase(next);
  }, []);
  const [paginatedIndex, setPaginatedIndex] = useState(0);
  const [pageArea, setPageArea] = useState({ width: 0, height: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [typesetOpen, setTypesetOpen] = useState(false);
  const [sheet, setSheet] = useState<{
    page: BookContentPage;
    full: string;
    existing?: HighlightEntry | null;
    initial?: string;
  } | null>(null);

  const listRef = useRef<FlatList<BookContentPage>>(null);
  const scrollRef = useRef<ScrollView>(null);
  const navVisibleRef = useRef(isNavVisible);
  navVisibleRef.current = isNavVisible;
  const immersiveModeRef = useRef(isImmersiveMode);
  immersiveModeRef.current = isImmersiveMode;
  const toggleNavVisibilityRef = useRef(onToggleNavVisibility);
  toggleNavVisibilityRef.current = onToggleNavVisibility;
  const setNavVisibilityRef = useRef(setNavVisibility);
  setNavVisibilityRef.current = setNavVisibility;

  // reset when a different book is opened
  const bookId = currentBook?.id;
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  // Saving the reading position re-renders the whole app and writes to storage, so while the
  // reader is scrolling or scrubbing we only report it once it has settled for a moment.
  const onUpdatePositionRef = useRef(onUpdateReadingPosition);
  onUpdatePositionRef.current = onUpdateReadingPosition;
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPosition = useRef<{ bookId: string; page: BookContentPage; total: number } | null>(null);
  const flushPosition = useCallback(() => {
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = null;
    const pending = pendingPosition.current;
    pendingPosition.current = null;
    if (pending) onUpdatePositionRef.current(pending.bookId, pending.page, pending.total);
  }, []);
  useEffect(() => flushPosition, [flushPosition]);
  const updatePageIndex = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(pages.length - 1, index));
      setPageIndex(nextIndex);
      const nextPage = pages[nextIndex];
      if (bookId && nextPage) {
        pendingPosition.current = { bookId, page: nextPage, total: pages.length };
        if (positionTimer.current) clearTimeout(positionTimer.current);
        positionTimer.current = setTimeout(flushPosition, 400);
      }
    },
    [bookId, flushPosition, pages]
  );
  const updatePageIndexRef = useRef(updatePageIndex);
  updatePageIndexRef.current = updatePageIndex;
  const paginatedIndexRef = useRef(paginatedIndex);
  paginatedIndexRef.current = paginatedIndex;
  const turnPageRef = useRef<(index: number) => void>(() => {});
  const flowModeRef = useRef(flowMode);
  flowModeRef.current = flowMode;
  const pageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          flowModeRef.current === 'paginated' &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) < 50) return;
          turnPageRef.current(paginatedIndexRef.current + (gesture.dx < 0 ? 1 : -1));
        },
      }),
    []
  );
  const bookHighlights = useMemo(
    () => highlights.filter((h) => h.bookId === bookId),
    [highlights, bookId]
  );
  const previousPageHighlights = useRef<Map<number, HighlightEntry[]>>(new Map());
  const pageHighlightsRef = useRef<Map<number, HighlightEntry[]>>(new Map());
  const pageHighlights = useMemo(() => {
    const pageIndexByLocation = new Map<string, number>();
    pages.forEach((item, index) => {
      pageIndexByLocation.set(`${item.chapterTitle}\0${item.pageNumber}`, index);
    });

    const grouped = new Map<number, HighlightEntry[]>();
    bookHighlights.forEach((highlight) => {
      const index = pageIndexByLocation.get(`${highlight.chapter}\0${highlight.page}`);
      if (index === undefined) return;
      const group = grouped.get(index);
      if (group) group.push(highlight);
      else grouped.set(index, [highlight]);
    });

    const next = new Map<number, HighlightEntry[]>();
    pages.forEach((_, index) => {
      const updated = grouped.get(index) ?? NO_HIGHLIGHTS;
      const previous = previousPageHighlights.current.get(index);
      const unchanged =
        previous?.length === updated.length &&
        updated.every((highlight, i) => highlight === previous[i]);
      next.set(index, unchanged ? previous : updated);
    });
    previousPageHighlights.current = next;
    pageHighlightsRef.current = next;
    return next;
  }, [bookHighlights, pages]);
  const getPageHighlights = useCallback(
    (index: number) => pageHighlightsRef.current.get(index) ?? NO_HIGHLIGHTS,
    []
  );

  // ---- typography ----
  const baseSize = 14 + settings.fontSizeStep * 1.5;
  const lineHeight = Math.round(baseSize * LINE_MULT[settings.lineSpacing]);
  const fontFamily = readerFontFamily(settings.font);
  const hPad = MARGINS[settings.margins];

  const textStyle = useMemo(
    () => ({
      fontFamily,
      fontSize: baseSize,
      lineHeight,
      color: paper.fg,
      textAlign: 'justify' as const,
    }),
    [fontFamily, baseSize, lineHeight, paper.fg]
  );
  const dropStyle = useMemo(
    () => ({
      fontFamily: F.serifSemi,
      fontSize: Math.round(baseSize * 2.3),
      lineHeight: Math.round(lineHeight * 1.2),
      color: accent,
    }),
    [baseSize, lineHeight, accent]
  );

  const paginatedPages = useMemo(() => {
    if (pageArea.width <= 0 || pageArea.height <= 0) {
      return pages.map((source, sourceIndex) => ({
        sourceIndex,
        page: source,
        showChapterHeader: true,
      }));
    }
    const availableWidth = Math.max(80, pageArea.width - hPad * 2);
    const charsPerLine = Math.max(12, Math.floor(availableWidth / (baseSize * 0.58)));
    const maxLines = Math.max(4, Math.floor((pageArea.height - 112) / lineHeight));
    return paginateContent(pages, maxLines, charsPerLine);
  }, [baseSize, hPad, lineHeight, pageArea.height, pageArea.width, pages]);
  const turnPaginatedPage = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(paginatedPages.length - 1, index));
      const nextPage = paginatedPages[nextIndex];
      if (!nextPage) return;
      setPaginatedIndex(nextIndex);
      updatePageIndex(nextPage.sourceIndex);
    },
    [paginatedPages, updatePageIndex]
  );
  turnPageRef.current = turnPaginatedPage;

  // ---- fast navigation: chapters and scrubber ----
  const chapters = useMemo<ChapterInfo[]>(() => {
    const list: ChapterInfo[] = [];
    pages.forEach((p, i) => {
      const last = list[list.length - 1];
      if (last && last.number === p.chapterNumber) last.pageCount += 1;
      else list.push({ number: p.chapterNumber, title: p.chapterTitle, startIndex: i, pageCount: 1 });
    });
    return list;
  }, [pages]);

  const currentChapterIdx = Math.max(
    0,
    chapters.findIndex((c) => pageIndex >= c.startIndex && pageIndex < c.startIndex + c.pageCount)
  );

  /** Jump to a source page in whichever reading mode is active. */
  const goToSource = useCallback(
    (target: number) => {
      const idx = Math.max(0, Math.min(pages.length - 1, target));
      updatePageIndex(idx);
      if (flowMode === 'paginated') {
        const seg = paginatedPages.findIndex((item) => item.sourceIndex === idx);
        setPaginatedIndex(Math.max(0, seg));
      } else if (flowMode === 'continuous') {
        jumpList(idx);
      }
    },
    [flowMode, jumpList, paginatedPages, pages.length, updatePageIndex]
  );

  const goPrevChapter = useCallback(() => {
    const ch = chapters[currentChapterIdx];
    if (!ch) return;
    // like a media player: first press restarts the chapter, second goes back one
    if (pageIndexRef.current > ch.startIndex) goToSource(ch.startIndex);
    else if (currentChapterIdx > 0) goToSource(chapters[currentChapterIdx - 1].startIndex);
  }, [chapters, currentChapterIdx, goToSource]);

  const goNextChapter = useCallback(() => {
    const next = chapters[currentChapterIdx + 1];
    if (next) goToSource(next.startIndex);
  }, [chapters, currentChapterIdx, goToSource]);

  const scrubPaginated = flowMode === 'paginated';
  const scrubCount = scrubPaginated ? paginatedPages.length : pages.length;
  const scrubIndex = scrubPaginated ? paginatedIndex : pageIndex;
  const scrubMarks = useMemo(() => {
    if (scrubCount < 2) return [];
    return chapters.slice(1).map((c) => {
      const at = scrubPaginated
        ? Math.max(0, paginatedPages.findIndex((item) => item.sourceIndex === c.startIndex))
        : c.startIndex;
      return at / (scrubCount - 1);
    });
  }, [chapters, paginatedPages, scrubCount, scrubPaginated]);

  const scrubLabel = useCallback(
    (i: number) => {
      const src = scrubPaginated ? paginatedPages[i]?.page : pages[i];
      if (!src) return '';
      return `${src.chapterTitle}\nPage ${i + 1} of ${scrubCount}`;
    },
    [pages, paginatedPages, scrubCount, scrubPaginated]
  );

  const commitScrub = useCallback(
    (i: number) => {
      if (!scrubPaginated) {
        goToSource(i);
        return;
      }
      const seg = paginatedPages[i];
      if (!seg) return;
      turnPaginatedPage(i);
    },
    [goToSource, paginatedPages, scrubPaginated, turnPaginatedPage]
  );

  useEffect(() => {
    setChaptersOpen(false);
  }, [bookId]);

  // reset when a different book is opened
  useEffect(() => {
    const savedIndex = getSavedPageIndex();
    setPageIndex(savedIndex);
    const savedSegmentIndex = paginatedPages.findIndex((item) => item.sourceIndex === savedIndex);
    setPaginatedIndex(Math.max(0, savedSegmentIndex));
    if (flowMode === 'continuous') jumpList(savedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // coming back to Scroll mode: start the list at the page being read
  useEffect(() => {
    if (flowMode === 'continuous') jumpList(pageIndexRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMode]);

  useEffect(() => {
    if (flowMode !== 'paginated') return;
    const savedSegmentIndex = paginatedPages.findIndex((item) => item.sourceIndex === pageIndex);
    setPaginatedIndex(Math.max(0, savedSegmentIndex));
  }, [flowMode]);

  // ---- jump from Notebook / Search ----
  useEffect(() => {
    if (!jumpTarget || jumpTarget.bookId !== bookId || pages.length === 0) return;
    const idx = Math.max(0, pages.findIndex((p) => p.pageNumber === jumpTarget.page));
    updatePageIndex(idx);
    if (flowMode === 'paginated') {
      const segmentIndex = paginatedPages.findIndex((item) => item.sourceIndex === idx);
      setPaginatedIndex(Math.max(0, segmentIndex));
    }
    if (flowMode === 'continuous') jumpList(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce]);

  // paginated: back to top on page change
  useEffect(() => {
    if (flowMode === 'paginated') scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [paginatedIndex, flowMode]);

  const viewConfig = useRef({ itemVisiblePercentThreshold: 25 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.index != null);
    if (first && first.index != null) updatePageIndexRef.current(listBaseRef.current + first.index);
  }).current;

  // ---- passage sheet ----
  const openSheet = useCallback(
    (p: BookContentPage, full: string, existing?: HighlightEntry | null, initial?: string) =>
      setSheet({ page: p, full, existing, initial }),
    []
  );

  const closeSheet = () => setSheet(null);

  const baseHl = (p: BookContentPage) => ({
    bookId: currentBook!.id,
    bookTitle: currentBook!.title,
    chapter: p.chapterTitle,
    page: p.pageNumber,
    loc: p.locNumber,
  });

  const handleHighlight = (selected: string, color: (typeof HIGHLIGHT_COLORS)[number]) => {
    if (!sheet || !currentBook) return;
    onAddHighlight({ ...baseHl(sheet.page), colorName: color.name, colorHex: color.hex, text: selected });
    showToast('Highlight saved to Notebook');
    closeSheet();
  };

  const handleSaveNote = (selected: string, color: (typeof HIGHLIGHT_COLORS)[number], note: string) => {
    if (!sheet || !currentBook) return;
    if (sheet.existing && sheet.existing.text === selected) {
      onAddReflectionNote(sheet.existing.id, note);
    } else {
      onAddHighlight({
        ...baseHl(sheet.page),
        colorName: color.name,
        colorHex: color.hex,
        text: selected,
        note,
      });
    }
    showToast('Reflection note saved');
    closeSheet();
  };

  const handleDefine = (word: string, context: string) => {
    closeSheet();
    // let the sheet finish dismissing before presenting another modal (iOS)
    setTimeout(() => onOpenDictionary(word, context), 320);
  };

  const handleCopy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    showToast('Copied to clipboard');
    closeSheet();
  };

  const handleDelete = () => {
    if (sheet?.existing) {
      onDeleteHighlight(sheet.existing.id);
      showToast('Highlight removed');
    }
    closeSheet();
  };

  // Pages mode: tap the left / right edge to turn the page, the middle to toggle the HUD.
  const handleTap = useCallback((e?: GestureResponderEvent) => {
    if (flowModeRef.current === 'paginated' && e) {
      const x = e.nativeEvent.pageX;
      const w = winWidthRef.current;
      if (x < w * 0.28) {
        turnPageRef.current(paginatedIndexRef.current - 1);
        return;
      }
      if (x > w * 0.72) {
        turnPageRef.current(paginatedIndexRef.current + 1);
        return;
      }
    }
    if (navVisibleRef.current || immersiveModeRef.current) toggleNavVisibilityRef.current();
    else setNavVisibilityRef.current(true);
  }, []);
  const renderPage = useCallback(
    (p: BookContentPage, idx: number, showChapterHeader?: boolean) => (
      <PageBlock
        page={p}
        showChapterHeader={
          showChapterHeader ??
          (flowMode === 'paginated' ||
            idx === 0 ||
            pages[idx - 1].chapterNumber !== p.chapterNumber)
        }
        hls={getPageHighlights(idx)}
        textStyle={textStyle}
        dropStyle={dropStyle}
        fg={paper.fg}
        accent={accent}
        onTap={handleTap}
        onOpen={openSheet}
      />
    ),
    [accent, dropStyle, flowMode, getPageHighlights, handleTap, openSheet, pages, paper.fg, textStyle]
  );
  const renderListItem = useCallback(
    ({ item, index }: { item: BookContentPage; index: number }) =>
      renderPage(item, listBase + index),
    [listBase, renderPage]
  );
  // keyed by page number (not list position) so prepending earlier pages keeps rows stable
  const keyExtractor = useCallback((item: BookContentPage) => String(item.pageNumber), []);
  const listContentStyle = useMemo(
    () => ({ paddingHorizontal: hPad, paddingTop: 24, paddingBottom: 32 }),
    [hPad]
  );
  const chapterText = useMemo(
    () =>
      page
        ? pages
            .filter((p) => p.chapterNumber === page.chapterNumber)
            .map(
              (p) =>
                p.dropCap +
                p.paragraph1 +
                ' ' +
                (p.paragraph2Lead + p.highlightedText + p.paragraph2Rest)
            )
            .join(' ')
        : '',
    [page?.chapterNumber, pages]
  );

  // ---- empty states ----
  if (!currentBook) {
    return (
      <View style={styles.empty}>
        <Icon name="menu_book" size={40} color={colors.secondaryFixedDim} />
        <Text style={styles.emptyTitle}>Nothing to read yet</Text>
        <Text style={styles.emptyBody}>Import an EPUB from the Library to start reading.</Text>
      </View>
    );
  }
  if (pages.length === 0 || !page) {
    return (
      <View style={styles.empty}>
        <Icon name="cloud_upload" size={40} color={colors.secondaryFixedDim} />
        <Text style={styles.emptyTitle}>{currentBook.title}</Text>
        <Text style={styles.emptyBody}>
          The text of this book isn’t stored on this device. Import the EPUB again from the Library to
          read it here.
        </Text>
      </View>
    );
  }

  const paginatedPercent = Math.round(((pageIndex + 1) / pages.length) * 100);
  const percent = Math.max(
    0,
    Math.min(
      100,
      flowMode === 'paginated'
        ? Math.round(((paginatedIndex + 1) / Math.max(1, paginatedPages.length)) * 100)
        : paginatedPercent
    )
  );

  const flowOptions: { id: ReadingFlowMode; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
    { id: 'continuous', label: 'Scroll', icon: 'unfold_more' },
    { id: 'paginated', label: 'Pages', icon: 'auto_stories' },
    { id: 'single-line', label: 'Line', icon: 'speed' },
  ];

  const themeSwatches: { id: PaperTheme; bg: string }[] = [
    { id: 'parchment', bg: '#FAF6EE' },
    { id: 'white', bg: '#ffffff' },
    { id: 'sepia', bg: '#f7ecd7' },
    { id: 'charcoal', bg: '#23221e' },
  ];

  return (
    <View style={styles.root}>
      {/* HUD */}
      {isNavVisible ? (
        <View style={styles.hud}>
          <View style={styles.hudTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hudBook} numberOfLines={1}>
                {currentBook.title}
              </Text>
              <Text style={styles.hudChapter} numberOfLines={1}>
                {page.chapterNumber} · {page.chapterTitle}
              </Text>
            </View>

            <View style={styles.hudActions}>
              <HudButton
                icon="format_size"
                active={typesetOpen}
                onPress={() => {
                  setTypesetOpen((o) => !o);
                  setMenuOpen(false);
                }}
                label="Quick typography"
              />
              <HudButton
                icon={isBookmarked ? 'bookmark' : 'bookmark_border'}
                active={isBookmarked}
                onPress={onToggleBookmark}
                label="Bookmark"
              />
              <HudButton icon="fullscreen" onPress={onToggleNavVisibility} label="Immersive mode" />
              <HudButton
                icon="more_vert"
                active={menuOpen}
                onPress={() => {
                  setMenuOpen((o) => !o);
                  setTypesetOpen(false);
                }}
                label="More"
              />
            </View>
          </View>

          <View style={styles.flowRow}>
            {flowOptions.map((o) => {
              const active = flowMode === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onUpdateSettings({ readingFlowMode: o.id })}
                  style={[styles.flowBtn, active && { backgroundColor: colors.primary }]}
                >
                  <Icon name={o.icon} size={15} color={active ? '#fff' : colors.muted} />
                  <Text style={[styles.flowText, { color: active ? '#fff' : colors.muted }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {typesetOpen && (
            <View style={styles.drawer}>
              <View style={styles.drawerRow}>
                <Pressable
                  onPress={() => onUpdateSettings({ fontSizeStep: Math.max(1, settings.fontSizeStep - 1) })}
                  style={styles.sizeBtn}
                >
                  <Text style={styles.sizeSmall}>A</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <ProgressBar percent={(settings.fontSizeStep / 8) * 100} height={6} fill={colors.primary} />
                </View>
                <Pressable
                  onPress={() => onUpdateSettings({ fontSizeStep: Math.min(8, settings.fontSizeStep + 1) })}
                  style={styles.sizeBtn}
                >
                  <Text style={styles.sizeLarge}>A</Text>
                </Pressable>
              </View>
              <View style={styles.swatchRow}>
                {themeSwatches.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => onUpdateSettings({ theme: t.id })}
                    accessibilityLabel={t.id}
                    style={[
                      styles.swatch,
                      { backgroundColor: t.bg },
                      settings.theme === t.id && { borderColor: colors.primary, borderWidth: 2 },
                    ]}
                  />
                ))}
              </View>
            </View>
          )}

          {menuOpen && (
            <View style={styles.menu}>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  onOpenSettingsSheet();
                }}
              >
                <Icon name="tune" size={18} color={colors.onSurface} />
                <Text style={styles.menuText}>Typography &amp; Layout</Text>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setChaptersOpen(true);
                }}
              >
                <Icon name="toc" size={18} color={colors.onSurface} />
                <Text style={styles.menuText}>Contents</Text>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  onOpenDictionary('', '');
                }}
              >
                <Icon name="menu_book" size={18} color={colors.onSurface} />
                <Text style={styles.menuText}>Look up a word</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.hudSlim}>
          <Text style={styles.hudChapter} numberOfLines={1}>
            {page.chapterTitle}
          </Text>
          <HudButton icon="fullscreen_exit" onPress={onToggleNavVisibility} label="Exit immersive mode" />
        </View>
      )}

      {/* Page surface */}
      <View style={[styles.article, { backgroundColor: paper.bg }]}>
        {flowMode === 'single-line' ? (
          <SingleLineReader
            book={currentBook}
            chapterTitle={page.chapterTitle}
            chapterText={chapterText}
            settings={settings}
            onExit={() => onUpdateSettings({ readingFlowMode: 'paginated' })}
            onAddHighlight={onAddHighlight}
            showToast={showToast}
          />
        ) : flowMode === 'continuous' ? (
          <FlatList
            ref={listRef}
            key={listKey}
            data={listData}
            extraData={pageHighlights}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            contentContainerStyle={listContentStyle}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={viewConfig}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            updateCellsBatchingPeriod={60}
            windowSize={5}
            onStartReached={handleStartReached}
            onStartReachedThreshold={1.5}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View
            style={{ flex: 1 }}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setPageArea((current) =>
                current.width === width && current.height === height ? current : { width, height }
              );
            }}
            {...pageSwipeResponder.panHandlers}
          >
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              scrollEnabled={false}
              contentContainerStyle={{ flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
            >
              {/* blank space also counts as a tap: edges turn the page, centre toggles the HUD */}
              <Pressable
                onPress={handleTap}
                style={{ flexGrow: 1, paddingHorizontal: hPad, paddingTop: 24, paddingBottom: 24 }}
              >
                {paginatedPages[paginatedIndex] &&
                  renderPage(
                    paginatedPages[paginatedIndex].page,
                    paginatedPages[paginatedIndex].sourceIndex,
                    paginatedPages[paginatedIndex].showChapterHeader
                  )}
              </Pressable>
            </ScrollView>
            {isImmersiveMode ? (
              <View style={[styles.pager, styles.pagerMinimal]}>
                <Text style={styles.minimalPageCount}>
                  {paginatedIndex + 1} / {paginatedPages.length}
                </Text>
              </View>
            ) : (
              <View style={styles.pager}>
                <Pressable
                  onPress={() => turnPaginatedPage(paginatedIndex - 1)}
                  disabled={paginatedIndex === 0}
                  style={[styles.pagerBtn, paginatedIndex === 0 && { opacity: 0.35 }]}
                >
                  <Icon name="chevron_left" size={22} color={colors.onSurface} />
                  <Text style={styles.pagerText}>Prev</Text>
                </Pressable>
                <Text style={styles.pagerCount}>
                  {paginatedIndex + 1} / {paginatedPages.length}
                </Text>
                <Pressable
                  onPress={() => turnPaginatedPage(paginatedIndex + 1)}
                  disabled={paginatedIndex >= paginatedPages.length - 1}
                  style={[
                    styles.pagerBtn,
                    paginatedIndex >= paginatedPages.length - 1 && { opacity: 0.35 },
                  ]}
                >
                  <Text style={styles.pagerText}>Next</Text>
                  <Icon name="chevron_right" size={22} color={colors.onSurface} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Footer: contents · chapter skip · draggable scrubber */}
      <View style={[styles.footer, { paddingBottom: bottomSpace }]}>
        {isImmersiveMode ? (
          <ProgressBar percent={percent} height={2} style={styles.minimalProgress} />
        ) : (
          <View style={styles.navRow}>
            <Pressable
              onPress={() => setChaptersOpen(true)}
              accessibilityLabel="Contents"
              hitSlop={6}
              style={styles.navBtn}
            >
              <Icon name="toc" size={22} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={goPrevChapter}
              accessibilityLabel="Previous chapter"
              hitSlop={6}
              style={styles.navBtn}
            >
              <Icon name="skip_previous" size={22} color={colors.onSurface} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <ScrubBar
                count={scrubCount}
                index={scrubIndex}
                labelFor={scrubLabel}
                onCommit={commitScrub}
                marks={scrubMarks}
              />
            </View>
            <Pressable
              onPress={goNextChapter}
              accessibilityLabel="Next chapter"
              disabled={currentChapterIdx >= chapters.length - 1}
              hitSlop={6}
              style={[styles.navBtn, currentChapterIdx >= chapters.length - 1 && { opacity: 0.35 }]}
            >
              <Icon name="skip_next" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        )}
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>
            Loc {fmt(page.locNumber)} of {fmt(page.totalLoc)} · {percent}%
          </Text>
          {!isImmersiveMode && settings.displayReadingPace && (
            <View style={styles.paceRow}>
              <Icon name="schedule" size={13} color={colors.muted} />
              <Text style={styles.footerText}>{page.minutesLeftInChapter} min left in chapter</Text>
            </View>
          )}
        </View>
      </View>

      {chaptersOpen && (
        <ChapterSheet
          chapters={chapters}
          currentIndex={currentChapterIdx}
          onClose={() => setChaptersOpen(false)}
          onSelect={(startIndex) => {
            setChaptersOpen(false);
            goToSource(startIndex);
          }}
        />
      )}

      {sheet && (
        <PassageSheet
          text={sheet.full}
          initialSelection={sheet.initial}
          existing={sheet.existing}
          onClose={closeSheet}
          onHighlight={handleHighlight}
          onSaveNote={handleSaveNote}
          onDefine={handleDefine}
          onCopy={handleCopy}
          onDelete={sheet.existing ? handleDelete : undefined}
        />
      )}
    </View>
  );
};

const HudButton: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  onPress: () => void;
  label: string;
  active?: boolean;
}> = ({ icon, onPress, label, active }) => (
  <Pressable
    onPress={onPress}
    accessibilityLabel={label}
    hitSlop={4}
    style={[styles.hudBtn, active && { backgroundColor: 'rgba(255,219,207,0.55)' }]}
  >
    <Icon name={icon} size={21} color={active ? colors.primary : colors.muted} />
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { ...type.headlineSm, color: colors.onSurface, textAlign: 'center' },
  emptyBody: { ...type.bodyMd, color: colors.muted, textAlign: 'center', maxWidth: 300 },

  hud: { zIndex: 20, paddingBottom: 8, gap: 8 },
  hudTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hudBook: { ...type.labelMd, color: colors.onSurface },
  hudChapter: { ...type.bodySm, color: colors.muted },
  hudActions: { flexDirection: 'row', alignItems: 'center' },
  hudBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hudSlim: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  flowRow: { flexDirection: 'row', backgroundColor: colors.surfaceContainer, padding: 3, borderRadius: 12, gap: 3 },
  flowBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 9,
  },
  flowText: { ...type.labelMd },
  drawer: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  drawerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sizeBtn: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  sizeSmall: { fontFamily: F.serifSemi, fontSize: 15, color: colors.onSurface },
  sizeLarge: { fontFamily: F.serifSemi, fontSize: 24, color: colors.onSurface },
  swatchRow: { flexDirection: 'row', justifyContent: 'space-around' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  menu: {
    position: 'absolute',
    right: 0,
    top: 46,
    minWidth: 210,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 30,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  menuText: { ...type.bodyMd, color: colors.onSurface },

  article: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chapterHead: { alignItems: 'center', marginBottom: 22, gap: 6 },
  chapterNo: { fontFamily: F.sansSemi, fontSize: 11, letterSpacing: 2 },
  chapterTitle: { fontFamily: F.serifMedium, fontSize: 26, lineHeight: 32, textAlign: 'center' },
  rule: { width: 36, height: 2, opacity: 0.4, marginTop: 4 },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
  },
  pagerBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 8 },
  pagerText: { ...type.labelLg, color: colors.onSurface },
  pagerCount: { ...type.labelMd, color: colors.muted },
  pagerMinimal: { justifyContent: 'center', paddingVertical: 5 },
  minimalPageCount: { ...type.bodySm, color: colors.muted, opacity: 0.7 },

  footer: { paddingTop: 6, gap: 2, zIndex: 10 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  minimalProgress: { opacity: 0.55 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { ...type.bodySm, color: colors.muted },
});
