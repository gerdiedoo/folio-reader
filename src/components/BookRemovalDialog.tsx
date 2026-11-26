import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppPalette, useAppTheme } from '../AppTheme';
import { type } from '../theme';
import type { BookRemovalResult } from '../lib/bookRemoval';
import { ModalShell } from './ui/ModalShell';

export function BookRemovalDialog({ title, titles, onRemove, onClose }: ({ title: string; titles?: never } | { titles: readonly string[]; title?: never }) & {
  onRemove: () => Promise<BookRemovalResult>; onClose: () => void;
}) {
  const palette = useAppTheme(), styles = useMemo(() => createStyles(palette), [palette]);
  const names = titles ?? [title!], multiple = names.length > 1;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!pending.current) onClose(); };
  const remove = async () => {
    if (!mounted.current || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await onRemove();
      if (!mounted.current) return;
      if (result.removed) onClose(); else setError(result.message);
    } catch { if (mounted.current) setError(`Removal could not be confirmed. Check ${multiple ? 'these books' : 'this book'} in Library before trying again.`); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <ModalShell onClose={close} maxWidth={400}>
    <ScrollView contentContainerStyle={styles.body}>
      <Text accessibilityRole="header" style={styles.title}>{multiple ? `Remove ${names.length} books?` : 'Remove book?'}</Text>
      <Text style={styles.text}>{multiple ? 'Remove these books and their' : `Remove “${names[0]}” and its`} saved files, bookmarks, highlights, notes and vocabulary from this Library.</Text>
      {multiple && names.map((name, index) => <Text key={index} style={styles.text}>• {name}</Text>)}
      <Text style={styles.text}>Export notes or cards you want to keep first. Account removals sync when connected; other devices may keep downloaded files.</Text>
      {error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel={multiple ? 'Keep these books' : 'Keep this book'} accessibilityState={{ disabled: busy }} style={styles.button}><Text style={styles.text}>Cancel</Text></Pressable>
        <Pressable onPress={remove} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove ${multiple ? `${names.length} books` : names[0]} from Library`} accessibilityState={{ disabled: busy, busy }} style={[styles.button, { backgroundColor: palette.danger }]}><Text style={styles.remove}>{busy ? 'Removing…' : multiple ? `Remove ${names.length}` : 'Remove'}</Text></Pressable>
      </View>
    </ScrollView>
  </ModalShell>;
}
const createStyles = (palette: AppPalette) => StyleSheet.create({
  body: { padding: 16, gap: 12 }, title: { ...type.headlineSm, color: palette.onSurface }, text: { ...type.bodyMd, color: palette.onSurface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 48, flexGrow: 1, flexBasis: 120, padding: 10, borderRadius: 8, backgroundColor: palette.surfaceContainer, alignItems: 'center', justifyContent: 'center' }, remove: { ...type.labelMd, color: '#fff' },
});
