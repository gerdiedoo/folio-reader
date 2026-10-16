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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomNav } from './src/components/BottomNav';
import { DictionaryModal } from './src/components/DictionaryModal';
import { FlashcardModal } from './src/components/FlashcardModal';
import { Header, HEADER_HEIGHT } from './src/components/Header';
import { LibraryView } from './src/components/LibraryView';
import { NotebookView } from './src/components/NotebookView';
import { ProfileModal } from './src/components/ProfileModal';
import { JumpTarget, ReaderView } from './src/components/ReaderView';
import { SearchModal } from './src/components/SearchModal';
import { SettingsSheet } from './src/components/SettingsSheet';
import { Toast } from './src/components/ui/Toast';
import {
  INITIAL_BOOKS,
  INITIAL_GOAL,
  INITIAL_HIGHLIGHTS,
  INITIAL_LEXICON,
  INITIAL_SETTINGS,
} from './src/data/initialData';
import { loadJSON, loadPages, removeBookFiles, saveJSON, savePages } from './src/lib/localStore';
import { parseEpubFile } from './src/lib/epubParser';
import {
  CatalogBook,
  deleteDownloaded,
  downloadEpub,
  findCatalogBook,
  getCatalogBook,
  loadAdded,
  LibraryRestoreFailure,
  LibraryRestoreProgress,
  LibraryRestoreResult,
  LibraryRecoveryBook,
  rememberAdded,
  LibraryBackupEntry,
} from './src/lib/catalog';
import {
  deleteBookFromSupabase,
  deleteHighlightFromSupabase,
  fetchBooksFromSupabase,
  fetchHighlightsFromSupabase,
  fetchLexiconFromSupabase,
  fetchReadingGoalFromSupabase,
  fetchReadingSettingsFromSupabase,
  fetchLibraryBackup,
  getCurrentSupabaseUser,
  saveLibraryBackup,
  signInWithGoogle,
  signOutSupabase,
  supabase,
  toUserProfile,
  upsertBookToSupabase,
  upsertHighlightToSupabase,
  upsertLexiconToSupabase,
  upsertReadingGoalToSupabase,
  upsertReadingSettingsToSupabase,
} from './src/lib/supabase';
import { colors, NAV_SPACE } from './src/theme';
import { AppThemeProvider, createPalette } from './src/AppTheme';
import {
  Book,
  BookContentPage,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
  TabType,
  UserProfile,
} from './src/types';

function getLocalDateKey(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

function normalizeBookMetadata(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applySavedReadingProgress(book: Book, entry: LibraryBackupEntry): Book {
  const totalPages = Math.max(1, book.totalPages);
  const currentPage = Math.max(1, Math.min(totalPages, Math.floor(entry.currentPage ?? book.currentPage)));
  return {
    ...book,
    currentPage,
    progressPercent: Math.max(0, Math.min(100, Math.round((currentPage / totalPages) * 100))),
    currentChapter: entry.currentChapter || book.currentChapter,
    currentLoc: entry.currentLoc ?? book.currentLoc,
    isFinished: entry.isFinished ?? book.isFinished,
  };
}

function FolioApp() {
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabType>('library');
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [bookDetailsId, setBookDetailsId] = useState<string | null>(null);
  const [customPagesMap, setCustomPagesMap] = useState<Record<string, BookContentPage[]>>({});
  const [settings, setSettings] = useState<ReadingSettings>(INITIAL_SETTINGS);
  const [readingGoal, setReadingGoal] = useState<ReadingGoal>(INITIAL_GOAL);
  const [highlights, setHighlights] = useState<HighlightEntry[]>(INITIAL_HIGHLIGHTS);
  const [lexicon, setLexicon] = useState<LexiconEntry[]>(INITIAL_LEXICON);
  const [user, setUser] = useState<UserProfile | null>(null);
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
  const [isBookmarked, setIsBookmarked] = useState(true);
  const [isSettingsSheetOpen, setIsSettingsSheetOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [dictionaryState, setDictionaryState] = useState<{ isOpen: boolean; word: string; context?: string }>({
    isOpen: false,
    word: '',
  });
  const [flashcardItem, setFlashcardItem] = useState<LexiconEntry | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingPositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingGoalRef = useRef(readingGoal);
  readingGoalRef.current = readingGoal;
  const readingDayKeyRef = useRef('');
  const readingSecondsRef = useRef(0);
  const reportedReadingMinutesRef = useRef(0);
  const lastReadingTickRef = useRef<number | null>(null);
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2400);
  }, []);
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
      const [lBooks, lSettings, lGoal, lHighlights, lLexicon, lReadingDay, lRecoveryBooks] = await Promise.all([
        loadJSON<Book[]>('books'),
        loadJSON<ReadingSettings>('settings'),
        loadJSON<ReadingGoal>('goal'),
        loadJSON<HighlightEntry[]>('highlights'),
        loadJSON<LexiconEntry[]>('lexicon'),
        loadJSON<string>('readingDay'),
        loadJSON<LibraryRecoveryBook[]>('libraryRecoveryBooks'),
      ]);
      if (cancelled) return;

      let mergedSettings: ReadingSettings = { ...INITIAL_SETTINGS, ...(lSettings ?? {}) };
      if (lBooks?.length) setBooks(lBooks);
      if (lGoal) setReadingGoal(lGoal);
      if (lHighlights) setHighlights(lHighlights);
      if (lLexicon) setLexicon(lLexicon);
      if (lRecoveryBooks) setRecoveryBooks(lRecoveryBooks);
      setSettings(mergedSettings);

      // Re-attach parsed EPUB pages that were saved to disk
      const pageEntries = await Promise.all(
        (lBooks ?? []).map(async (b) => [b.id, await loadPages(b.id)] as const)
      );
      if (cancelled) return;
      const pagesMap: Record<string, BookContentPage[]> = {};
      pageEntries.forEach(([id, pages]) => {
        if (pages) pagesMap[id] = pages;
      });
      setCustomPagesMap(pagesMap);
      if (lBooks?.length) setCurrentBookId(lBooks[0].id);

      // Remote data (cloud wins for items it has, local-only items are kept)
      let mergedGoal = lGoal ?? INITIAL_GOAL;
      try {
        const [sbBooks, sbHighlights, sbLexicon, sbGoal, sbSettings] = await Promise.all([
          fetchBooksFromSupabase(),
          fetchHighlightsFromSupabase(),
          fetchLexiconFromSupabase(),
          fetchReadingGoalFromSupabase(),
          fetchReadingSettingsFromSupabase(),
        ]);
        if (cancelled) return;

        if (sbBooks?.length) {
          setBooks((prev) => {
            const map = new Map<string, Book>();
            prev.forEach((b) => map.set(b.id, b));
            sbBooks.forEach((b) => {
              // keep a local cover file path if the cloud row has none
              const local = map.get(b.id);
              map.set(b.id, local ? { ...b, coverUrl: b.coverUrl || local.coverUrl } : b);
            });
            return Array.from(map.values());
          });
        }
        if (sbHighlights?.length) setHighlights(sbHighlights);
        if (sbLexicon?.length) setLexicon(sbLexicon);
        if (sbGoal) {
          mergedGoal = sbGoal;
          setReadingGoal(sbGoal);
        }
        if (sbSettings) setSettings((prev) => ({ ...prev, ...sbSettings }));
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

    getCurrentSupabaseUser().then((u) => {
      if (u && !cancelled) setUser(u);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const profile = toUserProfile(session.user);
        setUser(profile);
        if (event === 'SIGNED_IN') {
          showToast(`Signed in as ${profile?.email ?? profile?.fullName ?? 'your account'}`);
        }
      } else {
        setUser(null);
      }
    });

    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
    };
  }, [showToast]);

  // ---- Persist local copies (only after hydration so we never clobber saved data) ----
  useEffect(() => {
    if (hydrated) saveJSON('books', books);
  }, [books, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON('settings', settings);
  }, [settings, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON('goal', readingGoal);
  }, [readingGoal, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON('highlights', highlights);
  }, [highlights, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON('lexicon', lexicon);
  }, [lexicon, hydrated]);
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
    await signInWithGoogle();
  };
  const handleSignOut = async () => {
    await signOutSupabase();
    setUser(null);
  };

  const handleBackupLibrary = async (): Promise<number> => {
    if (!user) throw new Error('Sign in to back up your library.');
    const catalogBooks = await loadAdded();
    const backup: LibraryBackupEntry[] = books.map((book) => {
      const catalogId = Object.entries(catalogBooks).find(([, bookId]) => bookId === book.id)?.[0];
      const gutenbergId = catalogId?.match(/^gutenberg-(\d+)$/)?.[1];
      return {
        title: book.title,
        author: book.author,
        ...(gutenbergId ? { gutenbergId: Number(gutenbergId) } : {}),
        currentPage: book.currentPage,
        progressPercent: book.progressPercent,
        currentChapter: book.currentChapter,
        currentLoc: book.currentLoc,
        isFinished: book.isFinished,
      };
    });
    await saveLibraryBackup(user.id, backup);
    return backup.length;
  };

  const handleRestoreImportedProgress = async (book: Book): Promise<Book> => {
    if (!user) return book;
    try {
      const backup = await fetchLibraryBackup(user.id);
      const matchingEntry = backup?.find((entry) =>
        normalizeBookMetadata(entry.title) === normalizeBookMetadata(book.title) &&
        normalizeBookMetadata(entry.author) === normalizeBookMetadata(book.author)
      );
      if (!matchingEntry || typeof matchingEntry.currentPage !== 'number') return book;

      const restoredBook = applySavedReadingProgress(book, matchingEntry);
      showToast(`Restored reading progress for "${book.title}"`);
      return restoredBook;
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

    const existingTitles = new Set(books.map((book) => normalizeBookMetadata(book.title)));
    let catalogMappings = await loadAdded();
    let restored = 0;
    let skipped = 0;
    let alreadyInLibrary = 0;
    let lookupFailed = 0;
    const failures: LibraryRestoreFailure[] = [];

    for (const [index, entry] of backup.entries()) {
      const titleKey = normalizeBookMetadata(entry.title);
      const basePercent = (index / backup.length) * 100;
      const bookPercent = 100 / backup.length;
      const reportBookComplete = () => onProgress({
        current: index + 1,
        total: backup.length,
        percent: basePercent + bookPercent,
        title: entry.title,
        phase: 'finding',
      });
      if (existingTitles.has(titleKey)) {
        const existingBook = books.find((book) => normalizeBookMetadata(book.title) === titleKey);
        if (existingBook && typeof entry.currentPage === 'number') {
          const updatedBook = applySavedReadingProgress(existingBook, entry);
          setBooks((previous) => previous.map((book) => book.id === updatedBook.id ? updatedBook : book));
          void upsertBookToSupabase(updatedBook);
        }
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
        const restoredBook = applySavedReadingProgress(book, entry);
        savePages(book.id, pages);
        handleAddEpubBook(restoredBook, pages);
        catalogMappings = await rememberAdded(catalogMappings, catalogBook.id, book.id);
        existingTitles.add(titleKey);
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
          const id = `${normalizeBookMetadata(failure.entry.title)}::${normalizeBookMetadata(failure.entry.author)}`;
          byId.set(id, { ...failure.entry, id, reason: failure.reason });
        });
        return Array.from(byId.values());
      });
    }

    onProgress({ current: backup.length, total: backup.length, percent: 100, title: 'Library restored', phase: 'complete' });
    return { restored, skipped, alreadyInLibrary, lookupFailed, failures };
  };

  const handleReimportRecoveryBook = async (
    recovery: LibraryRecoveryBook,
    importedBook: Book,
    pages: BookContentPage[]
  ) => {
    const restoredBook = applySavedReadingProgress(importedBook, recovery);
    savePages(restoredBook.id, pages);
    handleAddEpubBook(restoredBook, pages);
    setRecoveryBooks((current) => current.filter((item) => item.id !== recovery.id));
    showToast(`Restored "${restoredBook.title}" with saved reading progress`);
  };

  const currentBook = books.find((b) => b.id === currentBookId) || books[0];

  // ---- Actions ----
  const handleOpenBook = (bookId: string) => {
    const book = books.find((b) => b.id === bookId);
    if (book) {
      const updatedBook = { ...book, lastOpened: new Date().toISOString() };
      const updatedBooks = books.map((item) => (item.id === bookId ? updatedBook : item));
      setBooks(updatedBooks);
      void saveJSON('books', updatedBooks);
      void upsertBookToSupabase(updatedBook);
    }
    setBookDetailsId(null);
    setCurrentBookId(bookId);
    setActiveTab('reading');
    if (book) showToast(`Resumed "${book.title}"`);
  };

  const handleSelectBookDetails = (bookId: string) => {
    setActiveTab('library');
    setBookDetailsId(bookId);
  };

  const handleUpdateReadingPosition = useCallback(
    (bookId: string, page: BookContentPage, totalPages: number) => {
      const book = books.find((item) => item.id === bookId);
      if (!book || book.currentPage === page.pageNumber) return;

      const updatedBook: Book = {
        ...book,
        currentPage: page.pageNumber,
        currentChapter: page.chapterNumber,
        currentLoc: page.locNumber,
        progressPercent: Math.round((page.pageNumber / Math.max(1, totalPages)) * 100),
        lastOpened: new Date().toISOString(),
      };
      const updatedBooks = books.map((item) => (item.id === bookId ? updatedBook : item));
      setBooks(updatedBooks);
      void saveJSON('books', updatedBooks);

      if (readingPositionTimer.current) clearTimeout(readingPositionTimer.current);
      readingPositionTimer.current = setTimeout(() => {
        void upsertBookToSupabase(updatedBook);
      }, 750);
    },
    [books]
  );

  const handleJumpToReader = (bookId: string, pageNumber: number) => {
    setCurrentBookId(bookId);
    setJumpTarget({ bookId, page: pageNumber, nonce: Date.now() });
    setActiveTab('reading');
    showToast(`Jumped to Page ${pageNumber}`);
  };

  const handleUpdateSettings = (partial: Partial<ReadingSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    upsertReadingSettingsToSupabase(updated);
  };

  const handleToggleBookmark = () => {
    const next = !isBookmarked;
    setIsBookmarked(next);
    showToast(next ? `Bookmark set for page ${currentBook?.currentPage ?? 1}` : 'Bookmark removed');
  };

  const handleAddHighlight = (newHl: Omit<HighlightEntry, 'id' | 'dateAdded'>) => {
    const entry: HighlightEntry = {
      ...newHl,
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dateAdded: 'Added just now',
    };
    setHighlights((prev) => [entry, ...prev]);
    upsertHighlightToSupabase(entry);
  };

  const handleDeleteHighlight = (id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    deleteHighlightFromSupabase(id);
  };

  const handleAddReflectionNote = (highlightId: string, noteText: string) => {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = { ...target, note: noteText };
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
    upsertHighlightToSupabase(updated);
  };

  const handleSaveToLexicon = (newLex: Omit<LexiconEntry, 'id'>) => {
    const entry: LexiconEntry = { ...newLex, id: `lex-${Date.now()}` };
    setLexicon((prev) => [entry, ...prev]);
    upsertLexiconToSupabase(entry);
  };

  const handleUpdateMastery = (id: string, newLevel: number) => {
    const target = lexicon.find((l) => l.id === id);
    if (!target) return;
    const updated = { ...target, masteryLevel: newLevel };
    setLexicon((prev) => prev.map((l) => (l.id === id ? updated : l)));
    upsertLexiconToSupabase(updated);
  };

  const handleAddEpubBook = (newBook: Book, newPages: BookContentPage[]) => {
    setBooks((prev) => [newBook, ...prev]);
    setCustomPagesMap((prev) => ({ ...prev, [newBook.id]: newPages }));
    upsertBookToSupabase(newBook);
    showToast(`Added "${newBook.title}" to your Library`);
  };

  const handleUpdateBookCover = (bookId: string, coverStyle: 'image' | 'typographic', newCoverUrl?: string) => {
    const target = books.find((b) => b.id === bookId);
    if (!target) return;
    const updated: Book = {
      ...target,
      coverStyle,
      coverUrl: newCoverUrl !== undefined ? newCoverUrl : target.coverUrl,
    };
    setBooks((prev) => prev.map((b) => (b.id === bookId ? updated : b)));
    upsertBookToSupabase(updated);
  };

  const handleRemoveBook = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (!book) return;

    const remainingBooks = books.filter((item) => item.id !== bookId);
    setBooks(remainingBooks);
    setHighlights((prev) => prev.filter((item) => item.bookId !== bookId));
    setLexicon((prev) => prev.filter((item) => item.bookId !== bookId));
    setCustomPagesMap((prev) => {
      const remainingPages = { ...prev };
      delete remainingPages[bookId];
      return remainingPages;
    });
    if (currentBookId === bookId) setCurrentBookId(remainingBooks[0]?.id ?? '');
    removeBookFiles(bookId, book.coverUrl);

    const removedFromCloud = await deleteBookFromSupabase(bookId);
    showToast(
      removedFromCloud
        ? `"${book.title}" and its notes were removed`
        : `"${book.title}" removed locally; cloud cleanup failed`
    );
  };

  const saveSettingsFromSheet = (newSettings: ReadingSettings, message: string) => {
    setSettings(newSettings);
    upsertReadingSettingsToSupabase(newSettings);
    showToast(message);
  };

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
        onTabChange={setActiveTab}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        visible={isNavVisible && !isImmersiveMode}
        userAvatar={user?.avatarUrl}
        detailsTitle={
          activeTab === 'library' && bookDetailsId
            ? books.find((book) => book.id === bookDetailsId)?.title ?? 'Book details'
            : undefined
        }
        onBackFromDetails={() => setBookDetailsId(null)}
      />

      <View style={[styles.main, { paddingTop: topPad, paddingBottom: reading ? 0 : 0 }]}>
        {activeTab === 'library' && (
          <LibraryView
            books={books}
            recoveryBooks={recoveryBooks}
            selectedBookId={bookDetailsId}
            onSelectBook={setBookDetailsId}
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

        {activeTab === 'reading' && (
          <ReaderView
            currentBook={currentBook}
            customPages={currentBook ? customPagesMap[currentBook.id] : undefined}
            onUpdateReadingPosition={handleUpdateReadingPosition}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onOpenSettingsSheet={() => setIsSettingsSheetOpen(true)}
            onOpenDictionary={(word, context) => setDictionaryState({ isOpen: true, word, context })}
            highlights={highlights}
            onAddHighlight={handleAddHighlight}
            onDeleteHighlight={handleDeleteHighlight}
            onAddReflectionNote={handleAddReflectionNote}
            isBookmarked={isBookmarked}
            onToggleBookmark={handleToggleBookmark}
            isNavVisible={isNavVisible && !isImmersiveMode}
            isImmersiveMode={isImmersiveMode}
            onToggleNavVisibility={handleToggleNavVisibility}
            setNavVisibility={setReaderNavVisibility}
            showToast={showToast}
            jumpTarget={jumpTarget}
            bottomSpace={readingBottomSpace}
          />
        )}

        {activeTab === 'notebook' && (
          <NotebookView
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
            onSave={(s) => saveSettingsFromSheet(s, 'Typography preferences saved')}
            onClose={() => setActiveTab('settings')}
            bottomSpace={bottomSpace}
          />
        )}
      </View>

      {isSettingsSheetOpen && (
        <SettingsSheet
          settings={settings}
          onSave={(s) => saveSettingsFromSheet(s, 'Typography preferences applied & synced')}
          onClose={() => setIsSettingsSheetOpen(false)}
          isSheetOnly
        />
      )}

      {isSearchOpen && (
        <SearchModal
          books={books}
          highlights={highlights}
          lexicon={lexicon}
          onClose={() => setIsSearchOpen(false)}
          onSelectBook={handleSelectBookDetails}
          onSelectHighlight={handleJumpToReader}
        />
      )}

      {isProfileOpen && (
        <ProfileModal
          goal={readingGoal}
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
          onBackupLibrary={handleBackupLibrary}
          onRestoreLibrary={handleRestoreLibrary}
          showToast={showToast}
        />
      )}

      {dictionaryState.isOpen && (
        <DictionaryModal
          initialWord={dictionaryState.word}
          contextPassage={dictionaryState.context}
          bookId={currentBook?.id ?? ''}
          onClose={() => setDictionaryState({ isOpen: false, word: '' })}
          onSaveToLexicon={handleSaveToLexicon}
          showToast={showToast}
        />
      )}

      {flashcardItem && (
        <FlashcardModal
          lexiconItem={flashcardItem}
          onClose={() => setFlashcardItem(null)}
          onUpdateMastery={handleUpdateMastery}
          showToast={showToast}
        />
      )}

      {!isSearchOpen && (
        <BottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          visible={activeTab !== 'reading' && !bookDetailsId && isNavVisible && !isImmersiveMode}
        />
      )}
      <Toast message={toastMessage} bottom={bottomSpace - 8 + 12} />
    </View>
    </AppThemeProvider>
  );
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
      <FolioApp />
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
