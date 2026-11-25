import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
  EBGaramond_500Medium,
  EBGaramond_600SemiBold,
} from '@expo-google-fonts/eb-garamond';
import { Literata_400Regular, Literata_600SemiBold } from '@expo-google-fonts/literata';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from './src/components/BottomNav';
import { DictionaryModal } from './src/components/DictionaryModal';
import { createRetryableWriter } from './src/lib/retryableCreate';
import { BookmarkSheet } from './src/components/BookmarkSheet';
import { FlashcardModal } from './src/components/FlashcardModal';
import { Header, HEADER_HEIGHT } from './src/components/Header';
import { LibraryView } from './src/components/LibraryView';
import { NotebookView } from './src/components/NotebookView';
import { ProfileModal } from './src/components/ProfileModal';
import { JumpTarget, ReaderView } from './src/components/ReaderView';
import { SearchModal } from './src/components/SearchModal';
import { createBookPageCache } from './src/lib/bookPageCache';
import { createLibraryStore, readingFields } from './src/lib/libraryStore';
import { canOpenSavedPassage } from './src/lib/archiveSearch';
import { SyncReviewModal } from './src/components/SyncReviewModal';
import { SettingsSheet } from './src/components/SettingsSheet';
import { Toast } from './src/components/ui/Toast';
import { INITIAL_BOOKS, INITIAL_GOAL } from './src/data/initialData';
import { saveBookCover, type BookCoverDraft, type CoverSaveResult } from './src/lib/bookCover';
import { type BookRemovalResult } from './src/lib/bookRemoval';
import { applyReadingPosition, createReadingProgressWriter } from './src/lib/readingPosition';
import { backupBookKey, backupProgressNotice, hasBackupReadingProgress, libraryBackupEntry, matchingLibraryBackupEntry, restoreLibraryProgress } from './src/lib/libraryBackup';
import { hasPendingRestore, recoverPortableRestore, removeBookWithRecovery } from './src/lib/backupRecovery';
import { choosePortableBackup, exportPortableBackup, importPortableBackup } from './src/lib/portableBackupNative';
import type { PreparedBackup } from './src/lib/portableBackup';
import { useReaderSettings } from './src/lib/useReaderSettings';
import { createBookmark, createBookmarkStore, findBookmarkPage } from './src/lib/bookmarks';
import { watchAccountSession } from './src/lib/accountSession';
import { createLocalStore } from './src/lib/localStore';
import { createReplicatedStore } from './src/lib/replicatedStore';
import { createSyncAccountRepository } from './src/lib/syncAccount';
import { useAccountSync } from './src/lib/useAccountSync';
import { randomUUID } from 'expo-crypto';
import { createImportCommitter, ImportStorageError, waitForImportCommits } from './src/lib/bookImport';
import { beginOriginalImport, recoverOriginalImport, hasPendingOriginalImport, IMPORT_JOURNAL } from './src/lib/importRecovery';
import { parseEpubFile as parseEpubForStore } from './src/lib/epubParser';
import {
  CatalogBook,
  deleteDownloaded,
  downloadEpub,
  findCatalogBook,
  getCatalogBook,
  loadAdded as loadAddedForStore,
  LibraryRestoreFailure,
  LibraryRestoreProgress,
  LibraryRestoreResult,
  LibraryRecoveryBook,
  rememberAdded as rememberAddedForStore,
  LibraryBackupEntry,
} from './src/lib/catalog';
import { handleAuthCallback, signInWithGoogle, signOutSupabase, supabase, toUserProfile, SUPABASE_URL } from './src/lib/supabase';
import * as Linking from 'expo-linking';
import { watchNativeAuth } from './src/lib/nativeAuth';
import { colors, NAV_SPACE } from './src/theme';
import { AppThemeProvider, createPalette } from './src/AppTheme';
import { MotionPreferencesProvider } from './src/MotionPreferences';
import { useFeedbackMessage } from './src/lib/useFeedbackMessage';
import { useHighlightArchive } from './src/lib/useHighlightArchive';
import { useLexiconArchive } from './src/lib/useLexiconArchive';
import { resolveSourceAnchor } from './src/lib/sourceAnchors';
import {
  Book,
  BookContentPage,
  Bookmark,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
  ReadingPosition,
  TabType,
  UserProfile,
  SourceAnchor,
} from './src/types';

function getLocalDateKey(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

type PortableJob = { kind: 'export'; includeOriginals: boolean } | { kind: 'restore'; backup: PreparedBackup; preferences: boolean; recoverMatching?: boolean } | { kind: 'remove'; bookId: string };
interface ReadingSpaceProps { user: UserProfile | null; scope: string; hasLegacyData: boolean; authError?: string; onClearAuthError?: () => void }
function FolioApp({ user, scope, hasLegacyData, authError, onClearAuthError, onPortableJob, onRemovalJob }: ReadingSpaceProps & { onPortableJob: (job: PortableJob) => void; onRemovalJob: (bookId: string) => Promise<BookRemovalResult> }) {
  const storage = useMemo(() => createReplicatedStore(createLocalStore(scope), randomUUID, Boolean(user)), [scope]);
  const { loadJSON, removeBookFiles, saveJSON, savePages } = storage;
  const pageCache = useMemo(() => createBookPageCache(storage.loadPages, 2), [storage]);
  const libraryStore = useMemo(() => createLibraryStore(storage), [storage]);
  const cloud = useMemo(() => createSyncAccountRepository(supabase, user?.id ?? null, storage), [user?.id, storage]);
  const { fetchBooksFromSupabase, fetchReadingGoalFromSupabase, fetchLibraryBackup, saveLibraryBackup, upsertBookToSupabase, upsertReadingGoalToSupabase } = cloud;
  const { message: toastMessage, showMessage: showToast } = useFeedbackMessage();
  const highlightArchive = useHighlightArchive(storage, cloud, showToast);
  const highlights = highlightArchive.items;
  const lexiconArchive = useLexiconArchive(storage, cloud, showToast);
  const lexicon = lexiconArchive.items;
  const readerSettings = useReaderSettings(storage, cloud, showToast);
  const settings = readerSettings.settings;
  const bookmarkStore = useMemo(() => createBookmarkStore({
    getItem: async () => { const value = await storage.loadJSONEntryStrict('bookmarks'); return value.present ? JSON.stringify(value.value) : null; },
    setItem: async (_key, value) => storage.saveJSONStrict('bookmarks', JSON.parse(value)),
  }, storage.storageKey('bookmarks')), [storage]);
  const parseEpubFile = (uri: string, name: string) => parseEpubForStore(uri, name, storage);
  const loadAdded = () => loadAddedForStore(storage);
  const rememberAdded = (current: Record<string, string>, id: string, bookId: string) => rememberAddedForStore(current, id, bookId, storage);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabType>('library');
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const booksRef = useRef(books);
  booksRef.current = books;
  const spaceActive = useRef(true);
  useEffect(() => { spaceActive.current = true; return () => { spaceActive.current = false; }; }, []);
  useEffect(() => storage.subscribeArchive('libraryArchive', () => {
    void libraryStore.load().then(snapshot => {
      if (!spaceActive.current) return;
      removedLibraryIds.current = new Set(snapshot.removedBookIds);
      booksRef.current = snapshot.books; setBooks(snapshot.books);
    }).catch(() => undefined);
  }), [storage, libraryStore]);
  const saveReadingProgress = useMemo(() => createReadingProgressWriter(
    async (_books, changed) => { if (!changed) throw new Error('Missing reading position'); await libraryStore.patch(changed.id, readingFields(changed)); }, upsertBookToSupabase,
    () => { if (spaceActive.current) showToast('Couldn’t save your reading position on this device. Keep the book open and try again.'); },
  ), [libraryStore, upsertBookToSupabase, showToast]);
  const libraryLoadState = useRef<'loading' | 'ready' | 'error'>('loading');
  const removedLibraryIds = useRef(new Set<string>());
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const importCommitterRef = useRef<ReturnType<typeof createImportCommitter> | null>(null);
  if (!importCommitterRef.current) {
    importCommitterRef.current = createImportCommitter({
      commitKey: storage.storageKey(IMPORT_JOURNAL),
      assertReady: async () => {
        if (!spaceActive.current || libraryLoadState.current !== 'ready') throw new ImportStorageError('This reading space is not ready for import. Reopen it and try again.');
        if (await hasPendingOriginalImport(storage)) throw new ImportStorageError('An earlier import needs recovery. Reopen this reading space before importing another book.');
      },
      savePages,
      removeFiles: removeBookFiles,
      beginImport: book => beginOriginalImport(storage, book),
      clearImport: () => storage.saveJSONStrict(IMPORT_JOURNAL, null),
      saveLibraryEntry: async (book) => {
        if (!spaceActive.current) throw new ImportStorageError('Import stopped after the reading space changed. Retry in the original space.');
        if (libraryLoadState.current !== 'ready') {
          throw new ImportStorageError(libraryLoadState.current === 'loading'
            ? 'Your library is still loading. Try importing again in a moment.'
            : 'Your saved library could not be loaded. Restart the app before importing more books.');
        }
        await libraryStore.add(book);
        // Update the ref immediately so consecutive imports cannot use an old render.
        booksRef.current = [book, ...booksRef.current.filter(item => item.id !== book.id)];
        setBooks(previous => [book, ...previous.filter(item => item.id !== book.id)]);
      },
    });
  }
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [bookDetailsId, setBookDetailsId] = useState<string | null>(null);
  const removingBook = useRef(false);
  const savingCover = useRef(false);
  const [availableBookIds, setAvailableBookIds] = useState<string[]>([]);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const [readingLoadError, setReadingLoadError] = useState<string | null>(null);
  const navigationGeneration = useRef(0);
  const [customPagesMap, setCustomPagesMap] = useState<Record<string, BookContentPage[]>>({});
  const [readingGoal, setReadingGoal] = useState<ReadingGoal>(INITIAL_GOAL);
  const [recoveryBooks, setRecoveryBooks] = useState<LibraryRecoveryBook[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);

  useEffect(() => {
    if (activeTab !== 'reading') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveTab('library');
      return true;
    });
    return () => subscription.remove();
  }, [activeTab]);

  // Navigation visibility (auto-hides while reading & scrolling)
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [isImmersiveMode, setIsImmersiveMode] = useState(false);
  useEffect(() => {
    if (activeTab !== 'reading') {
      setIsNavVisible(true);
      setIsImmersiveMode(false);
    }
  }, [activeTab]);

  // Modal / overlay state
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkStatus, setBookmarkStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const bookmarkWritePending = useRef(false);
  const loadBookmarks = useCallback(async () => {
    setBookmarkStatus('loading');
    try {
      setBookmarks(await bookmarkStore.load());
      setBookmarkStatus('ready');
    } catch {
      setBookmarkStatus('error');
    }
  }, [bookmarkStore]);
  useEffect(() => { void loadBookmarks(); }, [loadBookmarks]);
  useEffect(() => storage.subscribeArchive('bookmarks', () => { void loadBookmarks(); }), [storage, loadBookmarks]);
  const [isSettingsSheetOpen, setIsSettingsSheetOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [librarySearchRequest, setLibrarySearchRequest] = useState(0);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  useEffect(() => { if (authError) setIsProfileOpen(true); }, [authError]);
  const [libraryBookmarksOpen, setLibraryBookmarksOpen] = useState(false);
  const [syncReviewOpen, setSyncReviewOpen] = useState(false);
  const [dictionaryState, setDictionaryState] = useState<{ isOpen: boolean; word: string; context?: string; bookId?: string; source?: { page: number; chapter: string; anchor?: SourceAnchor } }>({
    isOpen: false,
    word: '',
  });
  const [flashcardItem, setFlashcardItem] = useState<LexiconEntry | null>(null);

  // Reading progress
  const readingGoalRef = useRef(readingGoal);
  readingGoalRef.current = readingGoal;
  const readingDayKeyRef = useRef('');
  const readingSecondsRef = useRef(0);
  const reportedReadingMinutesRef = useRef(0);
  const lastReadingTickRef = useRef<number | null>(null);
  const handleToggleNavVisibility = useCallback(() => {
    setIsNavVisible((prev) => !prev);
    setIsImmersiveMode((prev) => !prev);
  }, []);
  const setReaderNavVisibility = useCallback(
    (visible: boolean) => {
      if (visible && isImmersiveMode) return;
      setIsNavVisible(visible);
    },
    [isImmersiveMode]
  );

  // ---- Local-first hydration, then Supabase merge, then auth listener ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [lBooks, lGoal, lReadingDay, lRecoveryBooks] = await Promise.all([
        libraryStore.load().then(snapshot => { if (!cancelled) removedLibraryIds.current = new Set(snapshot.removedBookIds); return snapshot.books; }).catch(error => {
          libraryLoadState.current = 'error';
          if (!cancelled) setLibraryStatus('error');
          console.warn('Could not load the library index:', error);
          showToast("Couldn't load your saved library. Restart before importing more books.");
          return null;
        }),
        loadJSON<ReadingGoal>('goal'),
        loadJSON<string>('readingDay'),
        loadJSON<LibraryRecoveryBook[]>('libraryRecoveryBooks'),
      ]);
      if (cancelled) return;

      if (lBooks?.length) { booksRef.current = lBooks; setBooks(lBooks); }
      if (lGoal) setReadingGoal(lGoal);
      if (lRecoveryBooks) setRecoveryBooks(lRecoveryBooks);

      // Presence metadata is cheap; parse only the book the reader actually opens.
      try {
        const present = new Set(storage.listAvailableBookIds());
        if (cancelled) return;
        setAvailableBookIds([...present]);
      } catch {
        if (cancelled) return;
        showToast('Saved reading files could not be checked. Reopen this reading space to try again.');
      }
      if (libraryLoadState.current !== 'error') { libraryLoadState.current = 'ready'; setLibraryStatus('ready'); }
      if (lBooks?.length) setCurrentBookId(lBooks[0].id);

      // Remote data (cloud wins for items it has, local-only items are kept)
      let mergedGoal = lGoal ?? INITIAL_GOAL;
      try {
        const [sbBooks, sbGoal] = await Promise.all([
          fetchBooksFromSupabase(),
          fetchReadingGoalFromSupabase(),
        ]);
        if (cancelled) return;

        if (sbBooks?.length && libraryLoadState.current === 'ready') {
          const snapshot = await libraryStore.mergeRemote(sbBooks);
          if (cancelled) return;
          const incoming = snapshot.books;
          setBooks(previous => {
            const map = new Map(previous.map(book => [book.id, book]));
            incoming.forEach(book => { if (!removedLibraryIds.current.has(book.id) && !map.has(book.id)) map.set(book.id, book); });
            return Array.from(map.values()).filter(book => !removedLibraryIds.current.has(book.id));
          });
          if (snapshot.skipped) showToast('Some cloud book records could not be read. Device copies have been kept.');
        }
        if (sbGoal) {
          mergedGoal = sbGoal;
          setReadingGoal(sbGoal);
        }
      } catch (err) {
        console.warn('Initial Supabase fetch note:', err);
      }

      if (!cancelled) {
        const todayKey = getLocalDateKey();
        readingDayKeyRef.current = todayKey;
        await saveJSON('readingDay', todayKey);
        if (lReadingDay !== todayKey) {
          const resetGoal = { ...mergedGoal, minutesReadToday: 0 };
          readingGoalRef.current = resetGoal;
          setReadingGoal(resetGoal);
          void upsertReadingGoalToSupabase(resetGoal);
        }
        setHydrated(true);
      }
    })();

    return () => { cancelled = true; };

  }, [showToast]);

  // ---- Persist local copies (only after hydration so we never clobber saved data) ----
  useEffect(() => {
    if (hydrated) saveJSON('goal', readingGoal);
  }, [readingGoal, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON('libraryRecoveryBooks', recoveryBooks);
  }, [recoveryBooks, hydrated]);

  // Count only foreground time while the reader is visible; persist each full minute.
  useEffect(() => {
    if (!hydrated) return;

    const tick = () => {
      const readerVisible =
        activeTab === 'reading' &&
        !!currentBookId &&
        !!customPagesMap[currentBookId]?.length &&
        !isProfileOpen &&
        !isSearchOpen &&
        !isSettingsSheetOpen &&
        !dictionaryState.isOpen &&
        !flashcardItem;
      if (AppState.currentState !== 'active' || !readerVisible) {
        lastReadingTickRef.current = null;
        return;
      }

      const now = Date.now();
      const todayKey = getLocalDateKey();
      if (readingDayKeyRef.current !== todayKey) {
        readingDayKeyRef.current = todayKey;
        readingSecondsRef.current = 0;
        reportedReadingMinutesRef.current = 0;
        void saveJSON('readingDay', todayKey);
        const resetGoal = { ...readingGoalRef.current, minutesReadToday: 0 };
        readingGoalRef.current = resetGoal;
        setReadingGoal(resetGoal);
        void upsertReadingGoalToSupabase(resetGoal);
        lastReadingTickRef.current = now;
        return;
      }

      if (lastReadingTickRef.current === null) {
        lastReadingTickRef.current = now;
        return;
      }

      readingSecondsRef.current += Math.max(0, now - lastReadingTickRef.current) / 1000;
      lastReadingTickRef.current = now;
      const totalMinutes = Math.floor(readingSecondsRef.current / 60);
      const newlyReadMinutes = totalMinutes - reportedReadingMinutesRef.current;
      if (newlyReadMinutes <= 0) return;

      reportedReadingMinutesRef.current = totalMinutes;
      const updatedGoal = {
        ...readingGoalRef.current,
        minutesReadToday: readingGoalRef.current.minutesReadToday + newlyReadMinutes,
      };
      readingGoalRef.current = updatedGoal;
      setReadingGoal(updatedGoal);
      void upsertReadingGoalToSupabase(updatedGoal);
    };

    tick();
    const interval = setInterval(tick, 10_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        lastReadingTickRef.current = null;
      } else {
        tick();
      }
    });

    return () => {
      tick();
      clearInterval(interval);
      appStateSubscription.remove();
      lastReadingTickRef.current = null;
    };
  }, [
    activeTab,
    currentBookId,
    customPagesMap,
    dictionaryState.isOpen,
    flashcardItem,
    hydrated,
    isProfileOpen,
    isSearchOpen,
    isSettingsSheetOpen,
  ]);

  // ---- Auth ----
  const handleGoogleSignIn = async () => {
    onClearAuthError?.();
    await signInWithGoogle();
  };
  const handleSignOut = async () => {
    await signOutSupabase();
  };

  const handleBackupLibrary = async (): Promise<number> => {
    if (!user) throw new Error('Sign in to back up your library.');
    if (!spaceActive.current || libraryLoadState.current !== 'ready') throw new Error('Wait for the saved library to load before backing it up.');
    const catalogBooks = await loadAdded();
    if (!spaceActive.current) throw new Error('Backup stopped after the reading space changed.');
    if (!booksRef.current.length) throw new Error('Add or restore a book before backing up an empty library.');
    const backup: LibraryBackupEntry[] = booksRef.current.map((book) => {
      const catalogId = Object.entries(catalogBooks).find(([, bookId]) => bookId === book.id)?.[0];
      const gutenbergId = catalogId?.match(/^gutenberg-(\d+)$/)?.[1];
      return libraryBackupEntry(book, gutenbergId ? Number(gutenbergId) : undefined);
    });
    await saveLibraryBackup(user.id, backup);
    return backup.length;
  };

  const handleRestoreImportedProgress = async (book: Book, pages: BookContentPage[]): Promise<Book> => {
    if (!user) return book;
    try {
      const backup = await fetchLibraryBackup(user.id);
      const matchingEntry = matchingLibraryBackupEntry(book, backup ?? []);
      if (!matchingEntry || !hasBackupReadingProgress(matchingEntry)) return book;
      const result = restoreLibraryProgress(book, matchingEntry, pages);
      showToast(backupProgressNotice(result));
      return result.book;
    } catch (err) {
      console.warn(`Could not restore saved progress for "${book.title}":`, err);
      showToast('Could not check your cloud backup; imported book will start at the beginning');
      return book;
    }
  };

  const handleRestoreLibrary = async (
    onProgress: (progress: LibraryRestoreProgress) => void
  ): Promise<LibraryRestoreResult | null> => {
    if (!user) throw new Error('Sign in to restore your library.');
    if (!spaceActive.current || libraryLoadState.current !== 'ready') throw new Error('Wait for the saved library to load before restoring.');
    onProgress({ current: 0, total: 0, percent: 0, title: 'Loading your backup…', phase: 'loading' });
    const backup = await fetchLibraryBackup(user.id);
    if (!backup) return null;
    if (backup.length === 0) {
      onProgress({ current: 0, total: 0, percent: 100, title: 'Your backup is empty', phase: 'complete' });
      return {
        restored: 0,
        skipped: 0,
        alreadyInLibrary: 0,
        lookupFailed: 0,
        failures: [],
      };
    }

    const existingBooks = new Set(booksRef.current.map(backupBookKey));
    let catalogMappings = await loadAdded();
    let restored = 0;
    let skipped = 0;
    let alreadyInLibrary = 0;
    let lookupFailed = 0;
    let readingPositionsNotRestored = 0;
    const failures: LibraryRestoreFailure[] = [];

    for (const [index, entry] of backup.entries()) {
      if (!spaceActive.current) throw new Error('Restore stopped after the reading space changed.');
      const bookKey = backupBookKey(entry);
      const basePercent = (index / backup.length) * 100;
      const bookPercent = 100 / backup.length;
      const reportBookComplete = () => onProgress({
        current: index + 1,
        total: backup.length,
        percent: basePercent + bookPercent,
        title: entry.title,
        phase: 'finding',
      });
      if (existingBooks.has(bookKey)) {
        // Restoring a book list must never rewind a book already on this device.
        alreadyInLibrary++;
        reportBookComplete();
        continue;
      }

      onProgress({
        current: index + 1,
        total: backup.length,
        percent: basePercent + bookPercent * 0.1,
        title: entry.title,
        phase: 'finding',
      });
      let catalogBook: CatalogBook | null;
      try {
        catalogBook = entry.gutenbergId ? await getCatalogBook(entry.gutenbergId) : null;
        if (!catalogBook) {
          catalogBook = await findCatalogBook(entry.title, entry.author);
        }
      } catch (err) {
        console.warn(`Catalog lookup failed for "${entry.title}":`, err);
        lookupFailed++;
        failures.push({
          title: entry.title,
          reason: err instanceof Error ? err.message : 'Catalog lookup failed',
          entry,
        });
        reportBookComplete();
        continue;
      }
      if (!catalogBook) {
        skipped++;
        failures.push({ title: entry.title, reason: 'Not found in Project Gutenberg', entry });
        reportBookComplete();
        continue;
      }

      let uri: string | null = null;
      try {
        onProgress({
          current: index + 1,
          total: backup.length,
          percent: basePercent + bookPercent * 0.2,
          title: entry.title,
          phase: 'downloading',
        });
        uri = await downloadEpub(catalogBook, (downloadPercent) => {
          onProgress({
            current: index + 1,
            total: backup.length,
            percent: basePercent + bookPercent * (0.2 + (downloadPercent / 100) * 0.6),
            title: entry.title,
            phase: 'downloading',
          });
        });
        onProgress({
          current: index + 1,
          total: backup.length,
          percent: basePercent + bookPercent * 0.85,
          title: entry.title,
          phase: 'preparing',
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const { book, pages } = await parseEpubFile(uri, `${catalogBook.title}.epub`);
        if (!book.coverUrl && catalogBook.coverUrl) {
          book.coverUrl = catalogBook.coverUrl;
          book.coverStyle = 'image';
        }
        const result = restoreLibraryProgress(book, entry, pages);
        await handleAddEpubBook(result.book, pages);
        if (!result.restored && hasBackupReadingProgress(entry)) readingPositionsNotRestored++;
        catalogMappings = await rememberAdded(catalogMappings, catalogBook.id, book.id);
        existingBooks.add(bookKey);
        restored++;
      } catch (err) {
        console.warn(`Could not restore "${entry.title}":`, err);
        failures.push({
          title: entry.title,
          reason: err instanceof Error ? err.message : 'Download or import failed',
          entry,
        });
      } finally {
        if (uri) deleteDownloaded(uri);
      }
      reportBookComplete();
    }

    if (failures.length > 0) {
      setRecoveryBooks((current) => {
        const byId = new Map(current.map((recovery) => [recovery.id, recovery]));
        failures.forEach((failure) => {
          const id = backupBookKey(failure.entry);
          byId.set(id, { ...failure.entry, id, reason: failure.reason });
        });
        return Array.from(byId.values());
      });
    }

    onProgress({ current: backup.length, total: backup.length, percent: 100, title: 'Library restored', phase: 'complete' });
    return { restored, skipped, alreadyInLibrary, lookupFailed, failures, readingPositionsNotRestored };
  };

  const handleReimportRecoveryBook = async (
    recovery: LibraryRecoveryBook,
    importedBook: Book,
    pages: BookContentPage[]
  ) => {
    const result = restoreLibraryProgress(importedBook, recovery, pages);
    await handleAddEpubBook(result.book, pages);
    setRecoveryBooks((current) => current.filter((item) => item.id !== recovery.id));
    showToast(hasBackupReadingProgress(recovery) ? backupProgressNotice(result) : `Restored “${importedBook.title}” to your Library.`);
  };

  const currentBook = books.find((b) => b.id === currentBookId) || (activeTab !== 'reading' ? books[0] : undefined);
  useEffect(() => { if (hydrated && activeTab === 'reading' && currentBookId && !books.some(book => book.id === currentBookId)) { navigationGeneration.current++; setActiveTab('library'); showToast('This book was removed from your account. Library has been updated.'); } }, [books, currentBookId, hydrated, activeTab, showToast]);

  // ---- Actions ----
  const prepareBook = async (bookId: string): Promise<BookContentPage[] | null> => {
    const generation = ++navigationGeneration.current;
    setOpeningBookId(bookId); setReadingLoadError(null);
    try {
      const loaded = await pageCache.load(bookId);
      if (!spaceActive.current || generation !== navigationGeneration.current || !booksRef.current.some(book => book.id === bookId)) return null;
      const fingerprint = booksRef.current.find(book => book.id === bookId)?.documentFingerprint;
      if (fingerprint && loaded.some(page => page.source && page.source.edition !== fingerprint)) throw Error('This reading text belongs to a different edition. Its files have been kept; recover the matching EPUB from Library.');
      setCustomPagesMap(pageCache.snapshot());
      return loaded;
    } catch (error) {
      if (spaceActive.current && generation === navigationGeneration.current) {
        const message = error instanceof Error ? error.message : 'This book could not be opened. Try again.';
        setReadingLoadError(message); showToast(message);
      }
      return null;
    } finally { if (spaceActive.current && generation === navigationGeneration.current) setOpeningBookId(null); }
  };
  const handleOpenBook = async (bookId: string) => {
    if (!await prepareBook(bookId)) return;
    const book = booksRef.current.find(b => b.id === bookId);
    if (!book) return;
    const updatedBook = { ...book, lastOpened: new Date().toISOString() };
    booksRef.current = booksRef.current.map(item => item.id === bookId ? updatedBook : item);
    setBooks(previous => previous.map(item => item.id === bookId ? { ...item, lastOpened: updatedBook.lastOpened } : item));
    if (libraryLoadState.current === 'ready') void libraryStore.patch(bookId, { lastOpened: updatedBook.lastOpened }).catch(() => { if (spaceActive.current) showToast('Could not save the last-opened date on this device.'); });
    void upsertBookToSupabase(updatedBook);
    setBookDetailsId(null); setJumpTarget(null); setCurrentBookId(bookId); setActiveTab('reading');
  };
  useEffect(() => {
    if (activeTab === 'reading' && currentBook && !customPagesMap[currentBook.id]) void handleOpenBook(currentBook.id);
  }, [activeTab, currentBook?.id]);

  const handleSelectBookDetails = (bookId: string) => {
    navigationGeneration.current++; setOpeningBookId(null);
    setActiveTab('library');
    setBookDetailsId(bookId);
  };

  const handleUpdateReadingPosition = useCallback(
    (bookId: string, page: BookContentPage, totalPages: number, position: ReadingPosition) => {
      const book = booksRef.current.find(item => item.id === bookId);
      if (!book || libraryLoadState.current !== 'ready') return;
      const updatedBook = applyReadingPosition(book, page, totalPages, position, new Date().toISOString());
      const updatedBooks = booksRef.current.map(item => item.id === bookId ? updatedBook : item);
      // Closing Reading flushes during unmount. Update this ref before another book opens.
      booksRef.current = updatedBooks;
      setBooks(previous => previous.map(item => item.id === bookId
        ? applyReadingPosition(item, page, totalPages, position, updatedBook.lastOpened) : item));
      void saveReadingProgress(updatedBooks, updatedBook);
    },
    [saveReadingProgress]
  );

  const handleJumpToReader = async (bookId: string, pageNumber: number, anchor?: SourceAnchor) => {
    const loaded = await prepareBook(bookId);
    if (!loaded) return;
    const loadedPages = { [bookId]: loaded };
    if (libraryLoadState.current !== 'ready' || !canOpenSavedPassage(booksRef.current, loadedPages, bookId, pageNumber, anchor)) {
      showToast('This saved passage is unavailable on this device. Check the book in Library and import its EPUB if needed.');
      return;
    }
    const target = anchor ? resolveSourceAnchor(anchor, loaded) : null;
    if (target) pageNumber = loaded[target.index].pageNumber;
    setCurrentBookId(bookId);
    setJumpTarget({ bookId, page: pageNumber, nonce: Date.now(), ...(target ? { wordOffset: target.wordOffset } : {}) });
    setActiveTab('reading');
    showToast(`Opened passage ${pageNumber}`);
  };

  const writeBookmarks = async (operation: () => Promise<Bookmark[]>, message: (items: Bookmark[]) => string) => {
    if (!spaceActive.current || bookmarkStatus !== 'ready' || bookmarkWritePending.current) return;
    bookmarkWritePending.current = true;
    setBookmarkSaving(true);
    try {
      const saved = await operation();
      setBookmarks(saved);
      showToast(message(saved));
    } catch {
      showToast("Couldn't save bookmarks. Try again.");
    } finally {
      bookmarkWritePending.current = false;
      setBookmarkSaving(false);
    }
  };
  const handleToggleBookmark = (bookId: string, page: BookContentPage) => {
    const existing = bookmarks.find(item => item.bookId === bookId && findBookmarkPage(item, [page]) === 0);
    if (existing) { void writeBookmarks(() => bookmarkStore.remove(existing.id), () => 'Bookmark removed'); return; }
    const bookmark = createBookmark(bookId, page);
    void writeBookmarks(() => bookmarkStore.toggle(bookmark), saved =>
      saved.some(item => item.id === bookmark.id) ? 'Bookmark saved on this device' : 'Bookmark removed');
  };
  const handleRemoveBookmark = (id: string) => {
    void writeBookmarks(() => bookmarkStore.remove(id), () => 'Bookmark removed');
  };

  const handleAddHighlight = useMemo(() => createRetryableWriter(
    (draft: Omit<HighlightEntry, 'id' | 'dateAdded'>): HighlightEntry => ({ ...draft, id: `hl-${randomUUID()}`, dateAdded: new Date().toISOString() }),
    highlightArchive.add,
  ), [storage]);

  const handleDeleteHighlight = (id: string): Promise<boolean> => highlightArchive.remove(id);

  const handleAddReflectionNote = (highlightId: string, noteText: string): Promise<boolean> =>
    highlightArchive.note(highlightId, noteText);

  const handleSaveToLexicon = useMemo(() => createRetryableWriter(
    (draft: Omit<LexiconEntry, 'id'>): LexiconEntry => ({ ...draft, id: `lex-${randomUUID()}` }),
    lexiconArchive.add,
  ), [storage]);

  const handleUpdateMastery = (id: string, newLevel: number): Promise<boolean> =>
    lexiconArchive.mastery(id, newLevel);

  const handleAddEpubBook = async (newBook: Book, newPages: BookContentPage[]) => {
    await importCommitterRef.current!(newBook, newPages);
    pageCache.put(newBook.id, newPages);
    setCustomPagesMap(pageCache.snapshot());
    setAvailableBookIds(previous => [...new Set([...previous, newBook.id])]);
    void upsertBookToSupabase(newBook);
    showToast(`Added "${newBook.title}" to your Library`);
  };

  const handleUpdateBookCover = async (bookId: string, draft: BookCoverDraft): Promise<CoverSaveResult> => {
    if (!spaceActive.current || libraryLoadState.current !== 'ready') {
      return { saved: false, message: 'The saved library is unavailable. Wait for it to load, or restart Folio before saving a cover.' };
    }
    if (savingCover.current || removingBook.current) return { saved: false, message: 'A book change is still saving. Try again shortly.' };
    savingCover.current = true;
    try {
      const result = await saveBookCover(bookId, draft, {
        getBooks: () => booksRef.current,
        persistPhoto: storage.persistCoverImage,
        removeCustomCover: storage.removeCustomCover,
        savePatch: async (id, patch) => {
          if (!spaceActive.current) throw new Error('Reading space changed');
          await libraryStore.patch(id, patch);
        },
        publish: (id, patch) => {
          booksRef.current = booksRef.current.map(book => book.id === id ? { ...book, ...patch } : book);
          setBooks(current => current.map(book => book.id === id ? { ...book, ...patch } : book));
        },
        upload: upsertBookToSupabase,
      });
      if (result.saved && spaceActive.current) showToast(result.message);
      return result;
    } finally { savingCover.current = false; }
  };

  const handleRemoveBook = async (bookId: string): Promise<BookRemovalResult> => {
    const book = booksRef.current.find(item => item.id === bookId);
    if (!spaceActive.current || !book) return { removed: false, message: 'This book is no longer available in this Library.' };
    if (savingCover.current) return { removed: false, message: 'The book cover is still saving. Try removal again shortly.' };
    if (removingBook.current) return { removed: false, message: 'Another book removal is still in progress. Try again shortly.' };
    if (libraryLoadState.current !== 'ready') {
      return { removed: false, message: libraryLoadState.current === 'error'
        ? 'The saved library could not be loaded. Restart Folio before removing books.'
        : 'The library is still loading. Try again shortly.' };
    }
    if (bookmarkStatus !== 'ready' || bookmarkWritePending.current || bookmarkSaving) {
      return { removed: false, message: bookmarkStatus === 'error'
        ? 'Saved bookmarks could not be loaded. Use Try again in this book’s bookmark list before removing it.'
        : 'Bookmarks are still loading or saving. Try again shortly.' };
    }
    if (highlightArchive.status !== 'ready' || highlightArchive.busy || lexiconArchive.status !== 'ready' || lexiconArchive.busy) {
      return { removed: false, message: 'Wait for saved notes and vocabulary to finish loading or saving. Use Try again in Notebook if needed.' };
    }
    removingBook.current = true;
    try {
      return await onRemovalJob(bookId);
    } finally { removingBook.current = false; }
  };

  const saveSettingsFromSheet = async (partial: Partial<ReadingSettings>) => {
    const saved = await readerSettings.patch(partial);
    if (saved) showToast('Reading preferences saved on this device');
    return saved;
  };

  const accountSync = useAccountSync(storage, cloud, Boolean(user) && hydrated);

  // ---- Layout ----
  const reading = activeTab === 'reading';
  const topPad = reading && isImmersiveMode ? insets.top + 8 : insets.top + HEADER_HEIGHT + 4;
  const bottomSpace = NAV_SPACE + insets.bottom;
  const readingBottomSpace = insets.bottom + 8;
  const palette = createPalette(settings.theme);

  return (
    <AppThemeProvider theme={settings.theme}>
    <View style={[styles.app, { backgroundColor: palette.background }]}>
      <StatusBar
        style={settings.theme === 'charcoal' ? 'light' : 'dark'}
        hidden={reading && isImmersiveMode}
      />

      <Header
        activeTab={activeTab}
        onTabChange={tab => { if (tab !== 'reading') { navigationGeneration.current++; setOpeningBookId(null); } setActiveTab(tab); }}
        onOpenSearch={() => activeTab === 'library' ? setLibrarySearchRequest(value => value + 1) : setIsSearchOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        visible={isNavVisible && !isImmersiveMode}
        userAvatar={user?.avatarUrl}
        detailsTitle={
          activeTab === 'library' && bookDetailsId
            ? books.find((book) => book.id === bookDetailsId)?.title ?? 'Book details'
            : undefined
        }
        onBackFromDetails={() => { navigationGeneration.current++; setOpeningBookId(null); setBookDetailsId(null); }}
      />

      <View style={[styles.main, activeTab === 'library' && { paddingHorizontal: 0 }, { paddingTop: topPad, paddingBottom: reading ? 0 : 0 }]}>
        {activeTab === 'library' && (
          <LibraryView
            searchRequest={librarySearchRequest}
            onSearchRequestHandled={() => setLibrarySearchRequest(0)}
            storage={storage}
            bookmarkCount={bookmarks.length}
            onOpenBookmarks={() => setLibraryBookmarksOpen(true)}
            books={books}
            availableBookIds={availableBookIds}
            openingBookId={openingBookId}
            libraryStatus={libraryStatus}
            recoveryBooks={recoveryBooks}
            selectedBookId={bookDetailsId}
            onSelectBook={id => { navigationGeneration.current++; setOpeningBookId(null); setBookDetailsId(id); }}
            readingGoal={readingGoal}
            globalCoverStyle={settings.defaultCoverStyle || 'image'}
            onOpenBook={handleOpenBook}
            onAddEpubBook={handleAddEpubBook}
            onRestoreImportedProgress={handleRestoreImportedProgress}
            onReimportRecoveryBook={handleReimportRecoveryBook}
            onUpdateBookCover={handleUpdateBookCover}
            onRemoveBook={handleRemoveBook}
            showToast={showToast}
            bottomInset={insets.bottom}
          />
        )}

        {activeTab === 'reading' && !customPagesMap[currentBook?.id ?? ''] && <View style={[styles.center, { flex: 1, padding: 24 }]}>
          {openingBookId ? <ActivityIndicator accessibilityLabel="Opening book text" /> : <>
            <Text accessibilityRole="alert">{readingLoadError || 'Choose a book in Library to start reading.'}</Text>
            {currentBook && <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => void handleOpenBook(currentBook.id)}><Text>Try opening again</Text></Pressable>}
          </>}
        </View>}
        {activeTab === 'reading' && Boolean(customPagesMap[currentBook?.id ?? '']) && (
          <ReaderView
            key={`${currentBook?.id ?? 'empty'}:${currentBook ? customPagesMap[currentBook.id]?.length ?? 0 : 0}`}
            currentBook={currentBook}
            customPages={currentBook ? customPagesMap[currentBook.id] : undefined}
            onUpdateReadingPosition={handleUpdateReadingPosition}
            settings={settings}
            onUpdateSettings={readerSettings.patch}
            settingsStatus={readerSettings.status}
            settingsNotice={readerSettings.notice}
            onOpenSettingsSheet={() => setIsSettingsSheetOpen(true)}
            onOpenDictionary={(word, context, source) => setDictionaryState({ isOpen: true, word, context, bookId: currentBook?.id, source })}
            highlights={highlights}
            onAddHighlight={handleAddHighlight}
            onDeleteHighlight={handleDeleteHighlight}
            onAddReflectionNote={handleAddReflectionNote}
            bookmarks={bookmarks}
            bookmarkStatus={bookmarkStatus}
            bookmarkSaving={bookmarkSaving}
            onRetryBookmarks={loadBookmarks}
            onRemoveBookmark={handleRemoveBookmark}
            onToggleBookmark={handleToggleBookmark}
            isNavVisible={isNavVisible && !isImmersiveMode}
            isImmersiveMode={isImmersiveMode}
            onToggleNavVisibility={handleToggleNavVisibility}
            setNavVisibility={setReaderNavVisibility}
            showToast={showToast}
            jumpTarget={jumpTarget}
            onJumpHandled={nonce => setJumpTarget(previous => previous?.nonce === nonce ? null : previous)}
            bottomSpace={readingBottomSpace}
            playbackBlocked={isSettingsSheetOpen || isSearchOpen || isProfileOpen || dictionaryState.isOpen || Boolean(flashcardItem)}
          />
        )}

        {activeTab === 'notebook' && (
          <NotebookView
            cloud={cloud}
            syncSummary={accountSync.summary}
            syncBusy={accountSync.busy}
            accountSignedIn={Boolean(user)}
            onSyncNow={accountSync.retry}
            onReviewConflicts={accountSync.status.conflicts.length ? () => setSyncReviewOpen(true) : undefined}
            highlightStatus={highlightArchive.status}
            highlightNotice={highlightArchive.notice}
            highlightBusy={highlightArchive.busy}
            onRetryHighlights={highlightArchive.retry}
            vocabularyStatus={lexiconArchive.status}
            vocabularyNotice={lexiconArchive.notice}
            vocabularyBusy={lexiconArchive.busy}
            onRetryVocabulary={lexiconArchive.retry}
            books={books}
            highlights={highlights}
            lexicon={lexicon}
            onJumpToReader={handleJumpToReader}
            onAddReflectionNote={handleAddReflectionNote}
            onDeleteHighlight={handleDeleteHighlight}
            onAddHighlight={handleAddHighlight}
            onOpenFlashcard={(item) => setFlashcardItem(item)}
            showToast={showToast}
            bottomInset={insets.bottom}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsSheet
            settings={settings}
            onSave={saveSettingsFromSheet}
            saveStatus={readerSettings.status}
            saveNotice={readerSettings.notice}
            saveBusy={readerSettings.busy}
            onRetry={readerSettings.retry}
            onClose={() => setActiveTab('settings')}
            bottomSpace={bottomSpace}
          />
        )}
      </View>

      {isSettingsSheetOpen && (
        <SettingsSheet
          settings={settings}
          onSave={saveSettingsFromSheet}
          saveStatus={readerSettings.status}
          saveNotice={readerSettings.notice}
          saveBusy={readerSettings.busy}
          onRetry={readerSettings.retry}
          onClose={() => setIsSettingsSheetOpen(false)}
          isSheetOnly
        />
      )}

      {isSearchOpen && (
        <SearchModal
          books={books}
          bookPages={customPagesMap}
          availableBookIds={availableBookIds}
          globalCoverStyle={settings.defaultCoverStyle ?? 'image'}
          libraryStatus={libraryStatus}
          highlightStatus={highlightArchive.status}
          vocabularyStatus={lexiconArchive.status}
          onRetryHighlights={highlightArchive.retry}
          onRetryVocabulary={lexiconArchive.retry}
          onShowLibrary={() => { setActiveTab('library'); setBookDetailsId(null); }}
          onSelectVocabulary={entry => setFlashcardItem(entry)}
          highlights={highlights}
          lexicon={lexicon}
          onClose={() => setIsSearchOpen(false)}
          onSelectBook={handleSelectBookDetails}
          onSelectHighlight={handleJumpToReader}
        />
      )}

      {libraryBookmarksOpen && <BookmarkSheet
        bookmarks={bookmarks} currentPage={0} status={bookmarkStatus} saving={bookmarkSaving}
        bookTitles={Object.fromEntries(books.map(book => [book.id, book.title]))}
        onClose={() => setLibraryBookmarksOpen(false)} onRetry={loadBookmarks} onRemove={handleRemoveBookmark}
        onSelect={bookmark => {
          if (!availableBookIds.includes(bookmark.bookId)) { setLibraryBookmarksOpen(false); showToast('Import this book’s EPUB from Library to open its saved passage.'); return; }
          setLibraryBookmarksOpen(false); void handleJumpToReader(bookmark.bookId, bookmark.pageNumber, bookmark.anchor);
        }}
      />}
      {syncReviewOpen && <SyncReviewModal conflicts={accountSync.status.conflicts} onClose={() => setSyncReviewOpen(false)} onResolve={async (record, choice) => {
        await cloud.sync.resolve(record.kind, record.id, record.token, record.account.revision, choice); accountSync.retry();
      }} />}
      {isProfileOpen && (
        <ProfileModal
          goal={readingGoal}
          hasLegacyData={hasLegacyData}
          authError={authError}
          libraryStatus={libraryStatus}
          bookCount={books.length}
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
          onBackupLibrary={handleBackupLibrary}
          onRestoreLibrary={handleRestoreLibrary}
          onChooseSafetyCopy={choosePortableBackup}
          onExportSafetyCopy={includeOriginals => onPortableJob({ kind: 'export', includeOriginals })}
          onRestoreSafetyCopy={(backup, preferences, recoverMatching) => onPortableJob({ kind: 'restore', backup, preferences, recoverMatching })}
          syncSummary={accountSync.summary}
          onReviewConflicts={accountSync.status.conflicts.length ? () => { setIsProfileOpen(false); setSyncReviewOpen(true); } : undefined}
          showToast={showToast}
        />
      )}

      {dictionaryState.isOpen && (
        <DictionaryModal
          initialWord={dictionaryState.word}
          contextPassage={dictionaryState.context}
          bookId={dictionaryState.bookId ?? ''}
          source={dictionaryState.source}
          onClose={() => setDictionaryState({ isOpen: false, word: '' })}
          onSaveToLexicon={handleSaveToLexicon}
          saveStatus={lexiconArchive.status}
          saveBusy={lexiconArchive.busy}
          showToast={showToast}
        />
      )}

      {flashcardItem && (
        <FlashcardModal
          key={flashcardItem.id}
          lexiconItem={lexicon.find(entry => entry.id === flashcardItem.id) ?? flashcardItem}
          cardAvailable={lexiconArchive.status !== 'ready' || lexicon.some(entry => entry.id === flashcardItem.id)}
          onRetry={lexiconArchive.retry}
          onOpenContext={flashcardItem.page && availableBookIds.includes(flashcardItem.bookId) ? () => {
            const item = lexicon.find(entry => entry.id === flashcardItem.id) ?? flashcardItem;
            setFlashcardItem(null); void handleJumpToReader(item.bookId, item.page!, item.anchor);
          } : undefined}
          onClose={() => setFlashcardItem(null)}
          onUpdateMastery={handleUpdateMastery}
          saveStatus={lexiconArchive.status}
          saveBusy={lexiconArchive.busy}
          showToast={showToast}
        />
      )}

      {!isSearchOpen && (
        <BottomNav
          activeTab={activeTab}
          onTabChange={tab => { if (tab !== 'reading') { navigationGeneration.current++; setOpeningBookId(null); } setActiveTab(tab); }}
          visible={activeTab !== 'reading' && !bookDetailsId && isNavVisible && !isImmersiveMode}
        />
      )}
      <Toast message={toastMessage} bottom={bottomSpace - 8 + 12} />
    </View>
    </AppThemeProvider>
  );
}

/** Recovery runs before archive hooks mount. Portable jobs unmount them first. */
function ReadingSpace(props: ReadingSpaceProps) {
  const storage = useMemo(() => createReplicatedStore(createLocalStore(props.scope), randomUUID, Boolean(props.user)), [props.scope]);
  const [job, setJob] = useState<PortableJob | null>(null);
  const [phase, setPhase] = useState<'working' | 'ready' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const [canOpen, setCanOpen] = useState(false);
  const [incompleteImport, setIncompleteImport] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const mounted = useRef(true);
  const removalReply = useRef<((result: BookRemovalResult) => void) | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; removalReply.current?.({ removed: false, message: 'The reading space changed. Reopen the original space to check removal.' }); }; }, []);
  useEffect(() => {
    let active = true;
    setPhase('working');
    void (async () => {
      try {
        await waitForImportCommits(storage.storageKey(IMPORT_JOURNAL));
        await recoverOriginalImport(storage, storage.verifyImportedBook);
        await recoverPortableRestore(storage);
        // File cleanup is idempotent and stays queued if native deletion fails.
        try { await createLibraryStore(storage).cleanupFiles(storage.removeBookFiles); } catch { /* The persisted cleanup list remains. */ }
        if (!active) return;
        if (job?.kind === 'export') {
          await exportPortableBackup(storage, job.includeOriginals);
          if (active) { setMessage('Safety copy prepared. Check that your chosen destination saved the ZIP file.'); setPhase('done'); }
        } else if (job?.kind === 'restore') {
          await importPortableBackup(storage, job.backup, job.preferences, job.recoverMatching);
          if (active) { setMessage(job.recoverMatching ? 'Safety copy recovered. Matching editions retain their current progress and saved work.' : 'Safety copy restored as separate books and saved work.'); setPhase('done'); }
        } else if (job?.kind === 'remove') {
          const title = await removeBookWithRecovery(storage, job.bookId);
          let filesRemain = true;
          try { filesRemain = (await createLibraryStore(storage).cleanupFiles(storage.removeBookFiles)).pendingFileRemovals.length > 0; } catch { /* Retry on reopening. */ }
          const result = { removed: true, message: `“${title}” removed on this device.${filesRemain ? ' Some local files still need cleanup.' : ''}` };
          removalReply.current?.(result); removalReply.current = null;
          if (active) { setMessage(result.message); setPhase('done'); }
        } else setPhase('ready');
      } catch (error) {
        let pending = true, importPending = false;
        try { [pending, importPending] = await Promise.all([hasPendingRestore(storage), hasPendingOriginalImport(storage)]); } catch { /* Unknown state stays closed. */ }
        removalReply.current?.({ removed: false, message: 'Removal could not be completed. Reopen this reading space to finish recovery.' }); removalReply.current = null;
        if (active) {
          setMessage(error instanceof Error ? error.message : 'This recovery action could not be completed.');
          setCanOpen(!pending && !importPending); setIncompleteImport(!pending && importPending); setPhase('error');
        }
      } finally { running.current = false; }
    })();
    return () => { active = false; };
  }, [storage, job, attempt]);
  const requestJob = (next: PortableJob) => {
    if (running.current) return;
    running.current = true; setPhase('working'); setJob(next);
  };
  const requestRemoval = (bookId: string): Promise<BookRemovalResult> => {
    if (running.current) return Promise.resolve({ removed: false, message: 'Another library operation is still in progress.' });
    return new Promise(resolve => { removalReply.current = resolve; requestJob({ kind: 'remove', bookId }); });
  };
  if (phase === 'ready') return <FolioApp {...props} onPortableJob={requestJob} onRemovalJob={requestRemoval} />;
  return <View style={[styles.app, styles.center, { padding: 24, gap: 16 }]}>
    {phase === 'working' ? <>
      <ActivityIndicator accessibilityLabel={job?.kind === 'export' ? 'Preparing safety copy' : 'Opening and recovering your reading space'} />
      <Text accessibilityLiveRegion="polite">{job?.kind === 'export' ? 'Preparing your safety copy…' : 'Checking and saving your reading space…'}</Text>
    </> : <>
      <Text accessibilityRole={phase === 'error' ? 'alert' : undefined}>{message}</Text>
      {phase === 'error' && <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => { setPhase('working'); setJob(null); setAttempt(value => value + 1); }}><Text>Retry recovery</Text></Pressable>}
      {phase === 'error' && incompleteImport && <>
        <Text>You can set this incomplete import aside and open your existing library. Its remaining files will be kept on this device.</Text>
        <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => {
          if (running.current) return;
          running.current = true; setPhase('working');
          void storage.saveJSONStrict(IMPORT_JOURNAL, null).then(() => { if (mounted.current) { setJob(null); setAttempt(value => value + 1); } }, () => { running.current = false; if (mounted.current) setPhase('error'); });
        }}><Text>Set incomplete import aside</Text></Pressable>
      </>}
      {(phase === 'done' || canOpen) && <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => { setJob(null); setPhase('working'); setAttempt(value => value + 1); }}><Text>Open Library</Text></Pressable>}
    </>}
  </View>;
}

// The key unmounts old screens/state; each asynchronous operation retains its old
// storage and cloud repository rather than acquiring the next account's scope.
function AccountBoundary() {
  const [identity, setIdentity] = useState<{ user: UserProfile | null } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasLegacyData, setHasLegacyData] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();
  useEffect(() => watchNativeAuth(supabase.auth, { appState: AppState, linking: Linking }, handleAuthCallback,
    error => setAuthError(error instanceof Error ? error.message : 'Your sign-in could not be completed. Please try again.')), []);
  useEffect(() => {
    let active = true;
    void Promise.all(['books', 'highlights', 'lexicon', 'bookmarks'].map(key => AsyncStorage.getItem(`folio.v1.${key}`)))
      .then(values => { if (active) setHasLegacyData(values.some(value => value !== null)); })
      .catch(() => { if (active) setHasLegacyData(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => watchAccountSession(supabase.auth, session => {
    setIdentity({ user: session?.user ? toUserProfile(session.user) : null });
    setError(false);
  }, () => setError(true)), [attempt]);
  if (!identity) return (
    <View style={[styles.app, styles.center]}>
      {error ? <>
        <Text>Could not open your account safely.</Text>
        <Pressable accessibilityRole="button" onPress={() => { setError(false); setAttempt(value => value + 1); }} style={{ padding: 24 }}>
          <Text>Try again</Text>
        </Pressable>
      </> : <ActivityIndicator accessibilityLabel="Opening your reading space" />}
    </View>
  );
  const scope = `${new URL(SUPABASE_URL || 'https://unconfigured.invalid').hostname}:${identity.user?.id ?? 'guest'}`;
  return <ReadingSpace key={scope} scope={scope} user={identity.user} hasLegacyData={hasLegacyData} authError={authError} onClearAuthError={() => setAuthError(undefined)} />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    EBGaramond_400Regular,
    EBGaramond_400Regular_Italic,
    EBGaramond_500Medium,
    EBGaramond_600SemiBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Literata_400Regular,
    Literata_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={[styles.app, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <MotionPreferencesProvider>
        <AccountBoundary />
      </MotionPreferencesProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
});
