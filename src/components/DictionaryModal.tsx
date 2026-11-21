import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LexiconEntry } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';
import { useDictionaryLookup } from '../lib/useDictionaryLookup';

interface DictionaryModalProps {
  initialWord?: string;
  contextPassage?: string;
  /** Book the lookup originated from, so saved cards are filed under it. */
  bookId: string;
  source?: { page: number; chapter: string; anchor?: LexiconEntry['anchor'] };
  onClose: () => void;
  onSaveToLexicon: (entry: Omit<LexiconEntry, 'id'>) => Promise<boolean>;
  saveStatus?: 'loading' | 'ready' | 'error';
  saveBusy?: boolean;
  showToast: (msg: string) => void;
}

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  initialWord = '',
  contextPassage = '',
  bookId, source,
  onClose,
  onSaveToLexicon,
  saveStatus = 'ready',
  saveBusy = false,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [searchTerm, setSearchTerm] = useState(initialWord);
  const { lookup, retry } = useDictionaryLookup(searchTerm);
  const key = lookup.key;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingSave = useRef(false);
  const changeTerm = (value: string) => { if (!pendingSave.current) { setSaveError(null); setSearchTerm(value); } };
  const speechRequest = useRef(0);
  useEffect(() => {
    const stop = () => { speechRequest.current++; void Speech.stop().catch(() => {}); };
    stop();
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    return () => { stop(); subscription.remove(); };
  }, [key]);

  const entry = lookup.status === 'found' ? lookup.entry : null;

  const handlePronounce = async () => {
    if (!key) return;
    const request = ++speechRequest.current;
    const current = () => speechRequest.current === request && AppState.currentState === 'active';
    try {
      await Speech.stop();
      if (!current()) return;
      Speech.speak(key, {
        language: 'en', rate: 0.85,
        onStart: () => { if (current()) showToast(`Pronouncing: ${key}`); },
        onError: () => { if (current()) showToast('Pronunciation is unavailable on this device.'); },
      });
    } catch { if (current()) showToast('Pronunciation is unavailable on this device.'); }
  };

  const handleSave = async () => {
    if (!entry || pendingSave.current || saveStatus !== 'ready' || saveBusy) return;
    pendingSave.current = true; setSaving(true); setSaveError(null);
    try {
      const saved = await onSaveToLexicon({
        bookId,
        word: key.replace(/^./u, letter => letter.toUpperCase()),
        phonetic: entry.phonetic,
        partOfSpeech: entry.partOfSpeech,
        definition: entry.definition,
        contextPassage: contextPassage || entry.example,
        chapter: source?.chapter || 'Reader Lexicon',
        ...(source ? { page: source.page, anchor: source.anchor } : {}),
        masteryLevel: 1,
      });
      if (saved) { showToast(`Saved "${key}" on this device`); onClose(); }
      else setSaveError('Couldn’t save this card on this device. Your definition is still open; try again.');
    } catch {
      setSaveError('Couldn’t save this card on this device. Try again.');
      showToast('Couldn’t save this card on this device. Try again.');
    } finally { pendingSave.current = false; setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={448} cardStyle={{ maxHeight: '85%' }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="menu_book" size={22} color={colors.primary} />
          <Text accessibilityRole="header" style={styles.headerTitle}>LEXICON &amp; DICTIONARY</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close dictionary" style={styles.closeBtn}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            autoFocus={!initialWord}
            value={searchTerm}
            editable={!saving}
            onChangeText={changeTerm}
            accessibilityLabel="English dictionary word"
            placeholder="Look up an English word..."
            maxLength={80}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchTerm ? <Pressable onPress={() => changeTerm('')} disabled={saving} accessibilityRole="button" accessibilityLabel="Clear dictionary word" style={styles.closeBtn}>
            <Icon name="close" size={20} color={colors.muted} />
          </Pressable> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.wordRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.word}>{searchTerm}</Text>
            {entry ? (
              <Text style={styles.phonetic}>
                {[entry.phonetic, entry.partOfSpeech].filter(Boolean).join(' • ')}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={handlePronounce} style={[styles.speakBtn, !key && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel="Pronounce English word" disabled={!key} accessibilityState={{ disabled: !key }}>
            <Icon name="volume_up" size={20} color={colors.primary} />
          </Pressable>
        </View>

        {lookup.status === 'idle' && <Text style={styles.note}>Type an English word. Online definitions require an internet connection; a few bundled words work offline.</Text>}
        {lookup.status === 'loading' && <Text accessibilityLiveRegion="polite" style={styles.note}>Looking up “{key}”…</Text>}
        {lookup.status === 'missing' && (
          <Text accessibilityLiveRegion="polite" style={styles.note}>No English definition found for “{key}”. Check the spelling or try the base form of the word.</Text>
        )}
        {lookup.status === 'error' && (
          <View style={{ gap: 8 }}>
            <Text accessibilityLiveRegion="polite" style={styles.note}>{lookup.message}</Text>
            <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Retry dictionary lookup" style={styles.retryBtn}>
              <Text style={[type.labelMd, { color: colors.primary }]}>Try again</Text>
            </Pressable>
          </View>
        )}

        {entry && (
          <>
            <Text style={styles.note}>{lookup.status === 'found' && lookup.source === 'bundled' ? 'Bundled English definition · available offline' : 'English definition · Free Dictionary API'}</Text>
            <View>
              <Text style={styles.section}>DEFINITION</Text>
              <Text style={styles.definition}>{entry.definition}</Text>
            </View>

            {entry.example && (
              <View style={styles.exampleBox}>
                <Text style={styles.section}>DICTIONARY EXAMPLE</Text>
                <Text style={styles.example}>“{entry.example}”</Text>
              </View>
            )}

            {entry.synonyms.length > 0 && (
              <View>
                <Text style={[styles.section, { marginBottom: 6 }]}>SYNONYMS</Text>
                <View style={styles.synRow}>
                  {entry.synonyms.map((s) => (
                    <Pressable key={s} onPress={() => changeTerm(s)} disabled={saving} accessibilityRole="button" accessibilityLabel={`Look up ${s}`} style={styles.synChip}>
                      <Text style={styles.synText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
        {contextPassage ? <View style={styles.exampleBox}>
          <Text style={styles.section}>SELECTED BOOK PASSAGE</Text>
          <Text style={styles.example}>“{contextPassage}”</Text>
        </View> : null}
      </ScrollView>
      {saveError ? <Text style={[styles.note, { paddingHorizontal: 16, paddingBottom: 8 }]}>{saveError}</Text> : null}

      {saveStatus !== 'ready' ? <Text accessibilityLiveRegion="polite" style={[styles.note, { paddingHorizontal: 16, paddingBottom: 8 }]}>
        {saveStatus === 'loading' ? 'Loading saved vocabulary…' : 'Saved vocabulary could not be read. Use Try again in Notebook before saving.'}
      </Text> : null}

      <View style={styles.footer}>
        <Pressable onPress={onClose} disabled={saving} accessibilityRole="button" style={styles.retryBtn}>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel="Save definition to Lexicon Cards"
          accessibilityState={{ disabled: !entry || saving || saveBusy || saveStatus !== 'ready', busy: saving }}
          disabled={!entry || saving || saveBusy || saveStatus !== 'ready'}
          style={[styles.saveBtn, (!entry || saving || saveBusy || saveStatus !== 'ready') && { opacity: 0.45 }]}
        >
          <Icon name="bookmark_add" size={16} color="#fff" />
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save to Lexicon Cards'}</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  header: {
    padding: 16,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { ...type.labelSm, flexShrink: 1, color: colors.muted, letterSpacing: 1 },
  closeBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { padding: 12, backgroundColor: colors.surfaceContainer },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minHeight: 48, paddingVertical: 8, fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  body: { padding: 20, gap: 16 },
  wordRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  word: { fontFamily: F.serifMedium, fontSize: 28, lineHeight: 34, color: colors.onSurface, textTransform: 'capitalize' },
  phonetic: { fontFamily: F.sans, fontSize: 13, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  speakBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { ...type.bodyMd, color: colors.muted },
  section: { ...type.labelSm, color: colors.muted, marginBottom: 4 },
  definition: { fontFamily: F.sans, fontSize: 15, lineHeight: 23, color: colors.onSurface },
  exampleBox: {
    backgroundColor: colors.surfaceLow,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  example: { fontFamily: F.serifItalic, fontSize: 16, lineHeight: 22, color: colors.onSurface },
  synRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  synChip: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.surfaceContainer },
  synText: { fontFamily: F.sans, fontSize: 12, color: colors.onSurface },
  footer: {
    gap: 8,
    padding: 12,
    backgroundColor: colors.surfaceLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dismiss: { fontFamily: F.sansSemi, fontSize: 12, color: colors.muted },
  retryBtn: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  saveBtn: {
    minHeight: 48,
    maxWidth: '100%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  saveText: { flexShrink: 1, fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
});
