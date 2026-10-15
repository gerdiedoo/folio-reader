import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { Book, HighlightEntry, LexiconEntry } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface SearchModalProps {
  books: Book[];
  highlights: HighlightEntry[];
  lexicon: LexiconEntry[];
  onClose: () => void;
  onSelectBook: (bookId: string) => void;
  onSelectHighlight: (bookId: string, page: number) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  books,
  highlights,
  lexicon,
  onClose,
  onSelectBook,
  onSelectHighlight,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();

  const matchingBooks = query
    ? books.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
    : [];
  const matchingHighlights = query
    ? highlights.filter(
        (h) =>
          h.text.toLowerCase().includes(q) ||
          (h.note && h.note.toLowerCase().includes(q)) ||
          h.bookTitle.toLowerCase().includes(q)
      )
    : [];
  const matchingLexicon = query
    ? lexicon.filter((l) => l.word.toLowerCase().includes(q) || l.definition.toLowerCase().includes(q))
    : [];

  const nothing =
    matchingBooks.length === 0 && matchingHighlights.length === 0 && matchingLexicon.length === 0;

  return (
    <ModalShell
      onClose={onClose}
      align="top"
      maxWidth={512}
      cardStyle={{ maxHeight: '80%' }}
      avoidAndroidKeyboard={false}
    >
      <View style={styles.top}>
        <Icon name="search" size={22} color={colors.muted} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search titles, authors, quotes, or notes..."
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!query ? (
          <View style={styles.center}>
            <Icon name="travel_explore" size={36} color={colors.secondaryFixedDim} />
            <Text style={styles.centerText}>Type anything to search the Folio archive.</Text>
          </View>
        ) : nothing ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>No results found for “{query}”.</Text>
          </View>
        ) : (
          <>
            {matchingBooks.length > 0 && (
              <View>
                <Text style={styles.section}>BOOKS ({matchingBooks.length})</Text>
                {matchingBooks.map((b) => (
                  <Pressable
                    key={b.id}
                    onPress={() => {
                      onSelectBook(b.id);
                      onClose();
                    }}
                    style={styles.bookRow}
                  >
                    {b.coverUrl ? (
                      <Image source={{ uri: b.coverUrl }} style={styles.thumb} />
                    ) : (
                      <View style={[styles.thumb, { backgroundColor: colors.surfaceContainer }]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookTitle} numberOfLines={1}>
                        {b.title}
                      </Text>
                      <Text style={styles.author}>{b.author}</Text>
                    </View>
                    <Text style={styles.pct}>{b.progressPercent}%</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {matchingHighlights.length > 0 && (
              <View>
                <Text style={styles.section}>QUOTES &amp; MARGINALIA ({matchingHighlights.length})</Text>
                {matchingHighlights.map((h) => (
                  <Pressable
                    key={h.id}
                    onPress={() => {
                      onSelectHighlight(h.bookId, h.page);
                      onClose();
                    }}
                    style={styles.hlCard}
                  >
                    <Text style={styles.hlText} numberOfLines={2}>
                      “{h.text}”
                    </Text>
                    <View style={styles.hlMeta}>
                      <Text style={styles.metaText}>
                        {h.bookTitle} • p. {h.page}
                      </Text>
                      <Text style={[styles.metaText, { color: colors.primary, fontFamily: F.sansSemi }]}>
                        Jump to Reader →
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {matchingLexicon.length > 0 && (
              <View>
                <Text style={styles.section}>LEXICON VOCABULARY ({matchingLexicon.length})</Text>
                {matchingLexicon.map((l) => (
                  <View key={l.id} style={styles.hlCard}>
                    <View style={styles.hlMeta}>
                      <Text style={styles.lexWord}>{l.word}</Text>
                      <Text style={[styles.metaText, { fontStyle: 'italic' }]}>{l.phonetic}</Text>
                    </View>
                    <Text style={styles.lexDef}>{l.definition}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  top: {
    padding: 14,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, fontFamily: F.sans, fontSize: 14, color: colors.onSurface, paddingVertical: 4 },
  clear: { fontFamily: F.sansSemi, fontSize: 12, color: colors.muted },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 16 },
  center: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  centerText: { fontFamily: F.sans, fontSize: 14, color: colors.muted, textAlign: 'center' },
  section: { ...type.labelSm, color: colors.muted, marginBottom: 8 },
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 12 },
  thumb: { width: 32, height: 48, borderRadius: 4 },
  bookTitle: { fontFamily: F.serifSemi, fontSize: 15, color: colors.onSurface },
  author: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  pct: { fontFamily: F.sansSemi, fontSize: 12, color: colors.primary },
  hlCard: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginBottom: 8,
  },
  hlText: { fontFamily: F.serifItalic, fontSize: 14, lineHeight: 19, color: colors.onSurface },
  hlMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  metaText: { fontFamily: F.sans, fontSize: 11, color: colors.muted },
  lexWord: { fontFamily: F.serifSemi, fontSize: 15, color: colors.onSurface },
  lexDef: { fontFamily: F.sans, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 },
});
