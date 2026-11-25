import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppPalette } from '../../AppTheme';
import type { ShelfColumns } from '../../lib/bookShelfLayout';
import { F, type } from '../../theme';
import { Icon } from './Icon';

/** Library and free books share the same visible controls and 48-point targets. */
export const shelfStyles = StyleSheet.create({
  chipRow: { gap: 6 },
  chipTarget: { minHeight: 48, minWidth: 48, justifyContent: 'center' },
  chipFace: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  chipText: { ...type.labelMd, fontSize: 12, lineHeight: 18 },
  sortTarget: { minHeight: 48, minWidth: 48, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  sortText: { fontFamily: F.sans, fontSize: 13, lineHeight: 18 },
  toggle: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 3 },
  track: { position: 'absolute', top: 6, bottom: 6, left: -3, right: -3, borderRadius: 8 },
  toggleTarget: { width: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  toggleFace: { width: 36, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontFamily: F.sansSemi, fontSize: 13, lineHeight: 18 },
  title: { fontFamily: F.serifSemi, fontSize: 19, lineHeight: 24, marginTop: 10 },
  author: { fontFamily: F.sans, fontSize: 14, lineHeight: 20, marginTop: 3 },
  denseTitle: { fontSize: 15, lineHeight: 19, marginTop: 8 },
  denseAuthor: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});

// Pure render helpers keep the exact same controls in both screens.
export function renderShelfChip(palette: AppPalette, label: string, selected: boolean, onPress: () => void) {
  return <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected }} style={shelfStyles.chipTarget}>
    <View pointerEvents="none" style={[shelfStyles.chipFace, { backgroundColor: selected ? palette.primaryContainer : palette.surfaceContainer }]}>
      <Text style={[shelfStyles.chipText, { color: selected ? palette.onPrimaryContainer : palette.onSurface }]}>{label}</Text>
    </View>
  </Pressable>;
}

export function renderShelfSort(palette: AppPalette, label: string, accessibilityLabel: string, selected: boolean, onPress: () => void) {
  return <Pressable key={accessibilityLabel} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ selected }} style={shelfStyles.sortTarget}>
    <Text style={[shelfStyles.sortText, { color: selected ? palette.primary : palette.muted, ...(selected ? { fontFamily: F.sansSemi } : {}) }]}>{label}</Text>
  </Pressable>;
}

export function renderShelfViewOptions(palette: AppPalette, viewMode: 'grid' | 'list', columns: ShelfColumns,
  onViewMode: (mode: 'grid' | 'list') => void, onColumns: (columns: ShelfColumns) => void) {
  return <View style={shelfStyles.toggle}>
    <View pointerEvents="none" style={[shelfStyles.track, { backgroundColor: palette.surfaceContainer }]} />
    {([2, 3] as const).map(count => {
      const selected = viewMode === 'grid' && columns === count;
      return <Pressable key={count} onPress={() => { onColumns(count); onViewMode('grid'); }}
        hitSlop={{ left: 4, right: 4 }}
        accessibilityRole="button" accessibilityLabel={`${count}-column grid`} accessibilityState={{ selected }} style={shelfStyles.toggleTarget}>
        <View pointerEvents="none" style={[shelfStyles.toggleFace, selected && { backgroundColor: palette.surface }]}>
          <Text style={[shelfStyles.toggleText, { color: selected ? palette.primary : palette.muted }]}>{count}</Text>
        </View>
      </Pressable>;
    })}
    <Pressable onPress={() => onViewMode('list')} accessibilityRole="button" accessibilityLabel="List view"
      hitSlop={{ left: 4, right: 4 }}
      accessibilityState={{ selected: viewMode === 'list' }} style={shelfStyles.toggleTarget}>
      <View pointerEvents="none" style={[shelfStyles.toggleFace, viewMode === 'list' && { backgroundColor: palette.surface }]}>
        <Icon name="view_list" size={17} color={viewMode === 'list' ? palette.primary : palette.muted} />
      </View>
    </Pressable>
  </View>;
}
