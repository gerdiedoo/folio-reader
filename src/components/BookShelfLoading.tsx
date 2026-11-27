import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme, type AppPalette } from '../AppTheme';

/** Placeholder geometry follows the same columns, cover ratio and spacing as books. */
export function BookShelfLoading({ viewMode, columns, cardWidth, rows, more = false }: {
  viewMode: 'grid' | 'list'; columns: number; cardWidth: number; rows?: number; more?: boolean;
}) {
  const palette = useAppTheme(), styles = useMemo(() => createStyles(palette), [palette]);
  const count = Math.max(1, Math.min(3, Math.floor(columns) || 1));
  return <View accessibilityRole="progressbar" accessibilityLabel={more ? 'Loading more books' : 'Loading books'} accessibilityState={{ busy: true }}
    accessibilityValue={{ text: viewMode === 'grid' ? `${count}-column grid` : 'List' }} style={styles.container}>
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none" style={styles.container}>
      {Array.from({ length: rows ?? (viewMode === 'grid' ? 3 : 5) }, (_, row) => viewMode === 'grid'
        ? <View key={row} style={styles.gridRow}>
          {Array.from({ length: count }, (_, column) => <View key={column} testID="book-loading-grid-card" style={{ width: cardWidth }}>
            <View testID="book-loading-cover" style={[styles.placeholder, styles.cover]} />
            <View style={[styles.placeholder, styles.title, count === 3 && styles.denseTitle]} />
            <View style={[styles.placeholder, styles.titleLine, count === 3 && styles.denseTitle]} />
            <View style={[styles.placeholder, styles.author]} />
          </View>)}
        </View>
        : <View key={row} testID="book-loading-list-row" style={styles.listRow}>
          <View testID="book-loading-cover" style={[styles.placeholder, styles.listCover]} />
          <View style={styles.listCopy}><View style={[styles.placeholder, styles.listTitle]} /><View style={[styles.placeholder, styles.listAuthor]} /><View style={[styles.placeholder, styles.listMeta]} /></View>
        </View>)}
    </View>
  </View>;
}
const createStyles = (palette: AppPalette) => StyleSheet.create({
  container: { gap: 14 }, placeholder: { backgroundColor: palette.surfaceHigh, borderRadius: 4 },
  gridRow: { flexDirection: 'row', gap: 16, marginBottom: 4 }, cover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10 },
  title: { height: 14, width: '92%', marginTop: 10 }, titleLine: { height: 14, width: '65%', marginTop: 5 }, denseTitle: { height: 12 },
  author: { height: 10, width: '55%', marginTop: 6 },
  listRow: { flexDirection: 'row', gap: 10, padding: 10, borderRadius: 12, backgroundColor: palette.surfaceLow },
  listCover: { width: 64, height: 96, borderRadius: 6 }, listCopy: { flex: 1, gap: 8, paddingTop: 4 },
  listTitle: { height: 16, width: '75%' }, listAuthor: { height: 12, width: '45%' }, listMeta: { height: 12, width: '30%' },
});
