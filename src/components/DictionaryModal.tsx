import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LexiconEntry } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface DictionaryModalProps {
  initialWord?: string;
  contextPassage?: string;
  /** Book the lookup originated from, so saved cards are filed under it. */
  bookId: string;
  onClose: () => void;
  onSaveToLexicon: (entry: Omit<LexiconEntry, 'id'>) => void;
  showToast: (msg: string) => void;
}

interface DictEntry {
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  synonyms: string[];
  example: string;
}

/** Instant offline entries for a few literary words. */
const LOCAL_DICTIONARY: Record<string, DictEntry> = {
  supercilious: {
    phonetic: '/ˌsuː.pɚˈsɪl.i.əs/',
    partOfSpeech: 'adjective',
    definition:
      'Behaving or looking as though one thinks one is superior to others; haughtily contemptuous or disdainful.',
    synonyms: ['haughty', 'disdainful', 'condescending', 'patronizing', 'imperious'],
    example:
      'There was nothing remotely supercilious in his demeanor, yet one was invariably left feeling quite humbled.',
  },
  quietude: {
    phonetic: '/ˈkwaɪ.ə.tuːd/',
    partOfSpeech: 'noun',
    definition: 'A state of calmness, peacefulness, or tranquility.',
    synonyms: ['serenity', 'repose', 'tranquility', 'calm', 'peacefulness'],
    example: 'I felt the extraordinary quietude peculiar to this part of the country.',
  },
  salvers: {
    phonetic: '/ˈsæl.vɚz/',
    partOfSpeech: 'noun (plural)',
    definition:
      'Trays, typically made of silver, on which letters, visiting cards, or refreshments are formally presented.',
    synonyms: ['trays', 'platters'],
    example: 'The silent corridors, the polished silver salvers, and the grand library doors.',
  },
  posture: {
    phonetic: '/ˈpɑːs.tʃɚ/',
    partOfSpeech: 'verb',
    definition: 'Behave in a way that is intended to impress or mislead others.',
    synonyms: ['pose', 'strike an attitude', 'dissemble', 'affect'],
    example: 'Greatness is discovered in precisely this refusal to posture.',
  },
};

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; entry: DictEntry }
  | { status: 'missing' }
  | { status: 'error' };

async function fetchDefinition(word: string, signal: AbortSignal): Promise<DictEntry | null> {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    { signal }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`);
  const data: any[] = await res.json();
  const first = data?.[0];
  if (!first) return null;

  const meaning = first.meanings?.[0];
  const def = meaning?.definitions?.[0];
  if (!def?.definition) return null;

  const phonetic =
    first.phonetic || first.phonetics?.find((p: any) => p?.text)?.text || '';
  const synonyms: string[] = Array.from(
    new Set<string>([...(def.synonyms ?? []), ...(meaning?.synonyms ?? [])])
  ).slice(0, 6);
  const example =
    def.example ||
    first.meanings
      ?.flatMap((m: any) => m.definitions ?? [])
      .find((d: any) => d?.example)?.example ||
    '';

  return {
    phonetic,
    partOfSpeech: meaning?.partOfSpeech ?? '',
    definition: def.definition,
    synonyms,
    example,
  };
}

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  initialWord = '',
  contextPassage = '',
  bookId,
  onClose,
  onSaveToLexicon,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [searchTerm, setSearchTerm] = useState(initialWord);
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const key = searchTerm.toLowerCase().trim();

  useEffect(() => {
    if (!key) {
      setLookup({ status: 'idle' });
      return;
    }
    if (LOCAL_DICTIONARY[key]) {
      setLookup({ status: 'found', entry: LOCAL_DICTIONARY[key] });
      return;
    }
    setLookup({ status: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const entry = await fetchDefinition(key, controller.signal);
        setLookup(entry ? { status: 'found', entry } : { status: 'missing' });
      } catch (err: any) {
        if (err?.name !== 'AbortError') setLookup({ status: 'error' });
      }
    }, 450); // debounce while typing
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const entry = lookup.status === 'found' ? lookup.entry : null;

  const handlePronounce = () => {
    if (!searchTerm.trim()) return;
    Speech.stop();
    Speech.speak(searchTerm, { language: 'en', rate: 0.85 });
    showToast(`Pronouncing: ${searchTerm}`);
  };

  const handleSave = () => {
    if (!entry) return;
    onSaveToLexicon({
      bookId,
      word: searchTerm.trim().charAt(0).toUpperCase() + searchTerm.trim().slice(1),
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      definition: entry.definition,
      contextPassage: contextPassage || (entry.example ? `“${entry.example}”` : ''),
      chapter: 'Reader Lexicon',
      masteryLevel: 1,
    });
    showToast(`Saved "${searchTerm}" to Lexicon Cards`);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} maxWidth={448} cardStyle={{ maxHeight: '85%' }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="menu_book" size={22} color={colors.primary} />
          <Text style={styles.headerTitle}>LEXICON &amp; DICTIONARY</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder="Look up word in dictionary..."
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
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
          <Pressable onPress={handlePronounce} style={styles.speakBtn} accessibilityLabel="Pronounce">
            <Icon name="volume_up" size={20} color={colors.primary} />
          </Pressable>
        </View>

        {lookup.status === 'loading' && <Text style={styles.note}>Looking up “{key}”…</Text>}
        {lookup.status === 'missing' && (
          <Text style={styles.note}>No definition found for “{key}”. Check the spelling or try the base form of the word.</Text>
        )}
        {lookup.status === 'error' && (
          <Text style={styles.note}>Couldn’t reach the dictionary service. Check your connection and try again.</Text>
        )}

        {entry && (
          <>
            <View>
              <Text style={styles.section}>DEFINITION</Text>
              <Text style={styles.definition}>{entry.definition}</Text>
            </View>

            {(entry.example || contextPassage) && (
              <View style={styles.exampleBox}>
                <Text style={styles.section}>LITERARY CONTEXT / EXAMPLE</Text>
                <Text style={styles.example}>“{entry.example || contextPassage}”</Text>
              </View>
            )}

            {entry.synonyms.length > 0 && (
              <View>
                <Text style={[styles.section, { marginBottom: 6 }]}>SYNONYMS</Text>
                <View style={styles.synRow}>
                  {entry.synonyms.map((s) => (
                    <Pressable key={s} onPress={() => setSearchTerm(s)} style={styles.synChip}>
                      <Text style={styles.synText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={onClose} style={{ padding: 8 }}>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!entry}
          style={[styles.saveBtn, !entry && { opacity: 0.45 }]}
        >
          <Icon name="bookmark_add" size={16} color="#fff" />
          <Text style={styles.saveText}>Save to Lexicon Cards</Text>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { ...type.labelSm, color: colors.muted, letterSpacing: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
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
  searchInput: { flex: 1, paddingVertical: 8, fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  body: { padding: 20, gap: 16 },
  wordRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  word: { fontFamily: F.serifMedium, fontSize: 28, lineHeight: 34, color: colors.onSurface, textTransform: 'capitalize' },
  phonetic: { fontFamily: F.sans, fontSize: 13, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  speakBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  synChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.surfaceContainer },
  synText: { fontFamily: F.sans, fontSize: 12, color: colors.onSurface },
  footer: {
    padding: 12,
    backgroundColor: colors.surfaceLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dismiss: { fontFamily: F.sansSemi, fontSize: 12, color: colors.muted },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  saveText: { fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
});
