import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../AppTheme';
import { type } from '../theme';
import { Bookmark } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface Props {
  bookmarks: Bookmark[];
  currentPage: number;
  status: 'loading' | 'ready' | 'error';
  saving: boolean;
  onClose: () => void;
  onSelect: (bookmark: Bookmark) => void;
  onRemove: (id: string) => void;
  onRetry: () => void;
}

export function BookmarkSheet({ bookmarks, currentPage, status, saving, onClose, onSelect, onRemove, onRetry }: Props) {
  const palette = useAppTheme();
  return (
    <ModalShell onClose={onClose} align="bottom" maxWidth={560} cardStyle={{ maxHeight: '80%' }}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.onSurface }]}>Bookmarks</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close bookmarks" style={styles.control}>
          <Icon name="close" size={22} color={palette.onSurface} />
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: palette.muted }]}>
        Saved on this device. Opens the start of each passage.
      </Text>
      {status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading bookmarks" color={palette.primary} style={styles.empty} />
        : status === 'error' ? (
          <View style={styles.empty}>
            <Text style={[styles.body, { color: palette.onSurface }]}>Couldn't load bookmarks. Your saved data has not been replaced.</Text>
            <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
              <Text style={[styles.body, { color: palette.primary }]}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            style={styles.list}
            data={bookmarks}
            keyExtractor={item => item.id}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={[styles.body, { color: palette.onSurface }]}>No bookmarks in this book yet.</Text>
                <Text style={[styles.body, { color: palette.muted }]}>Tap the bookmark icon in Scroll or Pages mode to save a passage.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, { borderTopColor: palette.border }]}>
                <Pressable
                  onPress={() => onSelect(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open bookmark, ${item.chapterTitle}, location ${item.locNumber}. ${item.excerpt}`}
                  accessibilityState={{ selected: item.pageNumber === currentPage }}
                  style={styles.open}
                >
                  <Text style={[styles.body, { color: palette.primary }]}>{item.chapterTitle} · Loc {item.locNumber}</Text>
                  <Text numberOfLines={3} style={[styles.body, { color: palette.onSurface }]}>{item.excerpt}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onRemove(item.id)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove bookmark at location ${item.locNumber}`}
                  accessibilityState={{ disabled: saving }}
                  style={[styles.control, saving && { opacity: 0.4 }]}
                >
                  <Icon name="delete" size={22} color={palette.danger} />
                </Pressable>
              </View>
            )}
          />
        )}
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingTop: 8 },
  title: { ...type.headlineSm, flex: 1 },
  hint: { ...type.bodySm, paddingHorizontal: 20, paddingBottom: 16 },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  list: { maxHeight: 400, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingRight: 8 },
  open: { flex: 1, minHeight: 48, padding: 16, gap: 6 },
  body: { ...type.bodyMd },
  empty: { padding: 24, gap: 12 },
  retry: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
});
