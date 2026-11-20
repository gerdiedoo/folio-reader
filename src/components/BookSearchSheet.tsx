import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../AppTheme';
import { useBookSearch } from '../lib/useBookSearch';
import type { BookSearchMatch } from '../lib/bookSearch';
import { HIGHLIGHT_COLORS, highlightTextStyle } from '../lib/highlights';
import { type } from '../theme';
import type { BookContentPage } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface Props {
  title: string;
  pages: BookContentPage[];
  onClose: () => void;
  onSelect: (match: BookSearchMatch) => void;
}

export function BookSearchSheet({ title, pages, onClose, onSelect }: Props) {
  const palette = useAppTheme();
  const [query, setQuery] = useState('');
  const result = useBookSearch(pages, query);
  const status = result.status === 'idle' ? 'Search this book’s downloaded text. Works offline.'
    : result.status === 'searching' ? 'Searching this book…'
    : result.status === 'error' ? result.error
    : result.hasMore ? 'Showing the first 100 matches. Refine your search for more.'
    : `${result.matches.length} ${result.matches.length === 1 ? 'match' : 'matches'}`;
  const display = (text: string) => text.replace(/\s+/g, ' ');
  return (
    <ModalShell onClose={onClose} align="bottom" maxWidth={560} cardStyle={{ maxHeight: '85%' }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[type.headlineSm, { color: palette.onSurface }]}>Find in book</Text>
          <Text numberOfLines={1} style={[type.bodySm, { color: palette.muted }]}>{title}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close find in book" style={styles.control}>
          <Icon name="close" size={22} color={palette.onSurface} />
        </Pressable>
      </View>
      <View style={[styles.inputRow, { backgroundColor: palette.surfaceContainer }]}>
        <Icon name="search" size={22} color={palette.muted} />
        <TextInput
          autoFocus
          accessibilityLabel="Find text in this book"
          placeholder="Word or phrase"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          maxLength={200}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: palette.onSurface }]}
        />
        {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear book search" style={styles.control}>
          <Icon name="close" size={20} color={palette.onSurface} />
        </Pressable> : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.status, { color: palette.muted }]}>{status}</Text>
      {result.status === 'searching' ? <ActivityIndicator accessibilityLabel="Searching book text" color={palette.primary} style={styles.loading} /> : null}
      {result.status === 'error' ? <Pressable onPress={result.retry} accessibilityRole="button" accessibilityLabel="Retry book search" style={styles.control}>
        <Text style={[type.labelMd, { color: palette.primary }]}>Try again</Text>
      </Pressable> : null}
      {result.status === 'ready' && !result.matches.length ? <Text style={[styles.status, { color: palette.onSurface }]}>No matches. Try a shorter phrase. Phrases must stay within one paragraph.</Text> : null}
      <FlatList
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={result.matches}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item }) => <Pressable
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.chapterTitle}, passage ${item.pageNumber}. ${display(item.before + item.match + item.after)}. Open matching passage.`}
          style={[styles.result, { borderColor: palette.border }]}
        >
          <Text style={[type.labelMd, { color: palette.primary }]}>{item.chapterTitle} · Passage {item.pageNumber}</Text>
          <Text style={[type.bodyMd, { color: palette.onSurface }]}>
            {item.leadingEllipsis ? '…' : ''}{display(item.before)}<Text style={highlightTextStyle(HIGHLIGHT_COLORS[0].hex)}>{display(item.match)}</Text>{display(item.after)}{item.trailingEllipsis ? '…' : ''}
          </Text>
        </Pressable>}
        ListFooterComponent={result.matches.length ? <Text style={[styles.status, { color: palette.muted }]}>Opens the matching passage.</Text> : null}
      />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, paddingLeft: 12, borderRadius: 12 },
  input: { ...type.bodyMd, flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 12 },
  status: { ...type.bodySm, paddingHorizontal: 16, paddingVertical: 10 },
  loading: { padding: 12 },
  list: { maxHeight: 400, flexShrink: 1, flexGrow: 0 },
  result: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 14, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
