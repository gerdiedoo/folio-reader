import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------------------------------------------------------------------------
// Paragraph rendering with inline highlights
// ---------------------------------------------------------------------------
interface Seg {
  start: number;
  end: number;
  hl?: HighlightEntry;
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
  onTap: () => void;
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
  onTap: () => void;
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
  const lastY = useRef(0);
  const navShown = useRef(isNavVisible);
  navShown.current = isNavVisible;

  // reset when a different book is opened
  const bookId = currentBook?.id;
  useEffect(() => {
    const savedIndex = getSavedPageIndex();
    setPageIndex(savedIndex);
    lastY.current = 0;
    if (flowMode === 'continuous') {
      const timer = setTimeout(() => {
        listRef.current?.scrollToIndex({ index: savedIndex, animated: false });
      }, 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const updatePageIndex = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(pages.length - 1, index));
      setPageIndex(nextIndex);
      const nextPage = pages[nextIndex];
      if (bookId && nextPage) {
        onUpdateReadingPosition(bookId, nextPage, pages.length);
      }
    },
    [bookId, onUpdateReadingPosition, pages]
  );
  const updatePageIndexRef = useRef(updatePageIndex);
  updatePageIndexRef.current = updatePageIndex;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
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
          updatePageIndexRef.current(pageIndexRef.current + (gesture.dx < 0 ? 1 : -1));
        },
      }),
    []
  );
  const bookHighlights = useMemo(
    () => highlights.filter((h) => h.bookId === bookId),
    [highlights, bookId]
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

  // ---- jump from Notebook / Search ----
  useEffect(() => {
    if (!jumpTarget || jumpTarget.bookId !== bookId || pages.length === 0) return;
    const idx = Math.max(0, pages.findIndex((p) => p.pageNumber === jumpTarget.page));
    updatePageIndex(idx);
    if (flowMode === 'continuous') {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: false });
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce]);

  // paginated: back to top on page change
  useEffect(() => {
    if (flowMode === 'paginated') scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [pageIndex, flowMode]);

  // ---- scroll handling (progress + immersive nav) ----
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;

      const dy = y - lastY.current;
      if (!isImmersiveMode) {
        if (dy > 14 && y > 60 && navShown.current) setNavVisibility(false);
        else if ((dy < -18 || y < 20) && !navShown.current) setNavVisibility(true);
      }
      lastY.current = y;
    },
    [isImmersiveMode, setNavVisibility]
  );

  const viewConfig = useRef({ itemVisiblePercentThreshold: 25 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.index != null);
    if (first && first.index != null) updatePageIndexRef.current(first.index);
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

  const handleTap = useCallback(() => {
    if (isNavVisible || isImmersiveMode) onToggleNavVisibility();
    else setNavVisibility(true);
  }, [isImmersiveMode, isNavVisible, onToggleNavVisibility, setNavVisibility]);
  const renderPage = useCallback(
    (p: BookContentPage, idx: number) => (
      <PageBlock
        page={p}
        showChapterHeader={
          flowMode === 'paginated' ||
          idx === 0 ||
          pages[idx - 1].chapterNumber !== p.chapterNumber
        }
        hls={bookHighlights}
        textStyle={textStyle}
        dropStyle={dropStyle}
        fg={paper.fg}
        accent={accent}
        onTap={handleTap}
        onOpen={openSheet}
      />
    ),
    [accent, bookHighlights, dropStyle, flowMode, handleTap, openSheet, pages, paper.fg, textStyle]
  );
  const renderListItem = useCallback(
    ({ item, index }: { item: BookContentPage; index: number }) => renderPage(item, index),
    [renderPage]
  );
  const keyExtractor = useCallback((_: BookContentPage, index: number) => String(index), []);
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: info.index, animated: false });
      }, 120);
    },
    []
  );
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
  const percent = Math.max(0, Math.min(100, paginatedPercent));

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
            data={pages}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            contentContainerStyle={listContentStyle}
            onScroll={handleScroll}
            scrollEventThrottle={32}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={viewConfig}
            initialNumToRender={3}
            maxToRenderPerBatch={4}
            windowSize={7}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={{ flex: 1 }} {...pageSwipeResponder.panHandlers}>
            <ScrollView
              ref={scrollRef}
              onScroll={handleScroll}
              scrollEventThrottle={32}
              contentContainerStyle={{ paddingHorizontal: hPad, paddingTop: 24, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {renderPage(page, pageIndex)}
            </ScrollView>
            <View style={styles.pager}>
              <Pressable
                onPress={() => updatePageIndex(pageIndex - 1)}
                disabled={pageIndex === 0}
                style={[styles.pagerBtn, pageIndex === 0 && { opacity: 0.35 }]}
              >
                <Icon name="chevron_left" size={22} color={colors.onSurface} />
                <Text style={styles.pagerText}>Prev</Text>
              </Pressable>
              <Text style={styles.pagerCount}>
                {pageIndex + 1} / {pages.length}
              </Text>
              <Pressable
                onPress={() => updatePageIndex(pageIndex + 1)}
                disabled={pageIndex >= pages.length - 1}
                style={[styles.pagerBtn, pageIndex >= pages.length - 1 && { opacity: 0.35 }]}
              >
                <Text style={styles.pagerText}>Next</Text>
                <Icon name="chevron_right" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: bottomSpace }]}>
        <ProgressBar percent={percent} height={4} />
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>
            Loc {fmt(page.locNumber)} of {fmt(page.totalLoc)} · {percent}%
          </Text>
          {settings.displayReadingPace && (
            <View style={styles.paceRow}>
              <Icon name="schedule" size={13} color={colors.muted} />
              <Text style={styles.footerText}>{page.minutesLeftInChapter} min left in chapter</Text>
            </View>
          )}
        </View>
      </View>

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
    minHeight: 89,
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

  footer: { paddingTop: 10, gap: 6 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { ...type.bodySm, color: colors.muted },
});
