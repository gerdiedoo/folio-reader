import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppPalette, useAppTheme } from '../AppTheme';
import { type } from '../theme';
import type { BookRemovalResult } from '../lib/bookRemoval';
import { ModalShell } from './ui/ModalShell';

export function BookRemovalDialog({ title, onRemove, onClose }: {
  title: string; onRemove: () => Promise<BookRemovalResult>; onClose: () => void;
}) {
  const palette = useAppTheme(), styles = useMemo(() => createStyles(palette), [palette]);
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
    } catch { if (mounted.current) setError('Removal could not be confirmed. Check this book in Library before trying again.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <ModalShell onClose={close} maxWidth={400}>
    <ScrollView contentContainerStyle={styles.body}>
      <Text accessibilityRole="header" style={styles.title}>Remove book?</Text>
      <Text style={styles.text}>Remove “{title}” and its saved files, bookmarks, highlights, notes and vocabulary from this Library.</Text>
      <Text style={styles.text}>Export notes or cards you want to keep first. Cloud cleanup is attempted when signed in; an unremoved cloud copy may return after reloading.</Text>
      {error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Keep this book" accessibilityState={{ disabled: busy }} style={styles.button}><Text style={styles.text}>Cancel</Text></Pressable>
        <Pressable onPress={remove} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove ${title} from Library`} accessibilityState={{ disabled: busy, busy }} style={[styles.button, { backgroundColor: palette.danger }]}><Text style={styles.remove}>{busy ? 'Removing…' : 'Remove'}</Text></Pressable>
      </View>
    </ScrollView>
  </ModalShell>;
}
const createStyles = (palette: AppPalette) => StyleSheet.create({
  body: { padding: 16, gap: 12 }, title: { ...type.headlineSm, color: palette.onSurface }, text: { ...type.bodyMd, color: palette.onSurface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 48, flexGrow: 1, flexBasis: 120, padding: 10, borderRadius: 8, backgroundColor: palette.surfaceContainer, alignItems: 'center', justifyContent: 'center' }, remove: { ...type.labelMd, color: '#fff' },
});
