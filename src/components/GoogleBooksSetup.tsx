import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../AppTheme';
import { type } from '../theme';
import type { GoogleBooksKeyStore } from '../lib/googleBooksKeyStore';
import { ModalShell } from './ui/ModalShell';

interface Props {
  store: GoogleBooksKeyStore;
  hasKey: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry(): void;
  onSaved(key: string | null): void;
  onClose(): void;
}
export function GoogleBooksSetup({ store, hasKey, loading, loadError, onRetry, onSaved, onClose }: Props) {
  const palette = useAppTheme();
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!pending.current) onClose(); };
  const change = async (remove: boolean) => {
    if (pending.current || loading || loadError) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const key = remove ? (await store.remove(), null) : await store.save(draft);
      if (mounted.current) { setDraft(''); onSaved(key); onClose(); }
    } catch { if (mounted.current) setError('The change could not be confirmed on this device. Please retry.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <ModalShell onClose={close} align="center" cardStyle={{ height: '80%', maxHeight: 560 }}>
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text accessibilityRole="header" style={[type.headlineSm, { color: palette.onSurface }]}>Google Books setup</Text>
      <Text style={[type.bodySm, { color: palette.muted }]}>Use your own Google Books API key. It is stored securely on this device for this reading space, and excluded from backups and cloud sync.</Text>
      <Text style={[type.bodySm, { color: palette.onSurface }]}>{loading ? 'Checking saved key…' : loadError ? 'The saved key could not be checked.' : hasKey ? 'A key is saved on this device. Enter a new key to replace it.' : 'No key is saved for this reading space.'}</Text>
      {loadError && <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading Google Books key" style={styles.button}><Text style={{ color: palette.primary }}>Retry</Text></Pressable>}
      <TextInput value={draft} onChangeText={setDraft} accessibilityLabel="Google Books API key" placeholder="Paste your API key" placeholderTextColor={palette.muted}
        secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" editable={!busy && !loading && !loadError} maxLength={200}
        style={[styles.input, { color: palette.onSurface, borderColor: palette.border }]} />
      <Text style={[type.bodySm, { color: palette.muted }]}>Enable the Books API for your key in Google Cloud. Your Google project’s quotas apply.</Text>
      {error ? <Text accessibilityRole="alert" style={[type.bodySm, { color: palette.onSurface }]}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable onPress={() => void change(false)} disabled={busy || loading || loadError || !/^[a-zA-Z0-9_-]{20,200}$/.test(draft.trim())}
          accessibilityRole="button" accessibilityLabel="Save Google Books key" accessibilityState={{ busy, disabled: busy || loading || loadError || !/^[a-zA-Z0-9_-]{20,200}$/.test(draft.trim()) }} style={styles.button}><Text style={{ color: palette.primary }}>{busy ? 'Working…' : 'Save key'}</Text></Pressable>
        {hasKey && <Pressable onPress={() => void change(true)} disabled={busy || loading || loadError} accessibilityRole="button" accessibilityLabel="Remove Google Books key" accessibilityState={{ disabled: busy || loading || loadError }} style={styles.button}><Text style={{ color: palette.primary }}>Remove key</Text></Pressable>}
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Close Google Books setup" accessibilityState={{ disabled: busy }} style={styles.button}><Text style={{ color: palette.muted }}>Cancel</Text></Pressable>
      </View>
    </ScrollView>
  </ModalShell>;
}
const styles = StyleSheet.create({ button: { minHeight: 48, minWidth: 48, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' }, input: { ...type.bodyMd, minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12 } });
