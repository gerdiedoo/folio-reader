import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { createAccountRepository } from '../lib/cloudAccount';
import { colors, F, NAV_SPACE, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { Book, HighlightEntry, LexiconEntry } from '../types';
import { HIGHLIGHT_COLORS, highlightTextStyle } from '../lib/highlights';
import { browseNotebook, type NotebookFilter } from '../lib/notebookBrowser';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { choiceAppearance, choiceStyles } from './ui/choiceStyles';
import { ModalShell } from './ui/ModalShell';

interface NotebookViewProps {
  cloud: ReturnType<typeof createAccountRepository>;
  highlightStatus: 'loading' | 'ready' | 'error';
  highlightNotice: string | null;
  highlightBusy: boolean;
  onRetryHighlights: () => void;
  vocabularyStatus: 'loading' | 'ready' | 'error';
  vocabularyNotice: string | null;
  vocabularyBusy: boolean;
  onRetryVocabulary: () => void;
  books: Book[];
  highlights: HighlightEntry[];
  lexicon: LexiconEntry[];
  onJumpToReader: (bookId: string, pageNumber: number) => void;
  onAddReflectionNote: (highlightId: string, noteText: string) => Promise<boolean>;
  onDeleteHighlight: (id: string) => Promise<boolean>;
  onAddHighlight: (hl: Omit<HighlightEntry, 'id' | 'dateAdded'>) => Promise<boolean>;
  onOpenFlashcard: (item: LexiconEntry) => void;
  showToast: (msg: string) => void;
  bottomInset: number;
  deletionNotice?: string | null;
  onRetryDeletions?: () => void;
}

export const NotebookView: React.FC<NotebookViewProps> = ({
  cloud,
  highlightStatus,
  highlightNotice,
  highlightBusy,
  onRetryHighlights,
  vocabularyStatus,
  vocabularyNotice,
  vocabularyBusy,
  onRetryVocabulary,
  books,
  highlights,
  lexicon,
  onJumpToReader,
  onAddReflectionNote,
  onDeleteHighlight,
  onAddHighlight,
  onOpenFlashcard,
  showToast,
  bottomInset,
  deletionNotice, onRetryDeletions,
}) => {
  const colors = useAppTheme();
  const { upsertBookToSupabase, upsertHighlightToSupabase, upsertLexiconToSupabase } = cloud;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selectedBookId, setSelectedBookId] = useState<string>('all');
  const [isBookPickerOpen, setIsBookPickerOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotebookFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingNoteId, setAddingNoteId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState('Never');
  const [isSyncing, setIsSyncing] = useState(false);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const pendingHighlight = useRef(false);
  const writeHighlight = async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (pendingHighlight.current) return false;
    pendingHighlight.current = true; setSavingHighlight(true);
    try { return await operation(); }
    finally { pendingHighlight.current = false; setSavingHighlight(false); }
  };
  const notesUnavailable = highlightStatus !== 'ready' || highlightBusy || savingHighlight;
  const vocabularyUnavailable = vocabularyStatus !== 'ready' || vocabularyBusy;
  const archivesUnavailable = notesUnavailable || vocabularyUnavailable;

  const [isNewHighlightOpen, setIsNewHighlightOpen] = useState(false);
  const [quoteBookId, setQuoteBookId] = useState<string | null>(null);
  const [newQuoteText, setNewQuoteText] = useState('');
  const [newQuoteNote, setNewQuoteNote] = useState('');
  const [newQuoteColor, setNewQuoteColor] = useState(HIGHLIGHT_COLORS[0]);

  const uploadPending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const selectedBook = selectedBookId === 'all' ? undefined : books.find((b) => b.id === selectedBookId);
  const selectedBookLabel = selectedBookId === 'all' ? 'All Books' : selectedBook?.title ?? 'Selected book unavailable';
  // Never attach a quote to a different book if its selected book disappears.
  const targetBook = selectedBookId === 'all' ? books[0] : selectedBook;
  const quoteBook = books.find(book => book.id === quoteBookId);
  const { bookHighlights, bookLexicon, highlights: filteredHighlights, lexicon: filteredLexicon } = useMemo(
    () => browseNotebook(books, highlights, lexicon, { bookId: selectedBookId, filter: activeFilter, query: searchQuery }),
    [books, highlights, lexicon, selectedBookId, activeFilter, searchQuery],
  );
  const showHighlights = activeFilter !== 'lexicon';
  const showVocabulary = activeFilter === 'all' || activeFilter === 'lexicon';
  const relevantError = (showHighlights && highlightStatus === 'error') || (showVocabulary && vocabularyStatus === 'error');
  const relevantLoading = (showHighlights && highlightStatus === 'loading') || (showVocabulary && vocabularyStatus === 'loading');
  const resultsReady = !relevantError && !relevantLoading;
  const hasSearch = Boolean(searchQuery.trim());
  const constrained = hasSearch || activeFilter !== 'all' || selectedBookId !== 'all';
  const count = filteredHighlights.length + filteredLexicon.length;
  const resultSummary = [
    ...(showHighlights ? [`${filteredHighlights.length} ${filteredHighlights.length === 1 ? 'highlight' : 'highlights'}`] : []),
    ...(showVocabulary ? [`${filteredLexicon.length} ${filteredLexicon.length === 1 ? 'vocabulary card' : 'vocabulary cards'}`] : []),
    ...(relevantError ? ['Some saved entries unavailable'] : relevantLoading ? ['Loading saved entries…'] : []),
  ].join(' · ');
  const emptyTitle = selectedBookId !== 'all' && !selectedBook ? 'Selected book unavailable'
    : hasSearch ? 'No matching entries'
    : activeFilter === 'notes' ? 'No reflection notes yet'
    : activeFilter === 'highlights' ? 'No highlights yet'
    : activeFilter === 'lexicon' ? 'No vocabulary cards yet'
    : selectedBookId !== 'all' ? 'No entries for this book yet' : 'Your Notebook is empty';
  const emptyDescription = selectedBookId !== 'all' && !selectedBook ? 'Choose another book, or show all entries.'
    : hasSearch ? 'Try other words, or clear your search and filters.'
    : activeFilter === 'notes' ? 'Add a reflection to a saved highlight.'
    : activeFilter === 'lexicon' ? 'Save a word from the reader to build your vocabulary.'
    : 'Save a passage while reading, or add a new quote.';
  const resetBrowsing = () => { setSearchQuery(''); setActiveFilter('all'); setSelectedBookId('all'); setIsBookPickerOpen(false); };
  const bookChoices = [
    { id: 'all', title: 'All Books' },
    ...books.map(book => ({ id: book.id, title: book.title })),
    ...(selectedBookId !== 'all' && !selectedBook ? [{ id: selectedBookId, title: 'Selected book unavailable' }] : []),
  ];

  const handleExportAll = async () => {
    if (archivesUnavailable) { showToast('Wait for saved notes and vocabulary to load before exporting.'); return; }
    let md = `# Folio Marginalia Archive: ${selectedBookLabel}\n\n`;
    md += `*Exported on ${new Date().toLocaleDateString()} via Folio Reader*\n\n---\n\n`;

    bookHighlights.forEach((h, idx) => {
      md += `### Highlight ${idx + 1} (${h.chapter}, p. ${h.page})\n`;
      md += `> "${h.text}"\n\n`;
      if (h.note) md += `**Reader Marginalia**: ${h.note}\n\n`;
      md += `*Color: ${h.colorName} • ${h.dateAdded}*\n\n`;
    });

    if (bookLexicon.length > 0) {
      md += `## Vocabulary & Lexicon Cards\n\n`;
      bookLexicon.forEach((l) => {
        md += `### ${l.word} ${l.phonetic} (${l.partOfSpeech})\n${l.definition}\n\n> ${l.contextPassage}\n\n`;
      });
    }

    try {
      const file = new File(Paths.cache, `Folio_Marginalia_${Date.now()}_${Math.random().toString(36).slice(2)}.md`);
      if (!file.exists) file.create();
      file.write(md);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/markdown',
          dialogTitle: 'Export Folio marginalia',
        });
        showToast('Markdown export ready');
      } else {
        await Clipboard.setStringAsync(md);
        showToast('Sharing unavailable — Markdown copied to clipboard');
      }
    } catch (err) {
      console.warn('Export failed:', err);
      showToast('Export failed');
    }
  };

  const handleCopyQuote = async (text: string) => {
    await Clipboard.setStringAsync(text);
    showToast('Quote copied for Readwise / Obsidian');
  };

  const handleSyncCloud = async () => {
    if (!mounted.current || archivesUnavailable || uploadPending.current) return;
    uploadPending.current = true; setIsSyncing(true);
    try {
      const results = await Promise.all([
        ...books.map(upsertBookToSupabase), ...highlights.map(upsertHighlightToSupabase), ...lexicon.map(upsertLexiconToSupabase),
      ]);
      if (!mounted.current) return;
      const failed = results.filter(ok => !ok).length;
      if (!failed) { setLastSyncTime('Just now'); showToast('Uploaded current records to your account.'); }
      else showToast(`${failed} records could not be uploaded. Check your sign-in and connection, then try again. Device copies are kept.`);
    } catch { if (mounted.current) showToast('Cloud upload could not be confirmed. Device copies are kept. Check your connection and try again.'); }
    finally { uploadPending.current = false; if (mounted.current) setIsSyncing(false); }
  };

  const playPronunciation = (word: string) => {
    Speech.stop();
    Speech.speak(word, { language: 'en', rate: 0.85, pitch: 1.0 });
    showToast(`Pronouncing: ${word}`);
  };

  const handleCreateHighlight = async () => {
    if (!newQuoteText.trim() || !quoteBook || notesUnavailable) return;
    const saved = await writeHighlight(() => onAddHighlight({
      bookId: quoteBook.id,
      bookTitle: quoteBook.title,
      chapter: quoteBook.currentChapter,
      page: quoteBook.currentPage,
      loc: quoteBook.currentLoc,
      colorName: newQuoteColor.name,
      colorHex: newQuoteColor.hex,
      text: newQuoteText.trim(),
      note: newQuoteNote.trim() || undefined,
    }));
    if (!saved) return;
    setNewQuoteText('');
    setNewQuoteNote('');
    setIsNewHighlightOpen(false);
    showToast('Highlight saved on this device');
  };

  const filters: { id: NotebookFilter; label: string; icon?: React.ComponentProps<typeof Icon>['name'] }[] = [
    { id: 'all', label: 'All Entries' },
    { id: 'highlights', label: 'Highlights' },
    { id: 'notes', label: 'Notes' },
    { id: 'lexicon', label: 'Lexicon Cards', icon: 'translate' },
  ];

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: NAV_SPACE + bottomInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Title row */}
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>Notebook</Text>
        <Pressable
          onPress={() => { if (!notesUnavailable && targetBook) { setQuoteBookId(targetBook.id); setIsNewHighlightOpen(true); } }}
          disabled={notesUnavailable || !targetBook}
          accessibilityRole="button"
          accessibilityLabel="New quote"
          accessibilityState={{ disabled: notesUnavailable || !targetBook }}
          style={choiceStyles.target}
        >
          <View style={[choiceStyles.face, choiceAppearance(colors, true)]} pointerEvents="none">
            <Icon name="add" size={18} color={colors.onPrimaryContainer} />
            <Text style={styles.newBtnText}>New Quote</Text>
          </View>
        </Pressable>
      </View>

      {highlightStatus === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.hubBody}>Loading saved highlights…</Text> : null}
      {highlightNotice ? <View style={styles.hub}>
        <Text accessibilityLiveRegion="polite" style={styles.hubBody}>{highlightNotice}</Text>
        <Pressable onPress={onRetryHighlights} disabled={highlightBusy || highlightStatus === 'loading'} accessibilityRole="button" accessibilityLabel="Retry loading saved highlights" accessibilityState={{ disabled: highlightBusy || highlightStatus === 'loading', busy: highlightStatus === 'loading' }} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={styles.configText}>Try again</Text>
        </Pressable>
      </View> : null}
      {vocabularyStatus === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.hubBody}>Loading saved vocabulary…</Text> : null}
      {vocabularyNotice ? <View style={styles.hub}>
        <Text accessibilityLiveRegion="polite" style={styles.hubBody}>{vocabularyNotice}</Text>
        <Pressable onPress={onRetryVocabulary} disabled={vocabularyBusy || vocabularyStatus === 'loading'} accessibilityRole="button" accessibilityLabel="Retry loading saved vocabulary" accessibilityState={{ disabled: vocabularyBusy || vocabularyStatus === 'loading', busy: vocabularyStatus === 'loading' }} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={styles.configText}>Try again</Text>
        </Pressable>
      </View> : null}

      {/* Search */}
      <View style={styles.searchBox}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput
          value={searchQuery}
          onChangeText={value => setSearchQuery(value.slice(0, 200))}
          maxLength={200}
          accessibilityLabel="Search Notebook"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          placeholder="Search quotes, notes or words"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {searchQuery.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear Notebook search" onPress={() => setSearchQuery('')} style={styles.smallAction}>
          <Icon name="close" size={18} color={colors.muted} />
        </Pressable>}
      </View>

      {/* Book picker */}
      <View>
        <Pressable onPress={() => setIsBookPickerOpen(!isBookPickerOpen)} style={styles.picker}
          accessibilityRole="button" accessibilityLabel={`Filter Notebook by book: ${selectedBookLabel}`} accessibilityState={{ expanded: isBookPickerOpen }}>
          <Icon name="menu_book" size={20} color={colors.primary} />
          <Text style={styles.pickerText} numberOfLines={1}>
            {selectedBookLabel}
          </Text>
          <Icon name="expand_more" size={22} color={colors.muted} />
        </Pressable>
        {isBookPickerOpen && (
          <View style={styles.pickerList}>
            {bookChoices.map((b) => (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                accessibilityLabel={b.id === 'all' ? 'Show Notebook entries for all books' : `Show Notebook entries for ${b.title}`}
                accessibilityState={{ selected: selectedBookId === b.id }}
                onPress={() => {
                  setSelectedBookId(b.id);
                  setIsBookPickerOpen(false);
                }}
                style={[styles.pickerItem, selectedBookId === b.id && { backgroundColor: colors.surfaceContainer }]}
              >
                <Text
                  style={[styles.pickerItemText, selectedBookId === b.id && { color: colors.primary, fontFamily: F.sansSemi }]}
                  numberOfLines={1}
                >
                  {b.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {filters.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            icon={f.icon}
            active={activeFilter === f.id}
            onPress={() => setActiveFilter(f.id)}
          />
        ))}
      </ScrollView>

      <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{resultSummary}</Text>
      {resultsReady && count === 0 && (
        <View style={styles.emptyCard}>
          <Text accessibilityRole="header" style={styles.emptyMain}>{emptyTitle}</Text>
          <Text style={styles.emptySub}>{emptyDescription}</Text>
          {constrained && <Pressable onPress={resetBrowsing} accessibilityRole="button" accessibilityLabel="Show all Notebook entries" style={styles.smallAction}>
            <Text style={styles.configText}>Show all entries</Text>
          </Pressable>}
        </View>
      )}

      {/* Highlights */}
      {filteredHighlights.map((hl) => (
        <View key={hl.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={[styles.tag, { backgroundColor: highlightTextStyle(hl.colorHex).backgroundColor }]}>
              <View style={[styles.tagDot, { backgroundColor: hl.colorHex }]} />
              <Text style={[styles.tagText, { color: highlightTextStyle(hl.colorHex).color }]}>{hl.colorName}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {hl.chapter} · p. {hl.page}
            </Text>
          </View>

          <View style={[styles.quoteWrap, { borderLeftColor: hl.colorHex }]}>
            <Text style={styles.quote}>“{hl.text}”</Text>
          </View>

          {hl.note && addingNoteId !== hl.id ? (
            <View style={styles.noteBox}>
              <View style={styles.noteHead}>
                <View style={styles.noteHeadLeft}>
                  <Icon name="history_edu" size={14} color={colors.primary} />
                  <Text style={styles.noteHeadText}>READER MARGINALIA</Text>
                </View>
                <Pressable
                  onPress={() => {
                    setAddingNoteId(hl.id);
                    setNewNoteContent(hl.note || '');
                  }}
                >
                  <Text style={styles.editNote}>Edit Note</Text>
                </Pressable>
              </View>
              <Text style={styles.noteBody}>{hl.note}</Text>
            </View>
          ) : addingNoteId === hl.id ? (
            <View style={styles.noteBox}>
              <TextInput
                autoFocus
                multiline
                value={newNoteContent}
                accessibilityLabel="Reflection note"
                editable={!savingHighlight}
                onChangeText={setNewNoteContent}
                placeholder="Write reader reflection note..."
                placeholderTextColor={colors.muted}
                style={styles.noteInput}
              />
              <View style={styles.noteActions}>
                <Pressable onPress={() => setAddingNoteId(null)} disabled={savingHighlight} style={{ padding: 6 }}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    if (newNoteContent.trim()) {
                      const saved = await writeHighlight(() => onAddReflectionNote(hl.id, newNoteContent.trim()));
                      if (!saved) return;
                      showToast('Reflection note saved on this device');
                    }
                    setAddingNoteId(null);
                  }}
                  disabled={notesUnavailable || !newNoteContent.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Save reflection note"
                  accessibilityState={{ disabled: notesUnavailable || !newNoteContent.trim(), busy: savingHighlight }}
                  style={styles.saveNote}
                >
                  <Text style={styles.saveNoteText}>{savingHighlight ? 'Saving…' : 'Save Note'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setAddingNoteId(hl.id);
                setNewNoteContent('');
              }}
              style={styles.addNote}
              accessibilityRole="button"
              accessibilityLabel="Add reflection note"
              disabled={notesUnavailable}
              accessibilityState={{ disabled: notesUnavailable }}
            >
              <Icon name="post_add" size={15} color={colors.muted} />
              <Text style={styles.addNoteText}>Add reader reflection note</Text>
            </Pressable>
          )}

          <View style={styles.cardFoot}>
            <Text style={styles.date}>{hl.dateAdded}</Text>
            <View style={styles.footActions}>
              <Pressable onPress={() => handleCopyQuote(hl.text)} hitSlop={6} accessibilityLabel="Copy quote">
                <Icon name="content_copy" size={18} color={colors.muted} />
              </Pressable>
              <Pressable onPress={async () => {
                if (await writeHighlight(() => onDeleteHighlight(hl.id))) showToast('Highlight removed on this device');
              }} disabled={notesUnavailable} accessibilityRole="button" accessibilityState={{ disabled: notesUnavailable }} hitSlop={6} accessibilityLabel="Delete highlight">
                <Icon name="delete_outline" size={19} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => onJumpToReader(hl.bookId, hl.page)} style={styles.jump}>
                <Text style={styles.jumpText}>Jump to Reader</Text>
                <Icon name="open_in_new" size={14} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        </View>
      ))}

      {/* Lexicon */}
      {filteredLexicon.map((lex) => (
        <View key={lex.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <View style={[styles.tag, { backgroundColor: colors.primaryFixed }]}>
                <Icon name="translate" size={13} color={colors.tertiary} />
                <Text style={styles.tagText}>Lexicon Card</Text>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {lex.chapter}
              </Text>
            </View>
            <Pressable
              onPress={() => playPronunciation(lex.word)}
              accessibilityLabel={`Pronounce ${lex.word}`}
              style={styles.speak}
            >
              <Icon name="volume_up" size={18} color={colors.primary} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <Text style={styles.lexWord}>{lex.word}</Text>
            <Text style={styles.lexPhon}>
              {lex.phonetic} • {lex.partOfSpeech}
            </Text>
          </View>
          <Text style={styles.lexDef}>{lex.definition}</Text>

          <View style={styles.noteBox}>
            <Text style={styles.ctxLabel}>IN CONTEXT PASSAGE</Text>
            <Text style={styles.ctxText}>{lex.contextPassage}</Text>
          </View>

          <View style={styles.cardFoot}>
            <Text style={styles.date}>
              Mastery Level: {lex.masteryLevel} / 5
              {lex.masteryLevel < 3 ? <Text style={{ color: colors.primary }}>  (Review soon)</Text> : null}
            </Text>
            <Pressable onPress={() => onOpenFlashcard(lex)} disabled={vocabularyUnavailable} accessibilityRole="button" accessibilityLabel={`Review vocabulary card for ${lex.word}`} accessibilityState={{ disabled: vocabularyUnavailable }} style={styles.flashBtn}>
              <Icon name="style" size={15} color={colors.primary} />
              <Text style={styles.flashText}>Flashcard</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {/* Sync hub */}
      {deletionNotice && <View style={{ padding: 16, gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={styles.statusText}>{deletionNotice}</Text>
        {onRetryDeletions && <Pressable accessibilityRole="button" accessibilityLabel="Retry account removals" onPress={onRetryDeletions} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>Retry removals</Text></Pressable>}
      </View>}
      <View style={styles.hub}>
        <View style={styles.hubHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="hub" size={22} color={colors.primary} />
            <Text style={styles.hubTitle}>Export &amp; cloud upload</Text>
          </View>
        </View>
        <Text style={styles.hubBody}>
          Export highlights and vocabulary for {selectedBookId === 'all' ? 'all books' : selectedBookLabel}. Search and entry filters do not limit the export.
          {'\n'}Cloud upload sends all current records in this reading space. Last upload: {lastSyncTime}. Review changes from other devices before uploading.
        </Text>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={handleExportAll} accessibilityRole="button" accessibilityLabel="Export notes" disabled={archivesUnavailable} accessibilityState={{ disabled: archivesUnavailable }} style={[styles.hubBtn, { backgroundColor: colors.primaryContainer }]}>
            <Icon name="output" size={18} color="#fff" />
            <Text style={[styles.hubBtnText, { color: '#fff' }]}>Export ({bookHighlights.length + bookLexicon.length})</Text>
          </Pressable>
          <Pressable
            onPress={handleSyncCloud}
            disabled={isSyncing || archivesUnavailable}
            accessibilityRole="button"
            accessibilityLabel="Upload current records"
            accessibilityState={{ disabled: isSyncing || archivesUnavailable, busy: isSyncing }}
            style={[styles.hubBtn, { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
          >
            <Icon name="sync" size={18} color={colors.primary} spin={isSyncing} />
            <Text style={[styles.hubBtnText, { color: colors.onSurface }]}>
              {isSyncing ? 'Uploading…' : 'Upload to account'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* New highlight dialog */}
      {isNewHighlightOpen && (
        <ModalShell onClose={() => setIsNewHighlightOpen(false)} maxWidth={420}>
          <View style={styles.dlgHead}>
            <Text style={styles.dlgTitle}>Record New Highlight</Text>
            <Pressable onPress={() => setIsNewHighlightOpen(false)} hitSlop={8}>
              <Icon name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            {quoteBook ? <Text style={styles.meta}>Filed under: {quoteBook.title}</Text>
              : <Text accessibilityRole="alert" style={styles.hubBody}>This book is unavailable. Your draft is kept; close this dialog and choose a book before saving.</Text>}
            <TextInput
              multiline
              value={newQuoteText}
              accessibilityLabel="Quote text"
              editable={!savingHighlight}
              onChangeText={setNewQuoteText}
              placeholder="Paste or write the quote..."
              placeholderTextColor={colors.muted}
              style={[styles.dlgInput, { minHeight: 90 }]}
            />
            <TextInput
              multiline
              value={newQuoteNote}
              accessibilityLabel="Quote reflection"
              editable={!savingHighlight}
              onChangeText={setNewQuoteNote}
              placeholder="Personal note or thought..."
              placeholderTextColor={colors.muted}
              style={[styles.dlgInput, { minHeight: 64 }]}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <Pressable
                  key={c.name}
                  onPress={() => setNewQuoteColor(c)}
                  disabled={savingHighlight}
                  accessibilityLabel={c.label}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c.hex },
                    newQuoteColor.name === c.name && { borderWidth: 2, borderColor: colors.primary },
                  ]}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Pressable onPress={() => setIsNewHighlightOpen(false)} disabled={savingHighlight} style={{ padding: 10 }}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateHighlight}
                disabled={!newQuoteText.trim() || !quoteBook || notesUnavailable}
                accessibilityRole="button"
                accessibilityLabel="Save new highlight"
                accessibilityState={{ disabled: !newQuoteText.trim() || !quoteBook || notesUnavailable, busy: savingHighlight }}
                style={[styles.saveNote, { paddingVertical: 10 }, !newQuoteText.trim() && { opacity: 0.5 }]}
              >
                <Text style={styles.saveNoteText}>{savingHighlight ? 'Saving…' : 'Save Highlight'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </ModalShell>
      )}

    </ScrollView>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  scroll: { gap: 12, paddingTop: 4 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { ...type.headlineMd, color: colors.onSurface },
  newBtnText: { ...type.labelMd, color: colors.onPrimaryContainer },
  smallAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  resultCount: { ...type.bodySm, color: colors.muted },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, minHeight: 48, paddingVertical: 10, fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceLow,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderMid,
  },
  pickerText: { flex: 1, fontFamily: F.sansSemi, fontSize: 14, color: colors.onSurface },
  pickerList: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  pickerItemText: { fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  chipRow: { gap: 6, paddingRight: 6 },

  emptyCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    gap: 4,
  },
  emptyMain: { ...type.bodyMd, color: colors.onSurface, textAlign: 'center' },
  emptySub: { ...type.bodySm, color: colors.muted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderMid,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { ...type.labelSm, color: colors.tertiary },
  meta: { ...type.bodySm, color: colors.muted, flexShrink: 1 },
  quoteWrap: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 12 },
  quote: { ...type.editorialMd, fontFamily: F.serifItalic, color: colors.onSurface },
  noteBox: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  noteHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteHeadText: { ...type.labelSm, color: colors.primary },
  editNote: { fontFamily: F.sans, fontSize: 10, color: colors.muted, textDecorationLine: 'underline' },
  noteBody: { ...type.bodySm, lineHeight: 18, color: colors.onSurfaceVariant },
  noteInput: {
    minHeight: 60,
    fontFamily: F.sans,
    fontSize: 13,
    color: colors.onSurface,
    textAlignVertical: 'top',
    padding: 0,
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 8 },
  cancel: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  saveNote: { backgroundColor: colors.primaryContainer, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  saveNoteText: { fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
  addNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  addNoteText: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  date: { fontFamily: F.sans, fontSize: 11, color: colors.muted },
  footActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  jump: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  jumpText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.primary },

  speak: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lexWord: { fontFamily: F.serifMedium, fontSize: 24, color: colors.onSurface },
  lexPhon: { fontFamily: F.sans, fontSize: 12, color: colors.muted, fontStyle: 'italic' },
  lexDef: { ...type.bodyMd, color: colors.onSurface, lineHeight: 21, marginBottom: 12 },
  ctxLabel: { fontFamily: F.sansSemi, fontSize: 10, letterSpacing: 0.8, color: colors.muted, marginBottom: 4 },
  ctxText: { ...type.editorialMd, fontSize: 16, fontFamily: F.serifItalic, color: colors.onSurface },
  flashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  flashText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },

  hub: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderMid,
  },
  hubHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hubTitle: { ...type.headlineSm, fontSize: 18, lineHeight: 22, color: colors.onSurface },
  hubBody: { ...type.bodySm, lineHeight: 18, color: colors.muted },
  configBtn: { alignSelf: 'flex-start', backgroundColor: colors.primaryFixed, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  configText: { fontFamily: F.sansSemi, fontSize: 11, color: colors.primary },
  hubBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  hubBtnText: { ...type.labelMd },

  dlgHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
  },
  dlgTitle: { ...type.headlineSm, fontSize: 19, color: colors.onSurface },
  dlgInput: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    fontFamily: F.sans,
    fontSize: 14,
    color: colors.onSurface,
    textAlignVertical: 'top',
  },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  codeScroll: { maxHeight: 260, backgroundColor: '#31302c', borderRadius: 10 },
  code: { fontFamily: F.mono, fontSize: 10.5, lineHeight: 15, color: '#f4f0e9', padding: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusText: { ...type.bodySm, color: colors.muted, flex: 1 },
});
