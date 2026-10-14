import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LexiconEntry } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface FlashcardModalProps {
  lexiconItem: LexiconEntry;
  onClose: () => void;
  onUpdateMastery: (id: string, newLevel: number) => void;
  showToast: (msg: string) => void;
}

export const FlashcardModal: React.FC<FlashcardModalProps> = ({
  lexiconItem,
  onClose,
  onUpdateMastery,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isFlipped, setIsFlipped] = useState(false);

  const handleRate = (level: number) => {
    onUpdateMastery(lexiconItem.id, level);
    showToast(`Mastery level set to ${level}/5`);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} maxWidth={384}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="style" size={20} color={colors.primary} />
          <Text style={styles.headerTitle}>LEXICON FLASHCARD</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
          <Icon name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.cardBody}>
        {!isFlipped ? (
          <Pressable onPress={() => setIsFlipped(true)} style={styles.front}>
            <View style={styles.promptTag}>
              <Text style={styles.promptText}>PROMPT • WORD RECALL</Text>
            </View>
            <Text style={styles.word}>{lexiconItem.word}</Text>
            <Text style={styles.phonetic}>{lexiconItem.phonetic}</Text>
            <View style={styles.hintRow}>
              <Icon name="touch_app" size={16} color={colors.muted} />
              <Text style={styles.hint}>Tap anywhere to reveal definition</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable onPress={() => setIsFlipped(false)} style={styles.back}>
            <View style={styles.backHead}>
              <Text style={styles.backWord}>{lexiconItem.word}</Text>
              <Text style={styles.pos}>{lexiconItem.partOfSpeech}</Text>
            </View>
            <Text style={styles.definition}>{lexiconItem.definition}</Text>
            <View style={styles.contextBox}>
              <Text style={styles.contextLabel}>CONTEXT PASSAGE</Text>
              <Text style={styles.context}>{lexiconItem.contextPassage}</Text>
            </View>
            <Text style={styles.flipBack}>Tap card to flip back</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.ask}>How well did you know this?</Text>
        <View style={styles.rateRow}>
          <Pressable onPress={() => handleRate(1)} style={styles.rateBtn}>
            <Text style={[styles.rateText, { color: colors.primary }]}>Review (1)</Text>
          </Pressable>
          <Pressable onPress={() => handleRate(3)} style={styles.rateBtn}>
            <Text style={[styles.rateText, { color: colors.tertiary }]}>Good (3)</Text>
          </Pressable>
          <Pressable onPress={() => handleRate(5)} style={[styles.rateBtn, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.rateText, { color: '#fff' }]}>Mastered (5)</Text>
          </Pressable>
        </View>
      </View>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  header: {
    padding: 14,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { ...type.labelSm, color: colors.muted, letterSpacing: 1 },
  closeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 24, minHeight: 260, justifyContent: 'center' },
  front: { alignItems: 'center', gap: 12 },
  promptTag: { backgroundColor: colors.primaryFixed, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  promptText: { fontFamily: F.sansSemi, fontSize: 11, letterSpacing: 1.4, color: colors.primary },
  word: { fontFamily: F.serifMedium, fontSize: 32, lineHeight: 40, color: colors.onSurface, textAlign: 'center' },
  phonetic: { fontFamily: F.sans, fontSize: 14, color: colors.muted, fontStyle: 'italic' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 12 },
  hint: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  back: { gap: 12 },
  backHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backWord: { fontFamily: F.serifSemi, fontSize: 16, color: colors.primary },
  pos: { fontFamily: F.sans, fontSize: 12, color: colors.muted, fontStyle: 'italic' },
  definition: { ...type.bodyMd, color: colors.onSurface, lineHeight: 21 },
  contextBox: {
    backgroundColor: colors.surfaceLow,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  contextLabel: { fontFamily: F.sansSemi, fontSize: 10, color: colors.muted, marginBottom: 2 },
  context: { fontFamily: F.serifItalic, fontSize: 14, lineHeight: 19, color: colors.onSurface },
  flipBack: { fontFamily: F.sans, fontSize: 10, color: colors.muted, textAlign: 'center' },
  footer: {
    padding: 12,
    gap: 8,
    backgroundColor: colors.surfaceLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
  },
  ask: { fontFamily: F.sans, fontSize: 11, color: colors.muted, textAlign: 'center' },
  rateRow: { flexDirection: 'row', gap: 8 },
  rateBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  rateText: { fontFamily: F.sansSemi, fontSize: 12 },
});
