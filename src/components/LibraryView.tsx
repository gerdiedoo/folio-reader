import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { browseLibrary, continueReadingBook, hasReadingHistory, libraryBookStatus, displayedBookProgress, type LibraryFilter, type LibrarySort } from '../lib/libraryBrowser';
import { coverImageUrl, normalizeCoverTint, type BookCoverDraft, type CoverSaveResult } from '../lib/bookCover';
import type { BookRemovalResult } from '../lib/bookRemoval';
import { parseEpubFile } from '../lib/epubParser';
import type { LocalStore } from '../lib/localStore';
import { colors, F, NAV_SPACE, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { Book, BookContentPage, ReadingGoal } from '../types';
import { LibraryRecoveryBook } from '../lib/catalog';
import { BookCover, CLOTH, ClothTint } from './BookCover';
import { BrowseBooksScreen } from './BrowseBooksScreen';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';
import { ProgressBar } from './ui/ProgressBar';

interface LibraryViewProps {
  storage: LocalStore;
  hasLegacyData: boolean;
  books: Book[];
  availableBookIds: readonly string[];
  libraryStatus: 'loading' | 'ready' | 'error';
  recoveryBooks: LibraryRecoveryBook[];
  selectedBookId: string | null;
  readingGoal: ReadingGoal;
  globalCoverStyle: 'image' | 'typographic';
  onOpenBook: (bookId: string) => void;
  onSelectBook: (bookId: string | null) => void;
  onAddEpubBook: (book: Book, pages: BookContentPage[]) => Promise<void>;
  onRestoreImportedProgress: (book: Book) => Promise<Book>;
  onReimportRecoveryBook: (
    recovery: LibraryRecoveryBook,
    book: Book,
    pages: BookContentPage[]
  ) => Promise<void>;
  onUpdateBookCover: (bookId: string, draft: BookCoverDraft) => Promise<CoverSaveResult>;
  onRemoveBook: (bookId: string) => Promise<BookRemovalResult>;
  showToast: (msg: string) => void;
  bottomInset: number;
}

type Filter = LibraryFilter;
type Sort = LibrarySort;
type LibraryViewMode = 'grid' | 'list';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Books' },
  { id: 'reading', label: 'Reading' },
  { id: 'finished', label: 'Finished' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'want', label: 'Want to Read' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'title', label: 'Title' },
  { id: 'progress', label: 'Progress' },
];

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return 'Unavailable';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLastRead(value: string): string {
  if (!value || /^uploaded\b/i.test(value)) return 'Not yet read';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || 'Not yet read' : date.toLocaleString();
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  storage,
  hasLegacyData,
  books,
  availableBookIds,
  libraryStatus,
  recoveryBooks,
  selectedBookId,
  readingGoal,
  globalCoverStyle,
  onOpenBook,
  onSelectBook,
  onAddEpubBook,
  onRestoreImportedProgress,
  onReimportRecoveryBook,
  onUpdateBookCover,
  onRemoveBook,
  showToast,
  bottomInset,
}) => {
  const { width, fontScale } = useWindowDimensions();
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [browseViewMode, setBrowseViewMode] = useState<LibraryViewMode>('grid');
  const [importing, setImporting] = useState(false);
  const [reimportingId, setReimportingId] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const selectedBook = books.find((book) => book.id === selectedBookId) ?? null;

  useEffect(() => {
    if (!selectedBook) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onSelectBook(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedBook, onSelectBook]);

  const contentWidth = Math.max(160, Math.min(width, 768) - 40);
  const columns = fontScale > 1.3 || contentWidth < 300 ? 1 : 2;
  const cardWidth = Math.floor((contentWidth - (columns - 1) * 16) / columns);
  const available = useMemo(() => new Set(availableBookIds), [availableBookIds]);
  const featured = libraryStatus === 'ready' ? continueReadingBook(books, available) : undefined;
  const results = useMemo(() => browseLibrary(books, recoveryBooks, query, filter, sort, available), [books, recoveryBooks, query, filter, sort, available]);
  const visible = results.books;
  const visibleRecoveryBooks = results.recovery;
  const filtered = Boolean(query.trim()) || filter !== 'all';
  const resetFilters = () => { setQuery(''); setFilter('all'); };
  const textStatus = (id: string) => libraryStatus === 'loading' ? 'Checking saved text.' : libraryStatus === 'error' ? 'Saved text could not be checked.' : available.has(id) ? 'Text saved on this device.' : 'EPUB needed on this device.';
  const canImport = libraryStatus === 'ready' && !importing && !reimportingId;
  const readingTime = readingGoal.minutesReadToday;
  const readingTimeLabel =
    readingTime >= 60
      ? `${Math.floor(readingTime / 60)}h ${readingTime % 60}m`
      : `${readingTime} min`;

  const handleImport = async () => {
    if (!canImport) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (!/\.epub$/i.test(asset.name)) {
        showToast('Please choose an .epub file');
        return;
      }
      setImporting(true);
      const { book, pages } = await parseEpubFile(asset.uri, asset.name, storage);
      const bookWithProgress = await onRestoreImportedProgress(book);
      await onAddEpubBook(bookWithProgress, pages);
    } catch (err: unknown) {
      console.warn('EPUB import failed:', err);
      showToast(err instanceof Error ? err.message : 'Failed to read EPUB file');
    } finally {
      setImporting(false);
    }
  };

  const handleReimportRecovery = async (recovery: LibraryRecoveryBook) => {
    if (!canImport) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (!/\.epub$/i.test(asset.name)) {
        showToast('Please choose an .epub file');
        return;
      }
      setReimportingId(recovery.id);
      const { book, pages } = await parseEpubFile(asset.uri, asset.name, storage);
      await onReimportRecoveryBook(recovery, book, pages);
    } catch (err: unknown) {
      console.warn(`EPUB re-import failed for "${recovery.title}":`, err);
      showToast(err instanceof Error ? err.message : 'Failed to re-import EPUB');
    } finally {
      setReimportingId(null);
    }
  };

  if (selectedBook) {
    const status = libraryBookStatus(selectedBook);
    const canRead = libraryStatus === 'ready' && available.has(selectedBook.id);
    const genres = selectedBook.genres?.filter(Boolean) ?? [];

    return (
      <ScrollView
        style={styles.detailsPage}
        contentContainerStyle={[styles.detailsPageContent, { paddingBottom: NAV_SPACE + bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailsHero}>
          <BookCover
            book={selectedBook}
            style={selectedBook.coverStyle || globalCoverStyle}
            containerStyle={styles.detailsPageCover}
            badge={
              selectedBook.isFinished
                ? { kind: 'read' }
                : hasReadingHistory(selectedBook)
                ? { kind: 'percent', value: displayedBookProgress(selectedBook) }
                : undefined
            }
          />
          <Text accessibilityRole="header" style={styles.detailsTitle}>{selectedBook.title}</Text>
          <Text style={styles.detailsAuthor}>{selectedBook.author}</Text>
          <View style={styles.detailsStatus}>
            <View style={[styles.detailsStatusDot, { backgroundColor: selectedBook.isFinished ? colors.tertiary : colors.primary }]} />
            <Text style={styles.detailsStatusText}>{status}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => {
            if (!canRead) return;
            const bookId = selectedBook.id;
            onSelectBook(null);
            onOpenBook(bookId);
          }}
          disabled={!canRead}
          accessibilityRole="button"
          accessibilityLabel={canRead ? `Read ${selectedBook.title}` : 'Reading text unavailable'}
          accessibilityState={{ disabled: !canRead }}
          style={[styles.detailsReadButton, !canRead && { opacity: 0.55 }]}
        >
          <Icon name="menu_book" size={19} color={colors.white} />
          <Text style={styles.detailsReadButtonText}>
            {!canRead ? (libraryStatus === 'loading' ? 'Checking saved text…' : 'Text unavailable on this device')
              : selectedBook.isFinished ? 'Open book'
              : hasReadingHistory(selectedBook)
              ? 'Continue reading'
              : 'Start reading'}
          </Text>
        </Pressable>

        {!canRead && <Text style={styles.emptyBody}>{libraryStatus === 'loading' ? 'Checking the saved reading files…'
          : libraryStatus === 'error' ? 'Your saved library could not be loaded. Restart Folio before making changes.'
          : 'The reading text is not saved on this device. Return to Library and import the EPUB to read it here.'}</Text>}

        <View style={styles.detailsPageSection}>
          <View style={styles.detailsSectionHeader}>
            <Text style={styles.detailsSectionTitle}>Reading progress</Text>
            <Text style={styles.detailsProgressPercent}>{`${displayedBookProgress(selectedBook)}%`}</Text>
          </View>
          <ProgressBar percent={displayedBookProgress(selectedBook)} height={8} />
          <Text style={styles.detailsProgressCaption}>
            Saved reading position: passage {selectedBook.currentPage} of {selectedBook.totalPages}
          </Text>
        </View>

        <View style={styles.detailsPageSection}>
          <Text style={styles.detailsSectionTitle}>Book details</Text>
          <View style={styles.detailsInfoList}>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Author</Text>
              <Text style={styles.detailsValue}>{selectedBook.author}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Genres</Text>
              <Text style={styles.detailsValue}>{genres.length ? genres.join(', ') : 'Not provided'}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Current chapter</Text>
              <Text style={styles.detailsValue} numberOfLines={2}>{selectedBook.currentChapter || 'Not started'}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Reading passages</Text>
              <Text style={styles.detailsValue}>{selectedBook.totalPages}</Text>
            </View>
            {selectedBook.totalLoc ? (
              <View style={styles.detailsInfoRow}>
                <Text style={styles.detailsLabel}>Reading locations</Text>
                <Text style={styles.detailsValue}>{selectedBook.currentLoc ?? 0} of {selectedBook.totalLoc}</Text>
              </View>
            ) : null}
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Time remaining</Text>
              <Text style={styles.detailsValue}>{selectedBook.minutesLeft} min</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Last read</Text>
              <Text style={styles.detailsValue}>{formatLastRead(selectedBook.lastOpened)}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Document language</Text>
              <Text style={styles.detailsValue}>{selectedBook.documentLanguage || 'Not provided'}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>File format</Text>
              <Text style={styles.detailsValue}>{selectedBook.fileFormat || 'Unknown'}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>File size</Text>
              <Text style={styles.detailsValue}>{formatFileSize(selectedBook.fileSizeBytes)}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>EPUB identifier</Text>
              <Text selectable style={styles.detailsValue}>{selectedBook.documentIdentifier || 'Not provided'}</Text>
            </View>
            <View style={styles.detailsInfoRow}>
              <Text style={styles.detailsLabel}>Folio file ID</Text>
              <Text selectable style={styles.detailsValue}>{selectedBook.id}</Text>
            </View>
            <View style={[styles.detailsInfoRow, styles.detailsInfoRowLast]}>
              <Text style={styles.detailsLabel}>Document file location</Text>
              <Text selectable numberOfLines={4} style={styles.detailsValue}>
                {selectedBook.fileLocation || 'Unavailable'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.detailsPageSection}>
          <Text style={styles.detailsSectionTitle}>Annotation / description</Text>
          <Text style={styles.detailsAnnotation}>
            {selectedBook.annotation || 'No annotation or description was included in this document.'}
          </Text>
        </View>

        <Pressable
          onPress={() => {
            setEditing(selectedBook);
            onSelectBook(null);
          }}
          disabled={libraryStatus !== 'ready'}
          accessibilityRole="button"
          accessibilityLabel={`Customize cover for ${selectedBook.title}`}
          accessibilityState={{ disabled: libraryStatus !== 'ready' }}
          style={styles.detailsCustomizeButton}
        >
          <Icon name="palette" size={18} color={colors.primary} />
          <Text style={styles.detailsCustomizeText}>Customize cover</Text>
        </Pressable>

      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: NAV_SPACE + bottomInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {libraryStatus !== 'ready' && (
        <View style={styles.statusCard}>
          <Text accessibilityRole={libraryStatus === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={styles.statusText}>
            {libraryStatus === 'loading' ? 'Loading your saved library and reading files…' : 'Your saved library could not be loaded. Existing data has been kept. Restart Folio before importing or changing books.'}
          </Text>
        </View>
      )}
      {/* Today's reading time */}
      {hasLegacyData && (
        <View style={{ padding: 16, gap: 8, borderRadius: 12, backgroundColor: colors.surfaceContainer }}>
          <Text style={{ ...type.bodyMd, color: colors.onSurface }}>Your older library is preserved on this device.</Text>
          <Text style={{ ...type.bodySm, color: colors.muted }}>It hasn't been assigned to this reading space. Accounts and Guest now keep separate books and notes. Keep Folio Dev installed while you review the migration guide.</Text>
        </View>
      )}

      <View style={styles.goalCard}>
        <View style={styles.readingTimeIcon}>
          <Icon name="schedule" size={25} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.goalTitle}>Today’s reading</Text>
          <Text style={styles.goalSub}>{readingTimeLabel} read today</Text>
        </View>
      </View>

      {/* Continue reading */}
      {libraryStatus === 'ready' && !filtered && (featured ? (
        <View>
          <Text accessibilityRole="header" style={styles.sectionLabel}>CONTINUE READING</Text>
          <Pressable onPress={() => onOpenBook(featured.id)} accessibilityRole="button" accessibilityLabel={`Resume ${featured.title} by ${featured.author}`} style={styles.featured}>
            <BookCover
              book={featured}
              style={featured.coverStyle || globalCoverStyle}
              size="compact"
              containerStyle={{ width: 92, aspectRatio: 2 / 3 }}
            />
            <View style={{ flex: 1, justifyContent: 'space-between' }}>
              <View>
                <Text style={styles.featTitle} numberOfLines={2}>
                  {featured.title}
                </Text>
                <Text style={styles.featAuthor}>{featured.author}</Text>
                <Text style={styles.featMeta} numberOfLines={1}>
                  {featured.currentChapter} · {featured.minutesLeft} min left
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <ProgressBar percent={displayedBookProgress(featured)} height={5} />
                <View style={styles.featFoot}>
                  <Text style={styles.featPct}>{displayedBookProgress(featured)}% complete</Text>
                  <View style={styles.continueBtn}>
                    <Text style={styles.continueText}>Continue</Text>
                    <Icon name="chevron_right" size={16} color="#fff" />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Icon name="local_library" size={36} color={colors.secondaryFixedDim} />
          <Text accessibilityRole="header" style={styles.emptyTitle}>{books.length || recoveryBooks.length ? 'Choose your next read' : 'Your library is empty'}</Text>
          <Text style={styles.emptyBody}>{books.length || recoveryBooks.length ? 'Open a book below to start reading, or re-import an EPUB whose text is missing.' : 'Browse free books or import an EPUB from your device to start reading.'}</Text>
        </View>
      ))}

      {/* Get books: browse the free catalog, or import a file */}
      <View style={styles.bookSourceActions}>
        <Pressable onPress={() => { if (libraryStatus === 'ready') setBrowseOpen(true); }} disabled={libraryStatus !== 'ready'} accessibilityRole="button" accessibilityLabel="Browse free books" accessibilityState={{ disabled: libraryStatus !== 'ready' }} style={styles.browseBtn}>
          <Icon name="explore" size={20} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.browseTitle}>Browse free books</Text>
            <Text style={styles.browseSub}>Explore classics</Text>
          </View>
          <Icon name="chevron_right" size={20} color="#fff" />
        </Pressable>
        <Pressable onPress={handleImport} disabled={!canImport} accessibilityRole="button" accessibilityLabel="Import EPUB" accessibilityState={{ disabled: !canImport, busy: importing }} style={[styles.importBtn, !canImport && { opacity: 0.7 }]}>
          <Icon name={importing ? 'sync' : 'upload_file'} size={20} color={colors.primary} spin={importing} />
          <Text style={styles.importText}>{importing ? 'Reading…' : 'Import EPUB'}</Text>
        </Pressable>
      </View>

      <View style={styles.librarySearch}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput value={query} onChangeText={value => setQuery(value.slice(0, 200))} maxLength={200}
          accessibilityLabel="Search Library by title or author" placeholder="Search titles or authors" placeholderTextColor={colors.muted}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.librarySearchInput} />
        {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear Library search" style={styles.smallAction}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>}
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </ScrollView>

      {/* Sort + cover style */}
      <View style={styles.toolRow}>
        <View style={styles.sortGroup}>
          <Icon name="sort" size={16} color={colors.muted} />
          {SORTS.map((s) => (
            <Pressable key={s.id} onPress={() => setSort(s.id)} accessibilityRole="button" accessibilityLabel={`Sort Library by ${s.label}`} accessibilityState={{ selected: sort === s.id }} style={styles.sortButton}>
              <Text style={[styles.sortText, sort === s.id && styles.sortActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.viewToggle}>
          {(['grid', 'list'] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => setViewMode(mode)}
              style={[styles.viewToggleButton, viewMode === mode && { backgroundColor: colors.surface }]}
              accessibilityRole="button"
              accessibilityLabel={`${mode === 'grid' ? 'Grid' : 'List'} view`}
              accessibilityState={{ selected: viewMode === mode }}
            >
              <Icon
                name={mode === 'grid' ? 'view_module' : 'view_list'}
                size={19}
                color={viewMode === mode ? colors.primary : colors.muted}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
        {libraryStatus === 'loading' ? 'Checking saved books…' : libraryStatus === 'error' ? 'Saved library unavailable' : `${visible.length} ${visible.length === 1 ? 'book' : 'books'}${visibleRecoveryBooks.length ? ` · ${visibleRecoveryBooks.length} need an EPUB` : ''}`}
      </Text>

      {/* Grid */}
      {visible.length === 0 && visibleRecoveryBooks.length === 0 ? (
        <View style={styles.noResults}>
          <Text style={styles.emptyBody}>{libraryStatus === 'loading' ? 'Checking saved books…' : libraryStatus === 'error' ? 'Library results are unavailable until loading succeeds.' : filtered ? 'No books match this search and filter. Try another title or author.' : 'No books to show yet.'}</Text>
          {filtered && (
            <Pressable
              onPress={resetFilters} accessibilityRole="button" accessibilityLabel="Clear Library search and filters" style={styles.smallAction}
            >
              <Text style={styles.reset}>Clear search and filters</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={viewMode === 'grid' ? styles.grid : styles.list}>
          {visible.map((b) => (
            <View key={b.id} style={viewMode === 'grid' ? { width: cardWidth } : { width: '100%' }}>
              <Pressable
                onPress={() => onSelectBook(b.id)}
                onLongPress={() => { if (libraryStatus === 'ready') setEditing(b); }}
                delayLongPress={400}
                accessibilityRole="button"
                accessibilityLabel={`${b.title} by ${b.author}. ${libraryBookStatus(b)}. ${textStatus(b.id)}`}
                accessibilityHint="Open book details"
                style={viewMode === 'grid' ? undefined : [styles.libraryListCard, { paddingRight: 60 }]}
              >
                <BookCover
                  book={b}
                  style={b.coverStyle || globalCoverStyle}
                  size={viewMode === 'list' ? 'compact' : 'regular'}
                  containerStyle={
                    viewMode === 'grid'
                      ? { width: '100%', aspectRatio: 2 / 3 }
                      : styles.libraryListCover
                  }
                  badge={
                    b.isFinished
                      ? { kind: 'read' }
                      : hasReadingHistory(b)
                      ? { kind: 'percent', value: displayedBookProgress(b) }
                      : undefined
                  }
                />
                <View style={viewMode === 'list' ? styles.libraryListCopy : undefined}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{b.title}</Text>
                  <Text style={styles.cardAuthor} numberOfLines={1}>{b.author}</Text>
                  {viewMode === 'list' ? (
                    <Text style={styles.listBookProgress}>
                      {libraryBookStatus(b)} · Position {b.currentPage} of {b.totalPages}
                    </Text>
                  ) : null}
                  {libraryStatus === 'ready' && !available.has(b.id) && <Text style={styles.listBookProgress}>EPUB needed on this device</Text>}
                </View>
              </Pressable>
              <Pressable onPress={() => { if (libraryStatus === 'ready') setEditing(b); }} disabled={libraryStatus !== 'ready'}
                accessibilityRole="button" accessibilityLabel={`Customize cover for ${b.title}`} accessibilityState={{ disabled: libraryStatus !== 'ready' }} style={styles.editBookAction}>
                <Icon name="palette" size={20} color={colors.primary} />
              </Pressable>
            </View>
          ))}
          {visibleRecoveryBooks.map((recovery) => {
            const isReimporting = reimportingId === recovery.id;
            return (
              <Pressable
                key={`recovery-${recovery.id}`}
                onPress={() => void handleReimportRecovery(recovery)}
                disabled={!canImport}
                style={[
                  viewMode === 'grid' ? { width: cardWidth } : styles.libraryListCard,
                  { opacity: reimportingId && !isReimporting ? 0.55 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canImport, busy: isReimporting }}
                accessibilityLabel={`Re-import ${recovery.title} from a local EPUB`}
              >
                <View style={viewMode === 'list' ? styles.libraryListCover : undefined}>
                  <BookCover
                    book={{
                      title: recovery.title,
                      author: recovery.author,
                      coverUrl: '',
                      coverAlt: `Typographic cover for ${recovery.title}`,
                    }}
                    style="typographic"
                    size={viewMode === 'list' ? 'compact' : 'regular'}
                    containerStyle={
                      viewMode === 'grid'
                        ? { width: '100%', aspectRatio: 2 / 3 }
                        : styles.libraryListCoverInner
                    }
                  />
                  {viewMode === 'grid' ? (
                    <View style={[styles.reimportBadge, { backgroundColor: colors.primaryContainer }]}>
                      <Icon
                        name={isReimporting ? 'sync' : 'upload_file'}
                        size={13}
                        color={colors.white}
                        spin={isReimporting}
                      />
                      <Text style={[styles.reimportBadgeText, { color: colors.white }]}>
                        {isReimporting ? 'Importing' : 'Re-import'}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={viewMode === 'list' ? styles.libraryListCopy : undefined}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{recovery.title}</Text>
                  <Text style={styles.cardAuthor} numberOfLines={1}>{recovery.author}</Text>
                  {viewMode === 'list' ? (
                    <>
                      <Text style={styles.listBookProgress}>Needs the original EPUB file</Text>
                      <View style={[styles.listRecoveryBadge, { backgroundColor: colors.primaryContainer }]}>
                        <Icon
                          name={isReimporting ? 'sync' : 'upload_file'}
                          size={13}
                          color={colors.white}
                          spin={isReimporting}
                        />
                        <Text style={[styles.reimportBadgeText, { color: colors.white }]}>
                          {isReimporting ? 'Importing' : 'Re-import'}
                        </Text>
                      </View>
                    </>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {browseOpen && (
        <BrowseBooksScreen
          storage={storage}
          books={books}
          viewMode={browseViewMode}
          onViewModeChange={setBrowseViewMode}
          onAddEpubBook={onAddEpubBook}
          onOpenBook={onOpenBook}
          showToast={showToast}
          onClose={() => setBrowseOpen(false)}
        />
      )}

      {editing && (
        <CoverEditor
          book={editing}
          globalStyle={globalCoverStyle}
          onClose={() => setEditing(null)}
          onSave={draft => onUpdateBookCover(editing.id, draft)}
          onRemove={() => onRemoveBook(editing.id)}
        />
      )}

    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Cover editor
// ---------------------------------------------------------------------------
export const CoverEditor: React.FC<{
  book: Book;
  globalStyle: 'image' | 'typographic';
  onClose: () => void;
  onSave: (draft: BookCoverDraft) => Promise<CoverSaveResult>;
  onRemove: () => Promise<BookRemovalResult>;
}> = ({ book, globalStyle, onClose, onSave, onRemove }) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [style, setStyle] = useState<'image' | 'typographic'>(book.coverStyle || globalStyle);
  const [url, setUrl] = useState(book.coverUrl?.startsWith('http') ? book.coverUrl : '');
  const [pickedUri, setPickedUri] = useState<string | undefined>(undefined);
  const [tint, setTint] = useState<ClothTint>(() => normalizeCoverTint(book.coverTint));
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const removalPending = useRef(false);
  const savePending = useRef(false);
  const photoPending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [choosingPhoto, setChoosingPhoto] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = removing || saving || choosingPhoto;
  const working = () => removalPending.current || savePending.current || photoPending.current;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!working()) onClose(); };
  const remove = async () => {
    if (!mounted.current || working()) return;
    removalPending.current = true; setRemoving(true); setRemovalError(null);
    try {
      const result = await onRemove();
      if (!mounted.current) return;
      if (result.removed) onClose();
      else setRemovalError(result.message);
    } catch { if (mounted.current) setRemovalError('Removal could not be confirmed. Check this book in Library before trying again.'); }
    finally { removalPending.current = false; if (mounted.current) setRemoving(false); }
  };

  // URL text is separate from the picked image draft; nothing is copied until Apply.
  const previewUri = pickedUri ?? (/^https?:\/\//i.test(url.trim()) ? url.trim() : book.coverUrl);
  const apply = async () => {
    if (!mounted.current || working()) return;
    setSaveError(null);
    let draft: BookCoverDraft;
    try {
      const image: BookCoverDraft['image'] = style !== 'image' ? { kind: 'keep' }
        : pickedUri ? { kind: 'photo', uri: pickedUri }
        : url.trim() ? { kind: 'url', url: coverImageUrl(url) } : { kind: 'keep' };
      draft = { style, tint, image };
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Enter a valid image URL.'); return; }
    savePending.current = true; setSaving(true);
    try {
      const result = await onSave(draft);
      if (!mounted.current) return;
      if (result.saved) onClose();
      else setSaveError(result.message);
    } catch { if (mounted.current) setSaveError('The cover change could not be confirmed. Your draft is still here; check the cover in Library before retrying.'); }
    finally { savePending.current = false; if (mounted.current) setSaving(false); }
  };

  const choosePhoto = async () => {
    if (!mounted.current || working()) return;
    photoPending.current = true; setChoosingPhoto(true); setSaveError(null);
    try {
      // Android's system picker grants access to the selected photo without broad gallery access.
      if (Platform.OS === 'ios') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!mounted.current) return;
        if (!perm.granted) { setSaveError('Photo access was not granted. You can paste an image URL instead.'); return; }
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [2, 3], quality: 0.8 });
      if (!mounted.current || res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri || !/^(?:file|content):\/\//i.test(uri)) { setSaveError('This photo could not be opened. Choose another image.'); return; }
      setPickedUri(uri); setUrl(''); setStyle('image');
    } catch { if (mounted.current) setSaveError('The photo picker could not be opened. Your current draft has been kept. Try again.'); }
    finally { photoPending.current = false; if (mounted.current) setChoosingPhoto(false); }
  };

  return (
    <ModalShell onClose={close} maxWidth={400} cardStyle={{ maxHeight: '88%' }}>
      <View style={styles.editHead}>
        <Text accessibilityRole="header" style={styles.editTitle}>{confirmingRemove ? 'Remove book?' : 'Customize Thumbnail'}</Text>
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Close book editor" accessibilityState={{ disabled: busy }} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      {confirmingRemove ? (
        <ScrollView contentContainerStyle={styles.removeConfirm}>
          <Icon name="delete_outline" size={32} color={colors.danger} />
          <Text style={styles.removeConfirmText}>
            Remove “{book.title}” and its saved files, bookmarks, highlights, notes and vocabulary from this Library.
          </Text>
          <Text style={styles.removeConfirmText}>
            Export any notes or cards you want to keep first. If signed in, Folio also attempts cloud cleanup;
            an unremoved cloud copy may return after reloading.
          </Text>
          <View style={styles.removeConfirmActions}>
            <Pressable onPress={() => { if (!working()) { setConfirmingRemove(false); setRemovalError(null); } }} disabled={busy} accessibilityRole="button" accessibilityLabel="Keep this book" accessibilityState={{ disabled: busy }} style={[styles.cancelRemoveBtn, removing && { opacity: 0.5 }]}>
              <Text style={styles.cancelRemoveText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={remove} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove ${book.title} from Library`} accessibilityState={{ disabled: busy, busy: removing }} style={styles.confirmRemoveBtn}>
              <Text style={styles.confirmRemoveText}>{removing ? 'Removing…' : 'Remove'}</Text>
            </Pressable>
          </View>
          {removalError && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.removeConfirmText}>{removalError}</Text>}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center' }}>
            <BookCover
              book={book}
              style={style}
              uriOverride={previewUri}
              tint={tint}
              size="compact"
              containerStyle={{ width: 110, aspectRatio: 2 / 3 }}
            />
          </View>

          <View style={styles.coverToggle}>
            {(['image', 'typographic'] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => { if (!working()) { setStyle(s); setSaveError(null); } }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${s === 'image' ? 'Illustrated' : 'Typographic'} cover`}
                accessibilityState={{ selected: style === s, disabled: busy }}
                style={[styles.toggleBtn, { flex: 1, minHeight: 48, flexDirection: 'row', gap: 6 }, style === s && { backgroundColor: colors.surface }]}
              >
                <Icon name={s === 'image' ? 'image' : 'title'} size={16} color={style === s ? colors.primary : colors.muted} />
                <Text style={[styles.sortText, { flexShrink: 1 }, style === s && styles.sortActive]}>
                  {s === 'image' ? 'Illustrated' : 'Typographic'}
                </Text>
              </Pressable>
            ))}
          </View>

          {style === 'image' ? (
            <View style={{ gap: 8 }}>
              <TextInput
                value={url}
                editable={!busy}
                accessibilityLabel="Cover image URL"
                onChangeText={(t) => {
                  if (working()) return;
                  setSaveError(null);
                  setUrl(t);
                  setPickedUri(undefined);
                }}
                placeholder="Paste an image URL (https://…)"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.urlInput}
              />
              <Text style={{ ...type.bodySm, color: colors.muted }}>{pickedUri ? 'The selected photo will be saved when you Apply.' : 'Leave blank to keep the current image. Remote image availability depends on its host.'}</Text>
              <Pressable onPress={choosePhoto} disabled={busy} accessibilityRole="button" accessibilityLabel="Choose cover from photos" accessibilityState={{ disabled: busy, busy: choosingPhoto }} style={styles.photoBtn}>
                <Icon name="upload" size={18} color={colors.primary} />
                <Text style={styles.photoText}>{choosingPhoto ? 'Choosing…' : 'Choose from photos'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.tintRow}>
              {(Object.keys(CLOTH) as ClothTint[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => { if (!working()) { setTint(t); setSaveError(null); } }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${t} cover color`}
                  accessibilityState={{ selected: tint === t, disabled: busy }}
                  style={[
                    styles.tint,
                    { backgroundColor: CLOTH[t].bg },
                    tint === t && { borderColor: colors.primary, borderWidth: 2 },
                  ]}
                />
              ))}
            </View>
          )}

          {saveError && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ ...type.bodySm, color: colors.onSurface }}>{saveError}</Text>}
          <Pressable onPress={apply} disabled={busy} accessibilityRole="button" accessibilityLabel="Apply book cover" accessibilityState={{ disabled: busy, busy: saving }} style={styles.saveBtn}>
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Apply'}</Text>
          </Pressable>
          <Pressable onPress={() => { if (!working()) { setRemovalError(null); setConfirmingRemove(true); } }} disabled={busy} accessibilityRole="button" accessibilityLabel="Remove book" accessibilityState={{ disabled: busy }} style={styles.removeBtn}>
            <Icon name="delete_outline" size={18} color={colors.danger} />
            <Text style={styles.removeText}>Remove Book</Text>
          </Pressable>
        </ScrollView>
      )}
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  scroll: { paddingTop: 4, gap: 18 },
  statusCard: { padding: 16, borderRadius: 12, backgroundColor: colors.surfaceContainer },
  statusText: { ...type.bodyMd, color: colors.onSurface },
  librarySearch: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceContainer, borderRadius: 12, paddingLeft: 12 },
  librarySearchInput: { ...type.bodyMd, flex: 1, color: colors.onSurface, minHeight: 48, paddingVertical: 10 },
  smallAction: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  resultCount: { ...type.bodySm, color: colors.muted },
  editBookAction: { position: 'absolute', right: 6, top: 6, minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  readingTimeIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: colors.primaryFixed,
  },
  goalTitle: { ...type.headlineSm, fontSize: 19, lineHeight: 24, color: colors.onSurface },
  goalSub: { ...type.bodySm, color: colors.muted, marginTop: 2 },
  sectionLabel: { ...type.labelSm, color: colors.muted, marginBottom: 8, letterSpacing: 1 },
  featured: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  featTitle: { ...type.headlineSm, fontSize: 20, lineHeight: 25, color: colors.onSurface },
  featAuthor: { ...type.bodyMd, color: colors.muted, marginTop: 2 },
  featMeta: { ...type.bodySm, color: colors.muted, marginTop: 6 },
  featFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  featPct: { ...type.labelSm, color: colors.primary },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryContainer,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
  },
  continueText: { ...type.labelMd, color: '#fff' },

  emptyCard: {
    alignItems: 'center',
    gap: 6,
    padding: 28,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  emptyTitle: { ...type.headlineSm, fontSize: 20, color: colors.onSurface },
  emptyBody: { ...type.bodyMd, color: colors.muted, textAlign: 'center' },

  browseBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryContainer,
  },
  browseTitle: { ...type.labelMd, color: '#fff' },
  browseSub: { ...type.bodySm, color: 'rgba(255,255,255,0.8)', marginTop: 1, fontSize: 11 },
  bookSourceActions: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(137,52,20,0.4)',
    backgroundColor: colors.primaryFixed,
  },
  importText: { ...type.labelMd, color: colors.primary, flexShrink: 1, textAlign: 'center' },
  reimportBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  reimportBadgeText: { ...type.labelSm },
  detailsPage: { flex: 1, backgroundColor: colors.surface },
  detailsPageContent: { width: '100%', maxWidth: 768, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  detailsHero: { alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 8 },
  detailsPageCover: { width: 176, aspectRatio: 2 / 3, marginBottom: 8 },
  detailsTitle: { ...type.headlineSm, fontSize: 26, lineHeight: 33, textAlign: 'center', color: colors.onSurface },
  detailsAuthor: { ...type.bodyMd, textAlign: 'center', color: colors.muted },
  detailsStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceContainer,
    marginTop: 2,
  },
  detailsStatusDot: { width: 7, height: 7, borderRadius: 4 },
  detailsStatusText: { ...type.labelSm, color: colors.onSurfaceVariant },
  detailsPageSection: {
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  detailsSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsSectionTitle: { ...type.labelLg, color: colors.onSurface },
  detailsProgressPercent: { ...type.labelLg, color: colors.primary },
  detailsProgressCaption: { ...type.bodySm, color: colors.muted },
  detailsInfoList: { gap: 0 },
  detailsInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  detailsInfoRowLast: { borderBottomWidth: 0 },
  detailsLabel: { ...type.bodySm, color: colors.muted },
  detailsValue: { ...type.labelMd, color: colors.onSurface, flexShrink: 1, textAlign: 'right' },
  detailsAnnotation: { ...type.bodyMd, color: colors.onSurfaceVariant, lineHeight: 23 },
  detailsCustomizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
  },
  detailsCustomizeText: { ...type.labelMd, color: colors.primary },
  detailsReadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.primaryContainer,
  },
  detailsReadButtonText: { ...type.labelLg, color: colors.white },

  chipRow: { gap: 8, paddingRight: 8 },
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainer,
    padding: 3,
    borderRadius: 10,
    gap: 2,
  },
  viewToggleButton: {
    width: 48,
    height: 48,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, flexShrink: 1 },
  sortButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' },
  sortText: { ...type.labelMd, color: colors.muted },
  sortActive: { color: colors.primary },
  coverToggle: { flexDirection: 'row', backgroundColor: colors.surfaceContainer, padding: 3, borderRadius: 10, gap: 2 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, rowGap: 22 },
  list: { gap: 12 },
  libraryListCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  libraryListCover: {
    width: 64,
    aspectRatio: 2 / 3,
    flexShrink: 0,
    overflow: 'hidden',
  },
  libraryListCoverInner: {
    width: '100%',
    height: '100%',
    flexShrink: 0,
  },
  libraryListCopy: { flex: 1, minWidth: 0 },
  listBookProgress: { ...type.bodySm, color: colors.muted, marginTop: 5 },
  listRecoveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 7,
  },
  cardTitle: { ...type.headlineSm, fontSize: 16, lineHeight: 20, color: colors.onSurface, marginTop: 8 },
  cardAuthor: { ...type.bodySm, color: colors.muted, marginTop: 2 },
  noResults: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  reset: { ...type.labelMd, color: colors.primary },

  editHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
  },
  editTitle: { ...type.headlineSm, fontSize: 19, color: colors.onSurface, flex: 1, flexShrink: 1 },
  urlInput: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: F.sans,
    fontSize: 13,
    color: colors.onSurface,
  },
  photoBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainer,
  },
  photoText: { ...type.labelMd, color: colors.primary },
  tintRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  tint: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  saveBtn: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.primaryContainer, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveText: { ...type.labelLg, color: '#fff' },
  removeBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
  },
  removeText: { ...type.labelMd, color: colors.danger },
  removeConfirm: { padding: 20, gap: 14, alignItems: 'center' },
  removeConfirmText: { ...type.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center' },
  removeConfirmActions: { flexDirection: 'row', alignSelf: 'stretch', gap: 10, marginTop: 4 },
  cancelRemoveBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
  },
  cancelRemoveText: { ...type.labelLg, color: colors.onSurface },
  confirmRemoveBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.danger,
  },
  confirmRemoveText: { ...type.labelLg, color: '#fff' },
});