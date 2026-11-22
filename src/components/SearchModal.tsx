import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { Book, HighlightEntry, LexiconEntry, SourceAnchor } from '../types';
import { canOpenSavedPassage, searchArchive, type ArchiveSearchFilter, type ArchiveSearchResult, type ArchiveSearchSection, type SearchBookPages, type SearchLoadStatus } from '../lib/archiveSearch';
import { libraryBookStatus } from '../lib/libraryBrowser';
import { BookCover } from './BookCover';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface SearchModalProps {
  books: Book[];
  bookPages: SearchBookPages;
  availableBookIds?: string[];
  globalCoverStyle: 'image' | 'typographic';
  highlights: HighlightEntry[];
  lexicon: LexiconEntry[];
  libraryStatus: SearchLoadStatus;
  highlightStatus: SearchLoadStatus;
  vocabularyStatus: SearchLoadStatus;
  onRetryHighlights: () => void;
  onRetryVocabulary: () => void;
  onShowLibrary: () => void;
  onClose: () => void;
  onSelectBook: (bookId: string) => void;
  onSelectHighlight: (bookId: string, page: number, anchor?: SourceAnchor) => void;
  onSelectVocabulary: (entry: LexiconEntry) => void;
}

const FILTERS: { id: ArchiveSearchFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'books', label: 'Books' },
  { id: 'quotes', label: 'Quotes & notes' }, { id: 'vocabulary', label: 'Vocabulary' },
];

export const SearchModal: React.FC<SearchModalProps> = ({
  books, bookPages, availableBookIds, globalCoverStyle, highlights, lexicon, libraryStatus, highlightStatus, vocabularyStatus,
  onRetryHighlights, onRetryVocabulary, onShowLibrary, onClose, onSelectBook, onSelectHighlight, onSelectVocabulary,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ArchiveSearchFilter>('all');
  const results = useMemo(() => searchArchive(books, highlights, lexicon, query, filter), [books, highlights, lexicon, query, filter]);
  const hasQuery = Boolean(query.trim());
  const sources = [
    { relevant: results.categories.books, name: 'Books', status: libraryStatus, retry: undefined },
    { relevant: results.categories.quotes, name: 'Quotes and notes', status: highlightStatus, retry: onRetryHighlights },
    { relevant: results.categories.vocabulary, name: 'Vocabulary', status: vocabularyStatus, retry: onRetryVocabulary },
  ].filter(source => source.relevant && source.status !== 'ready');
  const selectBook = (bookId: string) => { onClose(); onSelectBook(bookId); };
  const showLibrary = () => { onClose(); onShowLibrary(); };

  const renderResult = ({ item }: { item: ArchiveSearchResult }) => {
    if (item.kind === 'book') {
      const book = item.book;
      return <Pressable onPress={() => selectBook(book.id)} accessibilityRole="button"
        accessibilityLabel={`Open book details for ${book.title} by ${book.author}`} accessibilityHint={libraryBookStatus(book)} style={styles.bookRow}>
        <BookCover book={book} style={book.coverStyle ?? globalCoverStyle} size="compact" containerStyle={styles.thumb} />
        <View style={styles.resultCopy}>
          <Text style={styles.bookTitle}>{book.title}</Text>
          <Text style={styles.meta}>{book.author}</Text>
          <Text style={styles.meta}>{libraryBookStatus(book)}</Text>
        </View>
        <Icon name="chevron_right" size={18} color={colors.muted} />
      </Pressable>;
    }
    if (item.kind === 'quote') {
      const quote = item.quote;
      const loaded = Object.hasOwn(bookPages, quote.bookId);
      const canJump = libraryStatus === 'ready' && (loaded ? canOpenSavedPassage(books, bookPages, quote.bookId, quote.page, quote.anchor)
        : Boolean(availableBookIds?.includes(quote.bookId)) && books.some(book => book.id === quote.bookId) && Number.isSafeInteger(quote.page) && quote.page > 0);
      const destination = canJump ? `Open passage ${quote.page}` : libraryStatus === 'loading' ? 'Checking saved reading text…'
        : libraryStatus === 'error' ? 'Saved library unavailable' : 'Passage unavailable on this device';
      return <View style={styles.card}>
        <Text style={styles.quote} numberOfLines={3} accessibilityLabel={quote.text}>{quote.text}</Text>
        {quote.note?.trim() ? <Text style={styles.note} numberOfLines={2} accessibilityLabel={`Note: ${quote.note}`}>Note: {quote.note}</Text> : null}
        <Text style={styles.meta}>{quote.bookTitle} · {quote.chapter} · Passage {quote.page}</Text>
        <Pressable onPress={() => { if (canJump) { onClose(); if (quote.anchor) onSelectHighlight(quote.bookId, quote.page, quote.anchor); else onSelectHighlight(quote.bookId, quote.page); } }}
          accessibilityRole="button" accessibilityLabel={`Open saved quote from ${quote.bookTitle} at passage ${quote.page}`}
          disabled={!canJump} accessibilityState={{ disabled: !canJump }} style={styles.action}>
          <Text style={[styles.actionText, { color: canJump ? colors.primary : colors.muted }]}>{destination}</Text>
        </Pressable>
        {!canJump && libraryStatus !== 'loading' && <Pressable onPress={showLibrary} accessibilityRole="button" accessibilityLabel={`Find EPUB for ${quote.bookTitle} in Library`} style={styles.action}>
          <Text style={styles.actionText}>Check book in Library</Text>
        </Pressable>}
      </View>;
    }
    const entry = item.vocabulary;
    const canReview = vocabularyStatus === 'ready';
    return <Pressable onPress={() => { if (canReview) { onClose(); onSelectVocabulary(entry); } }}
      accessibilityRole="button" accessibilityLabel={`Review vocabulary card for ${entry.word}`} accessibilityHint={entry.definition}
      disabled={!canReview} accessibilityState={{ disabled: !canReview }} style={styles.card}>
      <Text style={styles.bookTitle}>{entry.word}</Text>
      <Text style={styles.meta}>{[entry.phonetic, entry.partOfSpeech].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.definition} numberOfLines={3}>{entry.definition}</Text>
      <Text style={styles.actionText}>{canReview ? 'Review card' : 'Saved vocabulary unavailable'}</Text>
    </Pressable>;
  };

  return (
    <ModalShell onClose={onClose} align="top" maxWidth={512} cardStyle={{ height: '80%', maxHeight: '80%' }}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Search</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close archive search" style={styles.iconAction}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.searchBox}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput autoFocus value={query} onChangeText={value => setQuery(value.slice(0, 200))} maxLength={200}
          accessibilityLabel="Search saved books, quotes, notes and vocabulary" placeholder="Search your saved entries"
          placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} />
        {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear archive search" style={styles.iconAction}>
          <Icon name="close" size={18} color={colors.muted} />
        </Pressable>}
      </View>
      <SectionList<ArchiveSearchResult, ArchiveSearchSection>
        style={styles.results} sections={results.sections} keyExtractor={item => `${item.kind}:${item.id}`} renderItem={renderResult}
        renderSectionHeader={({ section }) => <Text accessibilityRole="header" style={styles.section}>{section.title} ({section.data.length})</Text>}
        stickySectionHeadersEnabled={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        initialNumToRender={8} windowSize={5} contentContainerStyle={styles.body}
        ListHeaderComponent={<View style={styles.listHeader}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FILTERS.map(option => <Chip key={option.id} label={option.label} active={filter === option.id} onPress={() => setFilter(option.id)} />)}
          </ScrollView>
          {sources.map(source => <View key={source.name} style={styles.notice}>
            <Text accessibilityLiveRegion="polite" style={styles.meta}>{source.status === 'loading' ? `Loading ${source.name.toLowerCase()}…` : `${source.name} could not be loaded.${source.retry ? '' : ' Restart Folio before changing books.'}`}</Text>
            {source.retry && source.status === 'error' && <Pressable onPress={source.retry} accessibilityRole="button" accessibilityLabel={`Retry loading ${source.name.toLowerCase()} for search`} style={styles.action}>
              <Text style={styles.actionText}>Try again</Text>
            </Pressable>}
          </View>)}
          {hasQuery && <Text accessibilityLiveRegion="polite" style={styles.meta}>{results.count} {results.count === 1 ? 'result' : 'results'}{sources.length ? ' shown · some entries still unavailable' : ''}</Text>}
        </View>}
        ListEmptyComponent={<View style={styles.empty}>
          <Text style={styles.meta}>{!hasQuery ? 'Search saved titles, authors, quotes, notes or vocabulary. Use Find in book to search reading text.'
            : sources.length ? 'Results may be incomplete until the selected archives load.' : 'No matches. Try other words or another category.'}</Text>
          {hasQuery && <Pressable onPress={() => { setQuery(''); setFilter('all'); }} accessibilityRole="button" accessibilityLabel="Reset archive search and category" style={styles.action}>
            <Text style={styles.actionText}>Clear search and category</Text>
          </Pressable>}
        </View>}
      />
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.surfaceLow },
  title: { ...type.headlineSm, color: colors.onSurface, flexShrink: 1 },
  iconAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginVertical: 8, paddingLeft: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceContainer },
  input: { ...type.bodyMd, flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 10, color: colors.onSurface },
  results: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  listHeader: { gap: 8, paddingBottom: 8 }, chips: { gap: 6 },
  notice: { padding: 10, borderRadius: 8, backgroundColor: colors.surfaceContainer },
  empty: { paddingVertical: 20, alignItems: 'center', gap: 8 },
  section: { ...type.labelSm, color: colors.muted, marginTop: 8, marginBottom: 8 },
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 64 },
  thumb: { width: 40, height: 60, flexShrink: 0 }, resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  bookTitle: { ...type.bodyMd, color: colors.onSurface }, meta: { ...type.bodySm, color: colors.muted },
  card: { padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSoft, backgroundColor: colors.surfaceLow, marginBottom: 8, gap: 6, minHeight: 48 },
  quote: { ...type.editorialMd, fontSize: 15, lineHeight: 21, color: colors.onSurface },
  note: { ...type.bodySm, color: colors.onSurfaceVariant }, definition: { ...type.bodyMd, color: colors.onSurface },
  action: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { ...type.labelMd, color: colors.primary },
});
