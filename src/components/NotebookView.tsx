import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  SUPABASE_SQL_SCHEMA,
  testSupabaseConnection,
  upsertBookToSupabase,
  upsertHighlightToSupabase,
  upsertLexiconToSupabase,
} from '../lib/supabase';
import { colors, F, NAV_SPACE, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { Book, HighlightEntry, LexiconEntry } from '../types';
import { HIGHLIGHT_COLORS } from './PassageSheet';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface NotebookViewProps {
  books: Book[];
  highlights: HighlightEntry[];
  lexicon: LexiconEntry[];
  onJumpToReader: (bookId: string, pageNumber: number) => void;
  onAddReflectionNote: (highlightId: string, noteText: string) => void;
  onDeleteHighlight: (id: string) => void;
  onAddHighlight: (hl: Omit<HighlightEntry, 'id' | 'dateAdded'>) => void;
  onOpenFlashcard: (item: LexiconEntry) => void;
  showToast: (msg: string) => void;
  bottomInset: number;
}

type NotebookFilter = 'all' | 'highlights' | 'notes' | 'lexicon';

export const NotebookView: React.FC<NotebookViewProps> = ({
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
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selectedBookId, setSelectedBookId] = useState<string>('all');
  const [isBookPickerOpen, setIsBookPickerOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotebookFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingNoteId, setAddingNoteId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState('Never');
  const [isSyncing, setIsSyncing] = useState(false);

  const [isNewHighlightOpen, setIsNewHighlightOpen] = useState(false);
  const [newQuoteText, setNewQuoteText] = useState('');
  const [newQuoteNote, setNewQuoteNote] = useState('');
  const [newQuoteColor, setNewQuoteColor] = useState(HIGHLIGHT_COLORS[0]);

  const [isSchemaOpen, setIsSchemaOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState('Ready to test');

  const selectedBook = selectedBookId === 'all' ? undefined : books.find((b) => b.id === selectedBookId);
  // Used when recording a manual quote with no specific book chosen
  const targetBook = selectedBook ?? books[0];

  const q = searchQuery.toLowerCase();
  const bookHighlights = highlights.filter((h) => selectedBookId === 'all' || h.bookId === selectedBookId);
  const bookLexicon = lexicon.filter((l) => selectedBookId === 'all' || l.bookId === selectedBookId);

  const filteredHighlights = bookHighlights.filter((h) => {
    const matches =
      h.text.toLowerCase().includes(q) ||
      (h.note && h.note.toLowerCase().includes(q)) ||
      h.chapter.toLowerCase().includes(q);
    if (!matches) return false;
    if (activeFilter === 'notes') return Boolean(h.note);
    if (activeFilter === 'lexicon') return false;
    return true;
  });

  const filteredLexicon = bookLexicon.filter((l) => {
    const matches = l.word.toLowerCase().includes(q) || l.definition.toLowerCase().includes(q);
    if (!matches) return false;
    return activeFilter === 'all' || activeFilter === 'lexicon';
  });

  const handleExportAll = async () => {
    let md = `# Folio Marginalia Archive: ${selectedBook ? selectedBook.title : 'All Books'}\n\n`;
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
      const file = new File(Paths.cache, `Folio_Marginalia_${selectedBook?.id ?? 'all'}.md`);
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
    setIsSyncing(true);
    const conn = await testSupabaseConnection();
    setDbStatus(conn.message);
    // Push everything local → Supabase (the web version only tested the connection)
    const results = await Promise.all([
      ...books.map(upsertBookToSupabase),
      ...highlights.map(upsertHighlightToSupabase),
      ...lexicon.map(upsertLexiconToSupabase),
    ]);
    setIsSyncing(false);
    const failed = results.filter((ok) => !ok).length;
    if (failed === 0) {
      setLastSyncTime('Just now');
      showToast('Synced with Supabase database!');
    } else {
      showToast(`${failed} item(s) failed to sync — check Supabase Config`);
    }
  };

  const handleTestSupabase = async () => {
    setDbStatus('Testing connection...');
    const res = await testSupabaseConnection();
    setDbStatus(res.message);
  };

  const playPronunciation = (word: string) => {
    Speech.stop();
    Speech.speak(word, { language: 'en', rate: 0.85, pitch: 1.0 });
    showToast(`Pronouncing: ${word}`);
  };

  const handleCreateHighlight = () => {
    if (!newQuoteText.trim() || !targetBook) return;
    onAddHighlight({
      bookId: targetBook.id,
      bookTitle: targetBook.title,
      chapter: targetBook.currentChapter,
      page: targetBook.currentPage,
      loc: targetBook.currentLoc,
      colorName: newQuoteColor.name,
      colorHex: newQuoteColor.hex,
      text: newQuoteText.trim(),
      note: newQuoteNote.trim() || undefined,
    });
    setNewQuoteText('');
    setNewQuoteNote('');
    setIsNewHighlightOpen(false);
    showToast('New highlight saved to archive');
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
        <Text style={styles.title}>Marginalia</Text>
        <Pressable
          onPress={() => (targetBook ? setIsNewHighlightOpen(true) : showToast('Import a book first'))}
          style={styles.newBtn}
        >
          <Icon name="add" size={18} color="#fff" />
          <Text style={styles.newBtnText}>New Quote</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search quotes, marginalia, or keywords..."
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>

      {/* Book picker */}
      <View>
        <Pressable onPress={() => setIsBookPickerOpen(!isBookPickerOpen)} style={styles.picker}>
          <Icon name="menu_book" size={20} color={colors.primary} />
          <Text style={styles.pickerText} numberOfLines={1}>
            {selectedBook ? selectedBook.title : 'All Books'}
          </Text>
          <Icon name="expand_more" size={22} color={colors.muted} />
        </Pressable>
        {isBookPickerOpen && (
          <View style={styles.pickerList}>
            {[{ id: 'all', title: 'All Books' }, ...books.map((b) => ({ id: b.id, title: b.title }))].map((b) => (
              <Pressable
                key={b.id}
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
            activeBg={f.id === 'lexicon' ? colors.tertiaryContainer : colors.primaryContainer}
          />
        ))}
      </ScrollView>

      {/* Highlights */}
      {filteredHighlights.length === 0 && activeFilter !== 'lexicon' && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyMain}>No highlights recorded yet.</Text>
          <Text style={styles.emptySub}>Long-press a paragraph while reading, or tap “New Quote” above.</Text>
        </View>
      )}

      {filteredHighlights.map((hl) => (
        <View key={hl.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={[styles.tag, { backgroundColor: `${hl.colorHex}80` }]}>
              <View style={[styles.tagDot, { backgroundColor: hl.colorHex }]} />
              <Text style={styles.tagText}>{hl.colorName}</Text>
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
                onChangeText={setNewNoteContent}
                placeholder="Write reader reflection note..."
                placeholderTextColor={colors.muted}
                style={styles.noteInput}
              />
              <View style={styles.noteActions}>
                <Pressable onPress={() => setAddingNoteId(null)} style={{ padding: 6 }}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (newNoteContent.trim()) {
                      onAddReflectionNote(hl.id, newNoteContent.trim());
                      showToast('Reflection note saved');
                    }
                    setAddingNoteId(null);
                  }}
                  style={styles.saveNote}
                >
                  <Text style={styles.saveNoteText}>Save Note</Text>
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
              <Pressable onPress={() => onDeleteHighlight(hl.id)} hitSlop={6} accessibilityLabel="Delete highlight">
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
            <Pressable onPress={() => onOpenFlashcard(lex)} style={styles.flashBtn}>
              <Icon name="style" size={15} color={colors.primary} />
              <Text style={styles.flashText}>Flashcard</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {/* Sync hub */}
      <View style={styles.hub}>
        <View style={styles.hubHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="hub" size={22} color={colors.primary} />
            <Text style={styles.hubTitle}>Folio Synchronization Hub</Text>
          </View>
        </View>
        <Text style={styles.hubBody}>
          Export clean markdown files with bibliographic footnotes, or push your highlights and vocabulary
          directly to your Supabase cloud database. Last sync: {lastSyncTime}.
        </Text>
        <Pressable onPress={() => setIsSchemaOpen(true)} style={styles.configBtn}>
          <Text style={styles.configText}>Supabase Config</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={handleExportAll} style={[styles.hubBtn, { backgroundColor: colors.primaryContainer }]}>
            <Icon name="output" size={18} color="#fff" />
            <Text style={[styles.hubBtnText, { color: '#fff' }]}>Export All ({bookHighlights.length})</Text>
          </Pressable>
          <Pressable
            onPress={handleSyncCloud}
            disabled={isSyncing}
            style={[styles.hubBtn, { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
          >
            <Icon name="sync" size={18} color={colors.primary} spin={isSyncing} />
            <Text style={[styles.hubBtnText, { color: colors.onSurface }]}>
              {isSyncing ? 'Syncing...' : 'Sync to Supabase'}
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
            {targetBook ? <Text style={styles.meta}>Filed under: {targetBook.title}</Text> : null}
            <TextInput
              multiline
              value={newQuoteText}
              onChangeText={setNewQuoteText}
              placeholder="Paste or write the quote..."
              placeholderTextColor={colors.muted}
              style={[styles.dlgInput, { minHeight: 90 }]}
            />
            <TextInput
              multiline
              value={newQuoteNote}
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
              <Pressable onPress={() => setIsNewHighlightOpen(false)} style={{ padding: 10 }}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateHighlight}
                disabled={!newQuoteText.trim()}
                style={[styles.saveNote, { paddingVertical: 10 }, !newQuoteText.trim() && { opacity: 0.5 }]}
              >
                <Text style={styles.saveNoteText}>Save Highlight</Text>
              </Pressable>
            </View>
          </ScrollView>
        </ModalShell>
      )}

      {/* Supabase schema dialog */}
      {isSchemaOpen && (
        <ModalShell onClose={() => setIsSchemaOpen(false)} maxWidth={520} cardStyle={{ maxHeight: '90%' }}>
          <View style={styles.dlgHead}>
            <Text style={styles.dlgTitle}>Supabase Database Setup</Text>
            <Pressable onPress={() => setIsSchemaOpen(false)} hitSlop={8}>
              <Icon name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={styles.hubBody}>
              Open the Supabase SQL Editor, paste this script, and run it to create the tables Folio syncs to.
            </Text>
            <ScrollView style={styles.codeScroll} nestedScrollEnabled>
              <Text selectable style={styles.code}>
                {SUPABASE_SQL_SCHEMA}
              </Text>
            </ScrollView>
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>{dbStatus}</Text>
              <Pressable onPress={handleTestSupabase}>
                <Text style={styles.configText}>Test connection</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(SUPABASE_SQL_SCHEMA);
                  showToast('SQL script copied to clipboard');
                }}
                style={[styles.hubBtn, { backgroundColor: colors.surfaceContainer }]}
              >
                <Icon name="content_copy" size={17} color={colors.primary} />
                <Text style={[styles.hubBtnText, { color: colors.onSurface }]}>Copy SQL</Text>
              </Pressable>
              <Pressable onPress={() => setIsSchemaOpen(false)} style={[styles.hubBtn, { backgroundColor: colors.primaryContainer }]}>
                <Text style={[styles.hubBtnText, { color: '#fff' }]}>Done</Text>
              </Pressable>
            </View>
          </ScrollView>
        </ModalShell>
      )}
    </ScrollView>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  scroll: { gap: 16, paddingTop: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.headlineLg, color: colors.onSurface },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  newBtnText: { ...type.labelMd, color: '#fff' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceLow,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderMid,
  },
  pickerText: { flex: 1, fontFamily: F.serifMedium, fontSize: 17, color: colors.onSurface },
  pickerList: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 12 },
  pickerItemText: { fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  chipRow: { gap: 8, paddingRight: 8 },

  emptyCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    gap: 4,
  },
  emptyMain: { ...type.bodyMd, color: colors.muted },
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
