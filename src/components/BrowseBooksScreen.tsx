import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppPalette, useAppTheme } from '../AppTheme';
import { useReducedMotion } from '../MotionPreferences';
import {
  CatalogBook,
  CatalogSort,
  CATALOG_SOURCES,
  deleteDownloaded,
  downloadEpub,
  loadAdded,
  loadDiscoveryDetails as loadCatalogBookDetails,
  rememberAdded,
  searchDiscovery as searchCatalog,
  TOPICS,
} from '../lib/catalog';
import { ImportStorageError } from '../lib/bookImport';
import { bookShelfLayout, type ShelfColumns } from '../lib/bookShelfLayout';
import type { LocalStore } from '../lib/localStore';
import { parseEpubFile } from '../lib/epubParser';
import { F, type } from '../theme';
import { Book, BookContentPage } from '../types';
import { BookCover } from './BookCover';
import { BookDescription } from './BookDescription';
import { Icon } from './ui/Icon';
import { renderShelfChip, renderShelfSort, renderShelfViewOptions, shelfStyles } from './ui/ShelfControls';
import { ProgressBar } from './ui/ProgressBar';
import { GoogleBooksSetup } from './GoogleBooksSetup';
import { googleBooksKeyStore } from '../lib/googleBooksKeyNative';
import type { DiscoveryFilter } from '../lib/discoveryCatalog';
import { mergeDiscoveryBooks } from '../lib/openLibraryMetadata';
import { EpubSources, EPUB_SOURCES } from './EpubSources';

interface Props {
  storage: LocalStore;
  books: Book[];
  availableBookIds: readonly string[];
  viewMode: BrowseViewMode;
  onViewModeChange: (mode: BrowseViewMode) => void;
  gridColumns: ShelfColumns;
  onGridColumnsChange: (columns: ShelfColumns) => void;
  onAddEpubBook: (book: Book, pages: BookContentPage[]) => Promise<void>;
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
  { id: 'releaseDate', label: 'Newest added' },
  { id: 'author', label: 'Author' },
];

const compact = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const normalizeTitle = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// An imported copy can belong to the library without a saved catalog shortcut.
const workKey = (book: { title: string; author: string }): string | undefined => {
  const title = normalizeTitle(book.title), author = typeof book.author === 'string' ? normalizeTitle(book.author) : '';
  return title && author ? JSON.stringify([title, author]) : undefined;
};

// ---------------------------------------------------------------------------
// One result row. Memoised: only re-renders when its own status changes.
// ---------------------------------------------------------------------------
interface RowProps {
  item: CatalogBook;
  status: RowStatus;
  disabled: boolean;
  progressPercent: number | null;
  onGet: (item: CatalogBook) => void;
  inLibrary?: boolean;
  onDetails: (item: CatalogBook) => void;
  viewMode: BrowseViewMode;
  cardWidth: number;
  error?: string;
  dense?: boolean;
}

export const BookRow = React.memo<RowProps>(({ item, status, disabled, progressPercent = null, onGet, inLibrary = false, onDetails, viewMode, cardWidth, error, dense }) => {
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const busy = status === 'downloading' || status === 'preparing';

  return (
    <View style={[styles.row, viewMode === 'grid' && styles.gridCard, viewMode === 'grid' && { width: cardWidth }]}>
      <Pressable onPress={() => onDetails(item)} accessibilityRole="button" accessibilityLabel={`View details for ${item.title} by ${item.author}`} accessibilityHint={inLibrary ? 'Already in your library' : 'View book details and download options'}
        style={viewMode === 'grid' ? { width: '100%' } : { width: 64 }}>
      <BookCover
        book={{ title: item.title, author: item.author, coverUrl: item.coverUrl, coverAlt: `Cover for ${item.title}` }}
        style="image"
        fallback="typographic"
        inLibrary={inLibrary}
        variant={viewMode === 'grid' ? 'library' : 'default'}
        size={viewMode === 'list' ? 'compact' : 'regular'}
        containerStyle={viewMode === 'list' ? { width: 64, aspectRatio: 2 / 3 } : { width: '100%', aspectRatio: 2 / 3 }}
      />
      </Pressable>
      <View style={{ flex: 1, justifyContent: 'space-between', minHeight: viewMode === 'grid' ? 0 : 96 }}>
        <Pressable onPress={() => onDetails(item)} accessibilityRole="button" accessibilityLabel={`About ${item.title}`} style={{ minHeight: 48 }}>
          <Text style={[viewMode === 'grid' ? styles.shelfTitle : styles.rowTitle, dense && shelfStyles.denseTitle]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[viewMode === 'grid' ? styles.shelfAuthor : styles.rowAuthor, dense && shelfStyles.denseAuthor]} numberOfLines={viewMode === 'grid' ? 2 : 1}>
            {item.author}
          </Text>
          {viewMode === 'list' && <Text style={styles.rowMeta}>{item.catalogKind === 'work' ? item.publicationYear ? `First published ${item.publicationYear}` : 'Book information' : `EPUB${item.downloads > 0 ? ` · ${compact(item.downloads)} downloads` : ''}`}</Text>}
        </Pressable>
        {error && !busy && status !== 'added' && <View style={styles.rowAction}>
          <Pressable onPress={() => onGet(item)} disabled={disabled}
            accessibilityRole="button" accessibilityLabel={`Retry downloading ${item.title}`} accessibilityState={{ disabled }}
            style={[styles.btn, styles.btnOutline, viewMode === 'grid' && styles.shelfAction, disabled && { opacity: 0.45 }]}>
            <Icon name="refresh" size={16} color={palette.primary} />
            <Text style={[styles.btnText, viewMode === 'grid' && styles.shelfActionText, { color: palette.primary }]}>Retry</Text>
          </Pressable>
        </View>}
        {error && <Text accessibilityRole="alert" style={styles.rowError}>{error}</Text>}
        {busy ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={`${status === 'preparing' ? 'Preparing' : 'Downloading'} ${item.title}`}
            accessibilityState={{ busy: true }} accessibilityValue={{ min: 0, max: 100,
              ...(progressPercent !== null ? { now: progressPercent } : {}),
              text: status === 'preparing' ? 'Preparing book' : progressPercent === null ? 'Starting download' : `${progressPercent}% downloaded` }}
            style={styles.downloadProgress}>
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
  storage,
  books,
  availableBookIds,
  viewMode,
  onViewModeChange,
  gridColumns,
  onGridColumnsChange,
  onAddEpubBook,
  onOpenBook,
  showToast,
  onClose,
}) => {
  const reducedMotion = useReducedMotion();
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const layout = bookShelfLayout(width, fontScale, gridColumns);
  const columns = viewMode === 'grid' ? layout.columns : 1;
  const cardWidth = layout.cardWidth;

  const keyStore = useMemo(() => googleBooksKeyStore(storage.storageKey('googleBooksKey')), [storage]);
  const [googleKey, setGoogleKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(true), [keyLoadError, setKeyLoadError] = useState(false);
  const [keyRetry, setKeyRetry] = useState(0), [keySetupOpen, setKeySetupOpen] = useState(false);
  useEffect(() => {
    let current = true; setKeyLoading(true); setKeyLoadError(false);
    keyStore.load().then(key => { if (current) { setGoogleKey(key); setKeyLoading(false); } })
      .catch(() => { if (current) { setKeyLoadError(true); setKeyLoading(false); } });
    return () => { current = false; };
  }, [keyStore, keyRetry]);
  const [source, setSource] = useState<DiscoveryFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'info' | 'recovery' | undefined>();
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [topicId, setTopicId] = useState('popular');
  const [sortBy, setSortBy] = useState<BrowseSort>('popularity');
  const [items, setItems] = useState<CatalogBook[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{
    id: string;
    workId?: string;
    phase: 'downloading' | 'preparing';
    progressPercent: number | null;
  } | null>(null);
  const [selectedBook, setSelectedBook] = useState<CatalogBook | null>(null);
  const [detailState, setDetailState] = useState<{ id: string; book?: CatalogBook; error?: string; loading: boolean } | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  useEffect(() => {
    if (!selectedBook) return;
    const controller = new AbortController();
    setDetailState({ id: selectedBook.id, loading: true });
    loadCatalogBookDetails(selectedBook, controller.signal, { googleBooksKey: googleKey }).then(book => {
      if (!controller.signal.aborted) setDetailState({ id: selectedBook.id, book, loading: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetailState({ id: selectedBook.id, loading: false,
        error: error instanceof Error ? error.message : 'Could not load book details.' });
    });
    return () => controller.abort();
  }, [selectedBook, detailRetry, googleKey]);
  const pendingGet = useRef(false);
  const alive = useRef(true);
  const transfer = useRef<AbortController | null>(null);
  const phase = useRef<'downloading' | 'preparing' | null>(null);
  const close = () => {
    if (phase.current === 'preparing') return;
    transfer.current?.abort();
    onClose();
  };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; transfer.current?.abort(); };
  }, []);
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

  const ownedWorks = useMemo(() => new Set(books.map(workKey).filter(Boolean)), [books]);
  const ownedLibraryIds = useMemo(() => new Set(books.map(book => book.id)), [books]);
  const libraryIds = useMemo(() => new Set(books.filter(book => availableBookIds.includes(book.id)).map(book => book.id)), [books, availableBookIds]);

  const sourceGoogleKey = source === 'google' ? googleKey : null;
  const sourceKeyLoading = source === 'google' && keyLoading;
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
    setNotice(null);
    setTotal(0);
    setItems([]);
    setPage(1);
    setHasMore(false);
    if (source === 'google' && (sourceKeyLoading || !sourceGoogleKey)) {
      setLoading(sourceKeyLoading);
      return () => ctrl.abort();
    }
    searchCatalog({ query, topic: effectiveTopic, page: 1, sort: catalogSort, source, googleBooksKey: sourceGoogleKey }, ctrl.signal)
      .then((res) => {
        if (!alive.current || ctrl.signal.aborted || gen !== generation.current) return;
        setItems(res.books);
        setHasMore(res.hasMore);
        setTotal(res.total);
        setNotice(res.notice ?? null); setNoticeKind(res.noticeKind);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive.current || ctrl.signal.aborted || gen !== generation.current) return;
        setError(err instanceof Error ? err.message : 'Could not reach the catalog.');
        setLoading(false);
      });
    return () => {
      ctrl.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, effectiveTopic, catalogSort, source, reloadNonce, sourceGoogleKey, sourceKeyLoading]);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 450);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    loadAdded(storage).then(saved => { if (alive.current) setAdded(current => ({ ...saved, ...current })); });
  }, []);

  // ---- infinite scroll ----
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || moreRequest.current || !hasMore || error) return;
    const gen = generation.current;
    const ctrl = new AbortController();
    moreRequest.current = ctrl;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const res = await searchCatalog({ query, topic: effectiveTopic, page: page + 1, sort: catalogSort, source, googleBooksKey: sourceGoogleKey }, ctrl.signal);
      if (!alive.current || ctrl.signal.aborted || gen !== generation.current) return;
      setItems((prev) => {
        return mergeDiscoveryBooks(prev, res.books);
      });
      setPage((p) => p + 1);
      setHasMore(res.hasMore);
    } catch {
      if (alive.current && gen === generation.current && !ctrl.signal.aborted) {
        setLoadMoreError(true);
        showToast('Could not load more books. Tap to retry.');
      }
    } finally {
      if (alive.current && moreRequest.current === ctrl) {
        moreRequest.current = null;
        setLoadingMore(false);
      }
    }
  }, [loading, loadingMore, hasMore, error, query, effectiveTopic, catalogSort, source, sourceGoogleKey, page, showToast]);

  // ---- download + import ----
  const downloadAndImport = async (item: CatalogBook) => {
    let uri: string | null = null;
    const ctrl = new AbortController();
    transfer.current = ctrl;
    phase.current = 'downloading';
    setDownloadErrors(current => { const next = { ...current }; delete next[item.id]; if (item.discoveryWorkId) delete next[item.discoveryWorkId]; return next; });
    setActive({ id: item.id, workId: item.discoveryWorkId, phase: 'downloading', progressPercent: 0 });
    try {
      uri = await downloadEpub(item, (progressPercent) => {
        if (alive.current && !ctrl.signal.aborted) setActive(current => current?.id === item.id ? { ...current, progressPercent } : current);
      }, ctrl.signal, { googleBooksKey: googleKey });
      if (!alive.current || ctrl.signal.aborted) return;
      phase.current = 'preparing';
      setActive({ id: item.id, workId: item.discoveryWorkId, phase: 'preparing', progressPercent: 100 });
      await new Promise(resolve => setTimeout(resolve, 60));
      if (!alive.current || ctrl.signal.aborted) return;
      const { book, pages } = await parseEpubFile(uri, `${item.title}.epub`, storage);
      if (!alive.current || ctrl.signal.aborted) {
        storage.removeBookFiles(book.id, book.coverUrl);
        return;
      }
      // Discovery artwork takes precedence; existing source-only imports keep embedded art.
      if (item.coverUrl && (item.useDiscoveryCover || !book.coverUrl)) book.coverUrl = item.coverUrl;
      if (!book.annotation && item.description) book.annotation = item.description;
      book.coverStyle = item.useDiscoveryCover && !item.coverUrl ? 'typographic' : 'image';
      await onAddEpubBook(book, pages);
      if (!alive.current) return;
      const next = { ...added, [item.id]: book.id, ...(item.discoveryWorkId ? { [item.discoveryWorkId]: book.id } : {}) };
      setAdded(next); // The library save is confirmed even if bookkeeping fails.
      try { await rememberAdded(next, item.id, book.id, storage); }
      catch { if (alive.current) showToast('Book saved in Library. Its catalog shortcut could not be saved; open it from Library.'); }
    } catch (err: unknown) {
      if (!alive.current || ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : '';
      const message = err instanceof ImportStorageError ? msg
        : /Invalid EPUB|zip|central directory/i.test(msg) ? 'This source did not send a readable EPUB. Retry or try another edition or source.'
        : msg || 'Download failed. Check your connection and try again.';
      setDownloadErrors(current => ({ ...current, [item.id]: message, ...(item.discoveryWorkId ? { [item.discoveryWorkId]: message } : {}) }));
      showToast(message);
    } finally {
      if (uri) deleteDownloaded(uri);
      if (alive.current) setActive(null);
      phase.current = null;
      transfer.current = null;
      pendingGet.current = false;
    }
  };

  const handleGet = (item: CatalogBook) => {
    if (!alive.current || active || pendingGet.current) return;
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
    if (!bookId || !libraryIds.has(bookId)) return;
    onClose();
    onOpenBook(bookId);
  };

  // stable callbacks so memoised rows don't re-render on every state change
  const latest = useRef({ handleGet });
  latest.current = { handleGet };
  const onGet = useCallback((i: CatalogBook) => i.catalogKind === 'work' ? setSelectedBook(i) : latest.current.handleGet(i), []);

  const statusOf = (item: CatalogBook): RowStatus => {
    if (active?.id === item.id || active?.workId === item.id) return active.phase;
    const bookId = added[item.id];
    return bookId && libraryIds.has(bookId) ? 'added' : 'get';
  };

  const inLibrary = (item: CatalogBook) => Boolean(
    added[item.id] && ownedLibraryIds.has(added[item.id]) || ownedWorks.has(workKey(item))
  );

  const renderItem = ({ item }: { item: CatalogBook }) => (
    <BookRow
      item={item}
      status={statusOf(item)}
      disabled={!!active}
      progressPercent={active?.id === item.id || active?.workId === item.id ? active?.progressPercent ?? null : null}
      onGet={onGet}
      inLibrary={inLibrary(item)}
      onDetails={setSelectedBook}
      viewMode={viewMode}
      cardWidth={cardWidth}
      dense={viewMode === 'grid' && columns === 3}
      error={downloadErrors[item.id]}
    />
  );

  const topicLabel = TOPICS.find((t) => t.id === topicId)?.label ?? 'Popular';
  const detail = selectedBook && detailState?.id === selectedBook.id ? detailState : null;
  const detailBook = detail?.book ?? selectedBook;
  const detailStatus = detailBook ? statusOf(detailBook) : 'get';
  const detailBusy = detailStatus === 'downloading' || detailStatus === 'preparing';

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
  ) : source === 'google' && !googleKey ? (
    <View style={styles.state}>
      <Icon name="menu_book" size={40} color={palette.secondaryFixedDim} />
      <Text style={styles.stateTitle}>{keyLoadError ? 'Couldn’t check your saved key' : 'Connect Google Books'}</Text>
      <Text style={styles.stateBody}>Use your own Google Books API key to browse free EPUBs. Other book sources work without it.</Text>
      <Pressable onPress={() => setKeySetupOpen(true)} accessibilityRole="button" accessibilityLabel="Set up Google Books" style={[styles.btn, styles.btnFilled]}><Text style={{ color: palette.white }}>Google Books setup</Text></Pressable>
    </View>
  ) : error ? (
    <View style={styles.state}>
      <Icon name="cloud_off" size={40} color={palette.secondaryFixedDim} />
      <Text style={styles.stateTitle}>Can’t reach the catalog</Text>
      <Text style={styles.stateBody}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry catalog" onPress={() => setReloadNonce((n) => n + 1)} style={[styles.btn, styles.btnFilled, { marginTop: 6 }]}>
        <Icon name="refresh" size={16} color="#fff" />
        <Text style={[styles.btnText, { color: '#fff' }]}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.state}>
      <Icon name="search" size={40} color={palette.secondaryFixedDim} />
      <Text style={styles.stateTitle}>No books found</Text>
      <Text style={styles.stateBody}>
        {hasMore && source !== 'all' ? 'No EPUB listings on this page. Load more to check the next results, or try another search.' : `${query ? `Nothing matched “${query}”. ` : ''}Try an author’s name or a word from the title.`}
      </Text>
    </View>
  );

  const newestSources = ['all', 'gutenberg', 'standard', 'archive', 'google'];
  const sortOptions = SORT_OPTIONS.filter(option => option.id !== 'releaseDate' || newestSources.includes(source)).map(option => option.id === 'popularity' && !['gutenberg', 'standard', 'archive'].includes(source) ? { ...option, label: source === 'all' ? 'Relevance' : 'Source order' } : option.id === 'releaseDate' && source === 'all' ? { ...option, label: 'Newest published' } : option);
  const browserHeader = <View style={{ gap: 6, paddingBottom: 8 }}>
    <View>
      <Text style={styles.rowMeta}>EPUB source</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {renderShelfChip(palette, 'All books', source === 'all', () => setSource('all'))}
        {EPUB_SOURCES.map(item => renderShelfChip(palette, item.label, source === item.id, () => { setSource(item.id); if (sortBy === 'releaseDate' && !newestSources.includes(item.id)) setSortBy('popularity'); }))}
      </ScrollView>
      {source === 'google' && <Pressable onPress={() => setKeySetupOpen(true)} disabled={!!active}
        accessibilityRole="button" accessibilityLabel="Google Books setup" accessibilityState={{ disabled: !!active }} style={styles.smallAction}>
        <Text style={[styles.rowMeta, { color: palette.primary }]}>{keyLoading ? 'Checking saved key…' : keyLoadError ? 'Retry Google Books setup' : googleKey ? 'Google Books key saved · Manage' : 'Add your Google Books key'}</Text>
      </Pressable>}

    </View>
    {/* Search lives outside the virtualized results so typing keeps focus. */}
    {/* Topics */}
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {TOPICS.map(topic => renderShelfChip(palette, topic.id === 'popular' ? 'All subjects' : topic.label, !query && topicId === topic.id,
          () => { setQueryInput(''); setQuery(''); setTopicId(topic.id); }))}
      </ScrollView>
    </View>

    <View style={styles.sortRow}>
      <View style={styles.sortGroup}>
        <Icon name="sort" size={16} color={palette.muted} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortOptions} keyboardShouldPersistTaps="handled">
          {sortOptions.map(option => renderShelfSort(palette, option.label, `Sort books by ${option.label}`, sortBy === option.id, () => setSortBy(option.id)))}
        </ScrollView>
      </View>
      {renderShelfViewOptions(palette, viewMode, gridColumns, onViewModeChange, onGridColumnsChange)}
    </View>
    {viewMode === 'grid' && columns !== gridColumns && <Text style={styles.sortNote}>Using {columns} {columns === 1 ? 'column' : 'columns'} to keep this layout readable.</Text>}
    {(sortBy === 'title' || sortBy === 'author') && <Text style={styles.sortNote}>Sorting the loaded books.</Text>}
    {sortBy === 'releaseDate' && source === 'gutenberg' ? (
      <Text style={styles.sortNote}>Approximate order of addition, based on Gutenberg ID.</Text>
    ) : null}

    {notice && <View style={[styles.notice, { marginHorizontal: 0 }]}>
      <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{notice}</Text>
      {noticeKind !== 'info' && <Pressable accessibilityRole="button" accessibilityLabel="Retry live catalog" onPress={() => setReloadNonce(value => value + 1)} style={styles.smallAction}><Text style={styles.sortActive}>Retry live catalog</Text></Pressable>}
    </View>}
    <View style={styles.countRow}>
      {!loading && !error && items.length > 0 ? (
        <Text style={styles.count}>
          {query ? `Results for “${query}”` : topicId === 'popular' ? 'All subjects' : topicLabel} · {total === null ? `${items.length} books loaded` : `${total.toLocaleString()} books`}
        </Text>
      ) : <View style={{ flex: 1 }} />}
    </View>
  </View>;

  const searchBar = <View style={styles.searchBox}>
      <Icon name="search" size={20} color={palette.muted} />
      <TextInput
        value={queryInput}
        onChangeText={value => setQueryInput(value.slice(0, 200))}
        maxLength={200}
        accessibilityLabel="Search books by title or author"
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
          accessibilityRole="button" accessibilityLabel="Clear book search" style={styles.smallAction}
        >
          <Icon name="close" size={18} color={palette.muted} />
        </Pressable>
      ) : null}
    </View>;

  return (
    <Modal
      visible
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={() => {
        if (duplicateBook) {
          setDuplicateBook(null);
          pendingGet.current = false;
        } else if (selectedBook) {
          setSelectedBook(null);
        } else {
          close();
        }
      }}
      statusBarTranslucent
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => selectedBook ? setSelectedBook(null) : close()} disabled={!selectedBook && active?.phase === 'preparing'} accessibilityState={{ disabled: !selectedBook && active?.phase === 'preparing' }} accessibilityRole="button" style={styles.backBtn} accessibilityLabel={selectedBook ? 'Back to books' : 'Back to library'}>
            <Icon name="arrow_back" size={22} color={palette.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={styles.title}>{selectedBook ? 'Book details' : 'Browse books'}</Text>
            <Text style={styles.subtitle}>{selectedBook ? selectedBook.openLibraryWorkId ? 'Open Library' : 'Book information' : source === 'all' ? 'Open Library · EPUBs checked in details' : `EPUB listings · ${CATALOG_SOURCES.find(item => item.id === source)?.label}`}</Text>
          </View>
        </View>

        {active && <View style={styles.notice}>
          <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{active.phase === 'preparing' ? 'Saving your book. Please wait…' : 'Downloading your book…'}</Text>
          {active.phase === 'downloading' && <Pressable accessibilityRole="button" accessibilityLabel="Cancel book download" onPress={() => transfer.current?.abort()} style={styles.smallAction}><Text style={styles.sortActive}>Cancel download</Text></Pressable>}
        </View>}
        {/* Results */}
        <View style={{ flex: 1, width: '100%', maxWidth: 768, alignSelf: 'center' }}>
        <View style={{ flex: 1 }} pointerEvents={selectedBook ? 'none' : 'auto'}
          accessibilityElementsHidden={!!selectedBook} importantForAccessibility={selectedBook ? 'no-hide-descendants' : 'auto'}>
        {searchBar}
        <FlatList
          key={`${viewMode}-${columns}`}
          accessibilityLabel={source === 'all' ? 'Open Library books' : `${CATALOG_SOURCES.find(item => item.id === source)?.label} books`}
          data={sortedItems}
          extraData={[active, added, libraryIds, ownedLibraryIds, ownedWorks, downloadErrors]}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.gridColumn : undefined}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          ListHeaderComponent={browserHeader}
          ListEmptyComponent={empty}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <Icon name="sync" size={20} color={palette.muted} spin />
              </View>
            ) : loadMoreError ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Retry loading more books" onPress={loadMore} style={[styles.btn, styles.btnOutline, { alignSelf: 'center', marginTop: 8 }]}>
                <Icon name="refresh" size={16} color={palette.primary} />
                <Text style={[styles.btnText, { color: palette.primary }]}>Retry loading more</Text>
              </Pressable>
            ) : hasMore && !loading && !error ? <Pressable onPress={loadMore} accessibilityRole="button" accessibilityLabel="Load more books" style={[styles.btn, styles.btnOutline]}><Text style={[styles.btnText, { color: palette.primary }]}>Load more books</Text></Pressable> : null
          }
          onEndReached={items.length ? loadMore : undefined}
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
        </View>
        {keySetupOpen && <GoogleBooksSetup store={keyStore} hasKey={Boolean(googleKey)} loading={keyLoading} loadError={keyLoadError}
          onRetry={() => setKeyRetry(value => value + 1)} onSaved={key => { setGoogleKey(key); setKeyLoadError(false); }} onClose={() => setKeySetupOpen(false)} />}
        {detailBook && <ScrollView key={detailBook.id} style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
          contentContainerStyle={[styles.detailsContent, { paddingBottom: insets.bottom + 28 }]}>
          <View style={styles.detailsCover}>
            <BookCover book={{ title: detailBook.title, author: detailBook.author, coverUrl: detailBook.coverUrl, coverAlt: `Cover for ${detailBook.title}` }} style="image" fallback="typographic"
              inLibrary={inLibrary(detailBook)} containerStyle={{ width: 144, aspectRatio: 2 / 3 }} />
          </View>
          <Text accessibilityRole="header" selectable style={styles.detailsTitle}>{detailBook.title}</Text>
          <Text selectable style={styles.detailsAuthor}>{detailBook.author}</Text>
          <Text style={styles.rowMeta}>{detailBook.catalogKind === 'work' ? `${detailBook.publicationYear ? `First published ${detailBook.publicationYear} · ` : ''}${detailBook.editionCount ? `${detailBook.editionCount} editions · ` : ''}${detailBook.openLibraryWorkId ? 'Open Library metadata' : 'Source metadata'}` : `${CATALOG_SOURCES.find(item => item.id === (detailBook.source ?? 'gutenberg'))?.label} · EPUB`}</Text>
          {detailStatus === 'added' ? (
            <Pressable onPress={() => handleRead(detailBook)} accessibilityRole="button" accessibilityLabel={`Read ${detailBook.title}`} style={[styles.btn, styles.btnFilled]}>
              <Text style={[styles.btnText, { color: palette.white }]}>Read book</Text>
            </Pressable>
          ) : detailBook.catalogKind === 'work' ? null : (
            <Pressable onPress={() => handleGet(detailBook)} disabled={!!active || detailBusy} accessibilityRole="button"
              accessibilityLabel={`${downloadErrors[detailBook.id] ? 'Retry downloading' : 'Add'} ${detailBook.title}${downloadErrors[detailBook.id] ? '' : ' to library'}`}
              accessibilityState={{ disabled: !!active || detailBusy, busy: detailBusy }} style={[styles.btn, styles.btnFilled, !!active && { opacity: 0.6 }]}>
              <Icon name={detailBusy ? 'sync' : 'download'} size={18} color={palette.white} spin={detailBusy} />
              <Text style={[styles.btnText, { color: palette.white }]}>{detailStatus === 'preparing' ? 'Preparing…' : detailStatus === 'downloading' ? 'Downloading…' : downloadErrors[detailBook.id] ? 'Retry download' : 'Add to Library'}</Text>
            </Pressable>
          )}
          {detailBusy && <View style={styles.downloadProgress}>
            <ProgressBar percent={active?.progressPercent ?? 0} height={3} />
            <Text accessibilityLiveRegion="polite" style={styles.rowMeta}>{detailStatus === 'preparing' ? 'Preparing book…' : `${active?.progressPercent ?? 0}% downloaded`}</Text>
          </View>}
          {downloadErrors[detailBook.id] && <Text accessibilityRole="alert" style={styles.rowError}>{downloadErrors[detailBook.id]}</Text>}
          <View style={styles.detailsSection}>
            <Text accessibilityRole="header" style={styles.detailsSectionTitle}>About this book</Text>
            <BookDescription value={detailBook.description} emptyText={detail?.loading !== false ? 'Loading description…' : detail.error ? 'Description could not be loaded.' : detailBook.catalogKind === 'work' ? 'No description is available for this book.' : 'This source has not provided a description for this edition.'} />
            {(!detail || detail.loading) && !!detailBook.description && <Text accessibilityLiveRegion="polite" style={styles.rowMeta}>Loading edition details…</Text>}
            {detail?.error && <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={styles.rowMeta}>{detail.error}</Text>
              <Pressable onPress={() => setDetailRetry(value => value + 1)} accessibilityRole="button" accessibilityLabel="Retry book details" style={[styles.btn, styles.btnOutline]}>
                <Text style={[styles.btnText, { color: palette.primary }]}>Retry details</Text>
              </Pressable>
            </View>}
          </View>
          {detailBook.catalogKind === 'work' && <EpubSources book={detailBook} googleKey={googleKey} keyLoading={keyLoading} onSetupGoogle={() => setKeySetupOpen(true)} onGet={handleGet}
            disabled={!!active} activeId={active?.id} errors={downloadErrors} />}
          {!!detailBook.languages?.length && <View style={styles.detailsSection}>
            <Text style={styles.detailsSectionTitle}>Language</Text><Text selectable style={styles.subtitle}>{detailBook.languages.join(', ')}</Text>
          </View>}
          {!!detailBook.subjects.length && <View style={styles.detailsSection}>
            <Text style={styles.detailsSectionTitle}>Subjects</Text><Text selectable style={styles.subtitle}>{detailBook.subjects.join(' · ')}</Text>
          </View>}
          {detailBook.downloads > 0 && <Text style={styles.rowMeta}>{detailBook.downloads.toLocaleString()} downloads from this source</Text>}
        </ScrollView>}
        </View>
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
                  accessibilityRole="button" accessibilityLabel="Cancel duplicate download"
                  style={[styles.btn, styles.btnOutline, styles.confirmationButton]}
                >
                  <Text style={[styles.btnText, { color: palette.primary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!alive.current || phase.current || !pendingGet.current) return;
                    setDuplicateBook(null);
                    void downloadAndImport(duplicateBook.catalog);
                  }}
                  accessibilityRole="button" accessibilityLabel="Download another copy"
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
    screen: { flex: 1, backgroundColor: p.background, gap: 8 },
    detailsContent: { padding: 20, gap: 12 },
    detailsCover: { alignItems: 'center', paddingVertical: 8 },
    detailsTitle: { ...type.headlineSm, color: p.onSurface, textAlign: 'center' },
    detailsAuthor: { ...type.bodyMd, color: p.muted, textAlign: 'center' },
    detailsSection: { gap: 10, padding: 16, borderRadius: 12, backgroundColor: p.surfaceLow },
    detailsSectionTitle: { ...type.labelLg, color: p.onSurface },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    title: { ...type.headlineSm, color: p.onSurface },
    subtitle: { ...type.bodySm, color: p.muted },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: p.surfaceContainer,
      borderRadius: 12,
      borderWidth: 1, borderColor: p.border,
      paddingLeft: 12,
      marginHorizontal: 20,
    },
    searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 12, fontFamily: F.sans, fontSize: 14, color: p.onSurface },
    chipRow: { ...shelfStyles.chipRow },
    sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    sortGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    sortOptions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
    sortActive: { color: p.primary },
    sortNote: { ...type.bodySm, color: p.muted, marginTop: 0 },
    countRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    count: { ...type.labelSm, color: p.muted, flex: 1 },
    resultsContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 12 },
    resultsList: { gap: 12 },
    gridColumn: { gap: 16 },

    row: {
      flexDirection: 'row',
      gap: 10,
      padding: 10,
      borderRadius: 12,
      backgroundColor: p.surfaceLow,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.borderSoft,
    },
    gridCard: { flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
    shelfTitle: { ...shelfStyles.title, color: p.onSurface },
    shelfAuthor: { ...shelfStyles.author, color: p.muted },
    shelfAction: { backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, minWidth: 48, minHeight: 48 },
    shelfActionText: { fontSize: 12, lineHeight: 18 },
    rowTitle: { fontFamily: F.serifSemi, fontSize: 17, lineHeight: 21, color: p.onSurface },
    rowAuthor: { ...type.bodyMd, color: p.onSurfaceVariant, marginTop: 2 },
    rowMeta: { ...type.bodySm, color: p.muted, marginTop: 2 },
    rowError: { ...type.bodySm, color: p.onSurface, marginTop: 8 },
    smallAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    notice: { padding: 12, marginHorizontal: 20, borderRadius: 12, backgroundColor: p.surfaceContainer },
    noticeText: { ...type.bodySm, color: p.onSurface },
    rowAction: { flexDirection: 'row', marginTop: 8 },
    downloadProgress: { gap: 5, marginTop: 7 },

    btn: {
      minHeight: 48,
      justifyContent: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
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
