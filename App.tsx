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
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { loadJSON, loadPages, saveJSON } from './src/lib/localStore';
import {
  deleteHighlightFromSupabase,
  fetchBooksFromSupabase,
  fetchHighlightsFromSupabase,
  fetchLexiconFromSupabase,
  fetchReadingGoalFromSupabase,
  fetchReadingSettingsFromSupabase,
  getCurrentSupabaseUser,
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

function FolioApp() {
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabType>('library');
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const [currentBookId, setCurrentBookId] = useState<string>('');
  const [customPagesMap, setCustomPagesMap] = useState<Record<string, BookContentPage[]>>({});
  const [settings, setSettings] = useState<ReadingSettings>(INITIAL_SETTINGS);
  const [readingGoal, setReadingGoal] = useState<ReadingGoal>(INITIAL_GOAL);
  const [highlights, setHighlights] = useState<HighlightEntry[]>(INITIAL_HIGHLIGHTS);
  const [lexicon, setLexicon] = useState<LexiconEntry[]>(INITIAL_LEXICON);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);

  // Navigation visibility (auto-hides while reading & scrolling)
  const [isNavVisible, setIsNavVisible] = useState(true);
  useEffect(() => {
    if (activeTab !== 'reading') setIsNavVisible(true);
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
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2400);
  }, []);

  // ---- Local-first hydration, then Supabase merge, then auth listener ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [lBooks, lSettings, lGoal, lHighlights, lLexicon] = await Promise.all([
        loadJSON<Book[]>('books'),
        loadJSON<ReadingSettings>('settings'),
        loadJSON<ReadingGoal>('goal'),
        loadJSON<HighlightEntry[]>('highlights'),
        loadJSON<LexiconEntry[]>('lexicon'),
      ]);
      if (cancelled) return;

      let mergedSettings: ReadingSettings = { ...INITIAL_SETTINGS, ...(lSettings ?? {}) };
      if (lBooks?.length) setBooks(lBooks);
      if (lGoal) setReadingGoal(lGoal);
      if (lHighlights) setHighlights(lHighlights);
      if (lLexicon) setLexicon(lLexicon);
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
        if (sbGoal) setReadingGoal(sbGoal);
        if (sbSettings) setSettings((prev) => ({ ...prev, ...sbSettings }));
      } catch (err) {
        console.warn('Initial Supabase fetch note:', err);
      }

      if (!cancelled) setHydrated(true);
    })();

    getCurrentSupabaseUser().then((u) => {
      if (u && !cancelled) setUser(u);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const profile = toUserProfile(session.user);
        setUser(profile);
        if (event === 'SIGNED_IN') showToast(`Signed in as ${profile.email ?? profile.fullName}`);
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

  // ---- Auth ----
  const handleGoogleSignIn = async () => {
    await signInWithGoogle();
  };
  const handleSignOut = async () => {
    await signOutSupabase();
    setUser(null);
  };

  const currentBook = books.find((b) => b.id === currentBookId) || books[0];

  // ---- Actions ----
  const handleOpenBook = (bookId: string) => {
    setCurrentBookId(bookId);
    setActiveTab('reading');
    const book = books.find((b) => b.id === bookId);
    if (book) showToast(`Resumed "${book.title}"`);
  };

  const handleJumpToReader = (bookId: string, pageNumber: number) => {
    setCurrentBookId(bookId);
    setJumpTarget({ bookId, page: pageNumber, nonce: Date.now() });
    setActiveTab('reading');
    showToast(`Jumped to Page ${pageNumber}`);
  };

  const handleLogReadingTime = (mins: number) => {
    const updated = { ...readingGoal, minutesReadToday: readingGoal.minutesReadToday + mins };
    setReadingGoal(updated);
    upsertReadingGoalToSupabase(updated);
    showToast(`Logged +${mins}m reading time`);
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
    setCurrentBookId(newBook.id);
    setActiveTab('reading');
    upsertBookToSupabase(newBook);
    showToast(`Loaded "${newBook.title}" into Reader`);
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

  const saveSettingsFromSheet = (newSettings: ReadingSettings, message: string) => {
    setSettings(newSettings);
    upsertReadingSettingsToSupabase(newSettings);
    showToast(message);
  };

  // ---- Layout ----
  const reading = activeTab === 'reading';
  const immersive = reading && !isNavVisible;
  const topPad = immersive ? insets.top + 8 : insets.top + HEADER_HEIGHT + 4;
  const bottomSpace = NAV_SPACE + insets.bottom;

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />

      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        isBookmarked={isBookmarked}
        onToggleBookmark={handleToggleBookmark}
        visible={isNavVisible}
        userAvatar={user?.avatarUrl}
      />

      <View style={[styles.main, { paddingTop: topPad, paddingBottom: reading ? 0 : 0 }]}>
        {activeTab === 'library' && (
          <LibraryView
            books={books}
            readingGoal={readingGoal}
            globalCoverStyle={settings.defaultCoverStyle || 'image'}
            onOpenBook={handleOpenBook}
            onLogReadingTime={handleLogReadingTime}
            onAddEpubBook={handleAddEpubBook}
            onUpdateBookCover={handleUpdateBookCover}
            onChangeGlobalCoverStyle={(style) => handleUpdateSettings({ defaultCoverStyle: style })}
            showToast={showToast}
            bottomInset={insets.bottom}
          />
        )}

        {activeTab === 'reading' && (
          <ReaderView
            currentBook={currentBook}
            customPages={currentBook ? customPagesMap[currentBook.id] : undefined}
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
            isNavVisible={isNavVisible}
            onToggleNavVisibility={() => setIsNavVisible((prev) => !prev)}
            setNavVisibility={setIsNavVisible}
            showToast={showToast}
            jumpTarget={jumpTarget}
            bottomSpace={bottomSpace}
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
            onClose={() => setActiveTab('reading')}
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
          onSelectBook={handleOpenBook}
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
          onUpdateDailyTarget={(mins) => {
            const updated = { ...readingGoal, dailyTargetMinutes: mins };
            setReadingGoal(updated);
            upsertReadingGoalToSupabase(updated);
          }}
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

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} visible={isNavVisible} />
      <Toast message={toastMessage} bottom={bottomSpace - 8 + 12} />
    </View>
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
