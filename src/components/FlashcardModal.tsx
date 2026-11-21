import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LexiconEntry } from '../types';
import { Icon } from './ui/Icon';
import { choiceAppearance, choiceStyles } from './ui/choiceStyles';
import { ModalShell } from './ui/ModalShell';

interface FlashcardModalProps {
  lexiconItem: LexiconEntry;
  onClose: () => void;
  onUpdateMastery: (id: string, newLevel: number) => Promise<boolean>;
  saveStatus?: 'loading' | 'ready' | 'error';
  saveBusy?: boolean;
  cardAvailable?: boolean;
  onRetry?: () => void;
  showToast: (msg: string) => void;
}
const RATINGS = [
  { level: 1, label: 'Review', accessibilityLabel: 'Review: mastery 1 of 5' },
  { level: 3, label: 'Good', accessibilityLabel: 'Good: mastery 3 of 5' },
  { level: 5, label: 'Mastered', accessibilityLabel: 'Mastered: mastery 5 of 5' },
];

export const FlashcardModal: React.FC<FlashcardModalProps> = ({
  lexiconItem, onClose, onUpdateMastery, saveStatus = 'ready', saveBusy = false,
  cardAvailable = true, onRetry, showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const activeId = useRef(lexiconItem.id);
  activeId.current = lexiconItem.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unavailable = saving || saveBusy || saveStatus !== 'ready' || !cardAvailable || !isFlipped;
  const close = () => { if (!pending.current) onClose(); };
  const flip = (revealed: boolean) => { if (!pending.current) setIsFlipped(revealed); };

  const handleRate = async (level: number) => {
    if (!mounted.current || pending.current || unavailable) return;
    const id = lexiconItem.id;
    const isCurrent = () => mounted.current && activeId.current === id;
    pending.current = true; setSaving(true); setSaveError(null);
    try {
      const saved = await onUpdateMastery(id, level);
      if (!isCurrent()) return;
      if (saved) {
        showToast(`Mastery level ${level}/5 saved on this device`);
        onClose();
      } else setSaveError('Couldn’t save mastery on this device. Your card is still open; try the rating again.');
    } catch {
      if (isCurrent()) setSaveError('Couldn’t save mastery on this device. Your card is still open; try the rating again.');
    } finally {
      pending.current = false;
      if (isCurrent()) setSaving(false);
    }
  };
  const status = saving ? 'Saving mastery…'
    : saveStatus === 'loading' ? 'Loading saved vocabulary…'
    : saveStatus === 'error' ? 'Saved vocabulary could not be read. Try loading it again before rating.'
    : !cardAvailable ? 'This card is no longer in this reading space. Close it to return.'
    : saveBusy ? 'Another vocabulary change is saving. Please wait.'
    : `Saved mastery: ${lexiconItem.masteryLevel}/5`;

  return (
    <ModalShell onClose={close} maxWidth={420}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.headerTitle}>Vocabulary card</Text>
        <Pressable onPress={close} disabled={saving} accessibilityRole="button" accessibilityLabel="Close vocabulary card"
          accessibilityState={{ disabled: saving }} style={styles.closeBtn}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroller} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!isFlipped ? (
          <View style={styles.front}>
            <Text style={styles.prompt}>Recall the meaning</Text>
            <Text accessibilityRole="header" style={styles.word}>{lexiconItem.word}</Text>
            {lexiconItem.phonetic ? <Text style={styles.phonetic}>{lexiconItem.phonetic}</Text> : null}
            <Pressable onPress={() => flip(true)} disabled={saving} accessibilityRole="button"
              accessibilityLabel={`Reveal definition for ${lexiconItem.word}`} accessibilityState={{ disabled: saving }} style={[choiceStyles.target, styles.choiceTarget]}>
              <View style={[choiceStyles.face, choiceAppearance(colors, true)]} pointerEvents="none">
                <Text style={styles.revealText}>Reveal definition</Text>
              </View>
            </Pressable>
          </View>
        ) : (
          <View style={styles.back}>
            <View style={styles.backHead}>
              <Text accessibilityRole="header" style={styles.backWord}>{lexiconItem.word}</Text>
              {lexiconItem.partOfSpeech ? <Text style={styles.phonetic}>{lexiconItem.partOfSpeech}</Text> : null}
            </View>
            <Text selectable style={styles.definition}>{lexiconItem.definition}</Text>
            {lexiconItem.contextPassage?.trim() ? <View style={styles.contextBox}>
              <Text accessibilityRole="header" style={styles.contextLabel}>In context</Text>
              <Text selectable style={styles.context}>{lexiconItem.contextPassage}</Text>
            </View> : null}
            {lexiconItem.chapter ? <Text style={styles.status}>{lexiconItem.chapter}</Text> : null}
            <Pressable onPress={() => flip(false)} disabled={saving} accessibilityRole="button"
              accessibilityLabel={`Show word again for ${lexiconItem.word}`} accessibilityState={{ disabled: saving }} style={[choiceStyles.target, styles.choiceTarget]}>
              <View style={[choiceStyles.face, choiceAppearance(colors, false)]} pointerEvents="none">
                <Text style={styles.returnText}>Show word again</Text>
              </View>
            </Pressable>
          </View>
        )}
        <View style={styles.review}>
          <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
          {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
          {saveStatus === 'error' && onRetry ? <Pressable onPress={() => { if (!pending.current) onRetry(); }}
            accessibilityRole="button" accessibilityLabel="Retry loading vocabulary for this card" style={[choiceStyles.target, styles.choiceTarget]}>
            <View style={[choiceStyles.face, choiceAppearance(colors, false)]} pointerEvents="none"><Text style={styles.returnText}>Try again</Text></View>
          </Pressable> : null}
          <Text style={styles.ask}>{isFlipped ? 'How well did you recall it?' : 'Reveal the definition before rating.'}</Text>
          <View style={styles.rateRow}>
            {RATINGS.map(rating => <Pressable key={rating.level} onPress={() => handleRate(rating.level)} disabled={unavailable}
              accessibilityRole="button" accessibilityLabel={rating.accessibilityLabel}
              accessibilityState={{ disabled: unavailable, selected: lexiconItem.masteryLevel === rating.level, busy: saving }} style={[choiceStyles.target, styles.choiceTarget]}>
              <View style={[choiceStyles.face, choiceAppearance(colors, lexiconItem.masteryLevel === rating.level)]} pointerEvents="none">
                <Text style={[styles.rateText, { color: lexiconItem.masteryLevel === rating.level ? colors.onPrimaryContainer : colors.onSurface }]}>{rating.label}</Text>
              </View>
            </Pressable>)}
          </View>
        </View>
      </ScrollView>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  header: { paddingLeft: 16, paddingRight: 8, backgroundColor: colors.surfaceLow, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderMid, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerTitle: { ...type.bodyMd, color: colors.onSurface, flexShrink: 1 },
  closeBtn: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  scroller: { flexShrink: 1, minHeight: 0 }, body: { padding: 16, gap: 16 },
  front: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  prompt: { ...type.labelMd, color: colors.muted },
  word: { fontFamily: F.serifMedium, fontSize: 30, lineHeight: 38, color: colors.onSurface, textAlign: 'center' },
  phonetic: { ...type.bodySm, color: colors.muted, fontStyle: 'italic' },
  choiceTarget: { maxWidth: '100%' },
  revealText: { ...type.labelMd, color: colors.onPrimaryContainer, flexShrink: 1 },
  returnText: { ...type.labelMd, color: colors.onSurface, flexShrink: 1 },
  back: { gap: 10 }, backHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center' },
  backWord: { ...type.headlineSm, color: colors.onSurface, flexShrink: 1 },
  definition: { ...type.bodyMd, color: colors.onSurface },
  contextBox: { backgroundColor: colors.surfaceLow, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSoft },
  contextLabel: { ...type.labelSm, color: colors.muted, marginBottom: 4 },
  context: { fontFamily: F.serifItalic, fontSize: 15, lineHeight: 21, color: colors.onSurface },
  review: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderMid, paddingTop: 12, gap: 6 },
  ask: { ...type.bodySm, color: colors.onSurface }, status: { ...type.bodySm, color: colors.muted },
  error: { ...type.bodySm, color: colors.onSurface },
  rateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, rateText: { ...type.labelMd, flexShrink: 1 },
});
