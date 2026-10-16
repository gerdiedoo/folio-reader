import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppPalette, useAppTheme } from '../AppTheme';
import {
  CatalogBook,
  CatalogSort,
  deleteDownloaded,
  downloadEpub,
  loadAdded,
  rememberAdded,
  searchCatalog,
  TOPICS,
} from '../lib/catalog';
import { parseEpubFile } from '../lib/epubParser';
import { savePages } from '../lib/localStore';
import { F, type } from '../theme';
import { Book, BookContentPage } from '../types';
import { BookCover } from './BookCover';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { ProgressBar } from './ui/ProgressBar';

interface Props {
  books: Book[];
  viewMode: BrowseViewMode;
  onViewModeChange: (mode: BrowseViewMode) => void;
  onAddEpubBook: (book: Book, pages: BookContentPage[]) => void;
  onOpenBook: (bookId: string) => void;
  showToast: (msg: string) => void;
  onClose: () => void;
}

type RowStatus = 'get' | 'downloading' | 'preparing' | 'added';
type BrowseViewMode = 'grid' | 'list';
type BrowseSort = 'popularity' | 'title' | 'releaseDate' | 'author';

const SORT_OPTIONS: { id: BrowseSort; label: string }[] = [
  { id: 'popularity', label: 'Popularity' },
  { id: 'title', label: 'Title' },
  { id: 'releaseDate', label: 'Release date' },
  { id: 'author', label: 'Author' },
];

const compact = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const normalizeTitle = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// One result row. Memoised: only re-renders when its own status changes.
// ---------------------------------------------------------------------------
interface RowProps {
  item: CatalogBook;
  status: RowStatus;
  disabled: boolean;
  progressPercent: number | null;
  onGet: (item: CatalogBook) => void;
  onRead: (item: CatalogBook) => void;
  viewMode: BrowseViewMode;
  cardWidth: number;
}

const BookRow = React.memo<RowProps>(({ item, status, disabled, progressPercent, onGet, onRead, viewMode, cardWidth }) => {
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const busy = status === 'downloading' || status === 'preparing';

  return (
    <View style={[styles.row, viewMode === 'grid' && styles.gridCard, viewMode === 'grid' && { width: cardWidth }]}>
      <BookCover
        book={{ title: item.title, author: item.author, coverUrl: item.coverUrl, coverAlt: `Cover for ${item.title}` }}
        style="image"
        size={viewMode === 'list' ? 'compact' : 'regular'}
        containerStyle={viewMode === 'list' ? { width: 64, aspectRatio: 2 / 3 } : { width: '100%', aspectRatio: 2 / 3 }}
      />
      <View style={[{ flex: 1, justifyContent: 'space-between', minHeight: 96 }, viewMode === 'grid' && styles.gridCardCopy]}>
        <View>
          <Text style={styles.rowTitle} numberOfLines={viewMode === 'grid' ? 3 : 2}>
            {item.title}
          </Text>
          <Text style={styles.rowAuthor} numberOfLines={1}>
            {item.author}
          </Text>
          <Text style={styles.rowMeta}>{compact(item.downloads)} downloads · EPUB</Text>
        </View>
        <View style={styles.rowAction}>
          {status === 'added' ? (
            <Pressable onPress={() => onRead(item)} style={[styles.btn, styles.btnOutline]}>
              <Icon name="check_circle" size={16} color={palette.primary} />
              <Text style={[styles.btnText, { color: palette.primary }]}>In library · Read</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => onGet(item)}
              disabled={disabled || busy}
              style={[styles.btn, styles.btnFilled, (disabled && !busy) && { opacity: 0.45 }]}
              accessibilityLabel={`Add ${item.title} to library`}
            >
              <Icon name={busy ? 'sync' : 'download'} size={16} color="#fff" spin={busy} />
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {status === 'downloading' ? 'Downloading…' : status === 'preparing' ? 'Preparing…' : 'Get'}
              </Text>
            </Pressable>
          )}
        </View>
        {busy ? (
          <View style={styles.downloadProgress}>
            <ProgressBar percent={progressPercent ?? 0} height={3} />
            <Text style={styles.rowMeta}>
              {status === 'preparing'
                ? 'Preparing book…'
                : progressPercent === null
                  ? 'Starting download…'
                  : `${progressPercent}% downloaded`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export const BrowseBooksScreen: React.FC<Props> = ({
  books,
  viewMode,
  onViewModeChange,
  onAddEpubBook,
  onOpenBook,
  showToast,
  onClose,
}) => {
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - 52) / 2);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [topicId, setTopicId] = useState('popular');
  const [sortBy, setSortBy] = useState<BrowseSort>('popularity');
  const [items, setItems] = useState<CatalogBook[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{
    id: string;
    phase: 'downloading' | 'preparing';
    progressPercent: number | null;
  } | null>(null);
  const pendingGet = useRef(false);
  const [duplicateBook, setDuplicateBook] = useState<{ existing: Book; catalog: CatalogBook } | null>(null);

  // searching ignores the topic chip (the two filters together would be confusing)
  const effectiveTopic = query ? '' : TOPICS.find((t) => t.id === topicId)?.topic ?? '';
  const catalogSort: CatalogSort = sortBy === 'releaseDate' ? 'descending' : 'popular';
  const sortedItems = useMemo(() => {
    if (sortBy === 'popularity' || sortBy === 'releaseDate') return items;
    return [...items].sort((a, b) => {
      const primary = sortBy === 'title'
        ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        : a.author.localeCompare(b.author, undefined, { sensitivity: 'base' });
      return primary || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  }, [items, sortBy]);

  const libraryIds = useMemo(() => new Set(books.map((b) => b.id)), [books]);

  // ---- load: first page whenever the search text / topic changes ----
  const generation = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const gen = ++generation.current;
    const ctrl = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = null;
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreError(false);
    setError(null);
    setItems([]);
    setPage(1);
    setHasMore(false);
    searchCatalog({ query, topic: effectiveTopic, page: 1, sort: catalogSort }, ctrl.signal)
      .then((res) => {
        if (gen !== generation.current) return;
        setItems(res.books);
        setHasMore(res.hasMore);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return;
        setError(err instanceof Error ? err.message : 'Could not reach the catalog.');
        setLoading(false);
      });
    return () => {
      ctrl.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, effectiveTopic, catalogSort, reloadNonce]);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 450);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    loadAdded().then(setAdded);
  }, []);

  // ---- infinite scroll ----
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || error) return;
    const gen = generation.current;
    const ctrl = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = ctrl;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const res = await searchCatalog({ query, topic: effectiveTopic, page: page + 1, sort: catalogSort }, ctrl.signal);
      if (gen !== generation.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...res.books.filter((b) => !seen.has(b.id))];
      });
      setPage((p) => p + 1);
      setHasMore(res.hasMore);
    } catch {
      if (gen === generation.current && !ctrl.signal.aborted) {
        setLoadMoreError(true);
        showToast('Could not load more books. Tap to retry.');
      }
    } finally {
      if (moreRequest.current === ctrl) {
        moreRequest.current = null;
        setLoadingMore(false);
      }
    }
  }, [loading, loadingMore, hasMore, error, query, effectiveTopic, catalogSort, page, showToast]);

  // ---- download + import ----
  const downloadAndImport = async (item: CatalogBook) => {
    let uri: string | null = null;
    setActive({ id: item.id, phase: 'downloading', progressPercent: 0 });
    try {
      uri = await downloadEpub(item, (progressPercent) => {
        setActive((current) =>
          current?.id === item.id ? { ...current, progressPercent } : current
        );
      });
      setActive({ id: item.id, phase: 'preparing', progressPercent: 100 });
      // let "Preparing…" paint before unzipping a big book occupies the JS thread
      await new Promise((r) => setTimeout(r, 60));
      const { book, pages } = await parseEpubFile(uri, `${item.title}.epub`);
      if (!book.coverUrl && item.coverUrl) {
        book.coverUrl = item.coverUrl;
        book.coverStyle = 'image';
      }
      savePages(book.id, pages);
      onAddEpubBook(book, pages);
      setAdded(await rememberAdded(added, item.id, book.id));
    } catch (err: unknown) {
      console.warn('Catalog download failed:', err);
      const msg = err instanceof Error ? err.message : '';
      showToast(
        /Invalid EPUB/i.test(msg) ? 'That file could not be read as an EPUB.' : 'Download failed. Check your connection and try again.'
      );
    } finally {
      if (uri) deleteDownloaded(uri);
      setActive(null);
      pendingGet.current = false;
    }
  };

  const handleGet = (item: CatalogBook) => {
    if (active || pendingGet.current) return;
    pendingGet.current = true;
    const existingBook = books.find((book) => normalizeTitle(book.title) === normalizeTitle(item.title));
    if (existingBook) {
      setDuplicateBook({ existing: existingBook, catalog: item });
      return;
    }
    void downloadAndImport(item);
  };

  const handleRead = (item: CatalogBook) => {
    const bookId = added[item.id];
    if (!bookId) return;
    onClose();
    onOpenBook(bookId);
  };

  // stable callbacks so memoised rows don't re-render on every state change
  const latest = useRef({ handleGet, handleRead });
  latest.current = { handleGet, handleRead };
  const onGet = useCallback((i: CatalogBook) => latest.current.handleGet(i), []);
  const onRead = useCallback((i: CatalogBook) => latest.current.handleRead(i), []);

  const statusOf = (item: CatalogBook): RowStatus => {
    if (active?.id === item.id) return active.phase;
    const bookId = added[item.id];
    return bookId && libraryIds.has(bookId) ? 'added' : 'get';
  };

  const renderItem = ({ item }: { item: CatalogBook }) => (
    <BookRow
      item={item}
      status={statusOf(item)}
      disabled={!!active}
      progressPercent={active?.id === item.id ? active.progressPercent : null}
      onGet={onGet}
      onRead={onRead}
      viewMode={viewMode}
      cardWidth={cardWidth}
    />
  );

  const topicLabel = TOPICS.find((t) => t.id === topicId)?.label ?? 'Popular';

  const empty = loading ? (
    <View style={{ gap: 14 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.skel, { width: 64, height: 96, borderRadius: 6 }]} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <View style={[styles.skel, { height: 16, width: '75%' }]} />
            <View style={[styles.skel, { height: 12, width: '45%' }]} />
            <View style={[styles.skel, { height: 12, width: '30%' }]} />
          </View>
        </View>
      ))}
    </View>
  ) : error ? (
    <View style={styles.state}>
      <Icon name="cloud_off" size={40} color={palette.secondaryFixedDim} />
      <Text style={styles.stateTitle}>Can’t reach the catalog</Text>
      <Text style={styles.stateBody}>{error}</Text>
      <Pressable onPress={() => setReloadNonce((n) => n + 1)} style={[styles.btn, styles.btnFilled, { marginTop: 6 }]}>
        <Icon name="refresh" size={16} color="#fff" />
        <Text style={[styles.btnText, { color: '#fff' }]}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.state}>
      <Icon name="search" size={40} color={palette.secondaryFixedDim} />
      <Text style={styles.stateTitle}>No books found</Text>
      <Text style={styles.stateBody}>
        {query ? `Nothing matched “${query}”. ` : ''}Try an author’s name or a word from the title.
      </Text>
    </View>
  );

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (duplicateBook) {
          setDuplicateBook(null);
          pendingGet.current = false;
        } else {
          onClose();
        }
      }}
      statusBarTranslucent
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.backBtn} accessibilityLabel="Back to library">
            <Icon name="arrow_back" size={22} color={palette.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Free books</Text>
            <Text style={styles.subtitle}>Public-domain classics from Project Gutenberg</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Icon name="search" size={20} color={palette.muted} />
          <TextInput
            value={queryInput}
            onChangeText={setQueryInput}
            onSubmitEditing={() => setQuery(queryInput.trim())}
            placeholder="Search titles or authors…"
            placeholderTextColor={palette.muted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {queryInput ? (
            <Pressable
              onPress={() => {
                setQueryInput('');
                setQuery('');
              }}
              hitSlop={8}
            >
              <Icon name="close" size={18} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Topics */}
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            {TOPICS.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                active={!query && topicId === t.id}
                onPress={() => {
                  setQueryInput('');
                  setQuery('');
                  setTopicId(t.id);
                }}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.sortRow}>
          <View style={styles.sortGroup}>
            <Icon name="sort" size={16} color={palette.muted} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sortOptions}
              keyboardShouldPersistTaps="handled"
            >
              {SORT_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setSortBy(option.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sortBy === option.id }}
                >
                  <Text style={[styles.sortText, sortBy === option.id && styles.sortActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.viewToggle}>
            {(['grid', 'list'] as const).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => onViewModeChange(mode)}
                style={[styles.viewToggleButton, viewMode === mode && { backgroundColor: palette.surface }]}
                accessibilityLabel={`${mode === 'grid' ? 'Grid' : 'List'} view`}
                accessibilityState={{ selected: viewMode === mode }}
              >
                <Icon
                  name={mode === 'grid' ? 'view_module' : 'view_list'}
                  size={19}
                  color={viewMode === mode ? palette.primary : palette.muted}
                />
              </Pressable>
            ))}
          </View>
        </View>
        {sortBy === 'releaseDate' ? (
          <Text style={styles.sortNote}>Approximate release order, based on Gutenberg ID.</Text>
        ) : null}

        <View style={styles.countRow}>
          {!loading && !error && items.length > 0 ? (
            <Text style={styles.count}>
              {query ? `Results for “${query}”` : topicLabel} · {total.toLocaleString()} books
            </Text>
          ) : <View style={{ flex: 1 }} />}
        </View>

        {/* Results */}
        <FlatList
          key={viewMode}
          data={sortedItems}
          extraData={[active, added, libraryIds]}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? styles.gridColumn : undefined}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          ListEmptyComponent={empty}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <Icon name="sync" size={20} color={palette.muted} spin />
              </View>
            ) : loadMoreError ? (
              <Pressable onPress={loadMore} style={[styles.btn, styles.btnOutline, { alignSelf: 'center', marginTop: 8 }]}>
                <Icon name="refresh" size={16} color={palette.primary} />
                <Text style={[styles.btnText, { color: palette.primary }]}>Retry loading more</Text>
              </Pressable>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={[
            styles.resultsContent,
            { paddingBottom: insets.bottom + 28 },
            viewMode === 'list' && styles.resultsList,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={7}
        />
        {duplicateBook ? (
          <View style={styles.confirmationOverlay}>
            <Pressable
              accessibilityLabel="Dismiss duplicate book warning"
              onPress={() => {
                setDuplicateBook(null);
                pendingGet.current = false;
              }}
              style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
            />
            <View
              accessibilityViewIsModal
              style={[styles.confirmationCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <View style={[styles.confirmationIcon, { backgroundColor: palette.primaryFixed }]}>
                <Icon name="menu_book" size={24} color={palette.primary} />
              </View>
              <Text style={[styles.confirmationTitle, { color: palette.onSurface }]}>
                This book may already be in your library
              </Text>
              <Text style={[styles.confirmationBody, { color: palette.muted }]}>
                <Text style={{ color: palette.onSurfaceVariant, fontFamily: F.sansSemi }}>
                  {duplicateBook.existing.title}
                  {duplicateBook.existing.author ? ` by ${duplicateBook.existing.author}` : ''}
                </Text>
                {' '}has the same title. Would you like to download another copy?
              </Text>
              <View style={styles.confirmationActions}>
                <Pressable
                  onPress={() => {
                    setDuplicateBook(null);
                    pendingGet.current = false;
                  }}
                  style={[styles.btn, styles.btnOutline, styles.confirmationButton]}
                >
                  <Text style={[styles.btnText, { color: palette.primary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDuplicateBook(null);
                    void downloadAndImport(duplicateBook.catalog);
                  }}
                  style={[styles.btn, styles.btnFilled, styles.confirmationButton]}
                >
                  <Text style={[styles.btnText, { color: palette.white }]}>Download anyway</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
};

const createStyles = (p: AppPalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.background, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    title: { ...type.headlineSm, color: p.onSurface },
    subtitle: { ...type.bodySm, color: p.muted },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: p.surfaceContainer,
      borderRadius: 14,
      paddingHorizontal: 14,
      marginHorizontal: 20,
    },
    searchInput: { flex: 1, paddingVertical: 12, fontFamily: F.sans, fontSize: 14, color: p.onSurface },
    chipRow: { gap: 8, paddingHorizontal: 20 },
    sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 20 },
    sortGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    sortOptions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 8 },
    sortText: { ...type.labelMd, color: p.muted },
    sortActive: { color: p.primary },
    sortNote: { ...type.bodySm, color: p.muted, marginTop: -8, paddingHorizontal: 20 },
    countRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    count: { ...type.labelSm, color: p.muted, flex: 1 },
    viewToggle: { flexDirection: 'row', backgroundColor: p.surfaceContainer, padding: 3, borderRadius: 10, gap: 2 },
    viewToggleButton: { width: 34, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    resultsContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28, gap: 16 },
    resultsList: { gap: 12 },
    gridColumn: { justifyContent: 'space-between', gap: 12 },

    row: {
      flexDirection: 'row',
      gap: 14,
      padding: 12,
      borderRadius: 16,
      backgroundColor: p.surfaceLow,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.borderSoft,
    },
    gridCard: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
    gridCardCopy: { minHeight: 148 },
    rowTitle: { fontFamily: F.serifSemi, fontSize: 17, lineHeight: 21, color: p.onSurface },
    rowAuthor: { ...type.bodyMd, color: p.onSurfaceVariant, marginTop: 2 },
    rowMeta: { ...type.bodySm, color: p.muted, marginTop: 2 },
    rowAction: { flexDirection: 'row', marginTop: 8 },
    downloadProgress: { gap: 5, marginTop: 7 },

    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    btnFilled: { backgroundColor: p.primaryContainer },
    btnOutline: { borderWidth: 1.5, borderColor: p.primary },
    btnText: { ...type.labelMd },

    confirmationOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      zIndex: 10,
    },
    confirmationCard: {
      width: '100%',
      maxWidth: 400,
      alignItems: 'center',
      padding: 24,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 12,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    confirmationIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    confirmationTitle: {
      ...type.headlineSm,
      fontSize: 21,
      lineHeight: 27,
      textAlign: 'center',
    },
    confirmationBody: {
      ...type.bodyMd,
      textAlign: 'center',
      marginTop: 8,
    },
    confirmationActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 10,
      width: '100%',
      marginTop: 22,
    },
    confirmationButton: {
      justifyContent: 'center',
      flex: 1,
      minHeight: 42,
      paddingHorizontal: 10,
    },

    skel: { backgroundColor: p.surfaceHigh, borderRadius: 4 },
    state: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 24 },
    stateTitle: { ...type.headlineSm, fontSize: 20, color: p.onSurface },
    stateBody: { ...type.bodyMd, color: p.muted, textAlign: 'center' },
  });
