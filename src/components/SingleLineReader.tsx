import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, F, readerFontFamily, readerPaper, type } from '../theme';
import { Book, HighlightEntry, ReadingSettings } from '../types';
import { Icon } from './ui/Icon';
import { SeekBar } from './ui/SeekBar';

interface SingleLineReaderProps {
  book: Book;
  chapterTitle: string;
  chapterText: string;
  settings: ReadingSettings;
  onExit: () => void;
  onAddHighlight: (highlight: Omit<HighlightEntry, 'id' | 'dateAdded'>) => void;
  showToast: (msg: string) => void;
}

const ACTIVE_SIZE = { '-1': 24, '0': 30, '1': 36, '2': 48 } as const;
const RIBBON_WINDOW = 14; // words rendered on each side of the active word

export const SingleLineReader: React.FC<SingleLineReaderProps> = ({
  book,
  chapterTitle,
  chapterText,
  settings,
  onExit,
  onAddHighlight,
  showToast,
}) => {
  const words = useMemo(() => chapterText.split(/\s+/).filter((w) => w.length > 0), [chapterText]);

  // 'rsvp' = one focus word on a guideline; 'ribbon' = a continuous tape of words
  const [lineStyle, setLineStyle] = useState<'rsvp' | 'ribbon'>('rsvp');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [wpm, setWpm] = useState(settings.wpm || 240);
  const [fontSizeOffset, setFontSizeOffset] = useState<-1 | 0 | 1 | 2>(0);

  const intervalMs = Math.round((60 / wpm) * 1000);
  const paper = readerPaper[settings.theme];
  const fontFamily = readerFontFamily(settings.font);

  // Auto-advance
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= words.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [isPlaying, intervalMs, words.length]);

  const currentWord = words[currentIndex] || '';
  const prevWords = words.slice(Math.max(0, currentIndex - 4), currentIndex).join(' ');
  const nextWords = words.slice(currentIndex + 1, Math.min(words.length, currentIndex + 5)).join(' ');
  const percent = Math.round((currentIndex / Math.max(1, words.length - 1)) * 100);

  const jump = (delta: number) =>
    setCurrentIndex((i) => Math.max(0, Math.min(words.length - 1, i + delta)));

  const saveCurrentPassage = () => {
    const start = Math.max(0, currentIndex - 6);
    const end = Math.min(words.length, currentIndex + 8);
    onAddHighlight({
      bookId: book.id,
      bookTitle: book.title,
      chapter: chapterTitle,
      page: book.currentPage,
      loc: book.currentLoc,
      colorName: 'Amber Crayon',
      colorHex: '#F8E8A2',
      text: words.slice(start, end).join(' '),
    });
    showToast('Saved passage from straight line to highlights');
  };

  const leftWindow = words.slice(Math.max(0, currentIndex - RIBBON_WINDOW), currentIndex);
  const rightWindow = words.slice(currentIndex + 1, currentIndex + 1 + RIBBON_WINDOW);
  const leftStart = Math.max(0, currentIndex - RIBBON_WINDOW);

  const ribbonWord = (w: string, idx: number) => {
    const dist = Math.abs(idx - currentIndex);
    return (
      <Pressable key={idx} onPress={() => setCurrentIndex(idx)} style={styles.ribbonWordWrap}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontSize: dist < 3 ? 18 : 14,
            color: dist < 3 ? colors.onSurface : 'rgba(96,94,90,0.6)',
          }}
        >
          {w}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: paper.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pulse} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>STRAIGHT-LINE READER</Text>
            <Text style={styles.chapter} numberOfLines={1}>
              {chapterTitle}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.segment}>
            {(['rsvp', 'ribbon'] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setLineStyle(s)}
                style={[styles.segBtn, lineStyle === s && { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.segText, { color: lineStyle === s ? '#fff' : colors.muted }]}>
                  {s === 'rsvp' ? 'Focus' : 'Tape'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onExit} style={styles.exitBtn}>
            <Icon name="auto_stories" size={16} color={colors.primary} />
            <Text style={styles.exitText}>Pages</Text>
          </Pressable>
        </View>
      </View>

      {/* Stage */}
      {words.length === 0 ? (
        <View style={styles.stage}>
          <Text style={{ color: colors.muted, fontFamily: F.sans }}>This chapter has no text.</Text>
        </View>
      ) : lineStyle === 'rsvp' ? (
        <Pressable onPress={() => setIsPlaying((p) => !p)} style={styles.stage}>
          <View style={styles.guideWrap}>
            <View style={styles.guideLine} />
            <View style={styles.guideCap} />
          </View>

          <View style={styles.rsvpRow}>
            <Text numberOfLines={1} style={[styles.side, { textAlign: 'right', fontFamily }]}>
              {prevWords}
            </Text>
            <Text
              style={[
                styles.focusWord,
                { fontFamily: F.serifMedium, fontSize: ACTIVE_SIZE[String(fontSizeOffset) as keyof typeof ACTIVE_SIZE] },
              ]}
            >
              {currentWord}
            </Text>
            <Text numberOfLines={1} style={[styles.side, { textAlign: 'left', fontFamily }]}>
              {nextWords}
            </Text>
          </View>

          <View style={styles.hintRow}>
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={14} color="rgba(96,94,90,0.75)" />
            <Text style={styles.hint}>{isPlaying ? 'TAP LINE TO PAUSE' : 'PAUSED • TAP TO RESUME'}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.stage}>
          <Text style={styles.tapeCaption}>Words stream continuously along one unbroken line</Text>
          <View style={[styles.guideLine, { height: 2, width: '100%' }]} />
          <View style={styles.ribbon}>
            <View style={[styles.ribbonSide, { justifyContent: 'flex-end' }]}>
              {leftWindow.map((w, i) => ribbonWord(w, leftStart + i))}
            </View>
            <Pressable onPress={() => setIsPlaying((p) => !p)} style={styles.ribbonActive}>
              <Text
                style={{
                  fontFamily,
                  fontSize: 26,
                  color: colors.primary,
                  textDecorationLine: 'underline',
                }}
              >
                {currentWord}
              </Text>
            </Pressable>
            <View style={[styles.ribbonSide, { justifyContent: 'flex-start' }]}>
              {rightWindow.map((w, i) => ribbonWord(w, currentIndex + 1 + i))}
            </View>
          </View>
          <View style={[styles.guideLine, { height: 2, width: '100%' }]} />
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.seekRow}>
          <Text style={styles.count}>
            {Math.min(currentIndex + 1, words.length)} / {words.length}
          </Text>
          <SeekBar
            value={currentIndex / Math.max(1, words.length - 1)}
            onChange={(v) => setCurrentIndex(Math.round(v * Math.max(0, words.length - 1)))}
          />
          <Text style={styles.percent}>{percent}%</Text>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.pillGroup}>
            <Text style={styles.speedLabel}>SPEED</Text>
            {[180, 240, 300, 380].map((s) => (
              <Pressable
                key={s}
                onPress={() => setWpm(s)}
                style={[styles.speedBtn, wpm === s && { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.speedText, { color: wpm === s ? '#fff' : colors.muted }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.pillGroup}>
            <Pressable onPress={() => setFontSizeOffset((v) => (Math.max(-1, v - 1) as -1 | 0 | 1 | 2))} style={styles.sizeBtn}>
              <Text style={styles.sizeText}>Aa-</Text>
            </Pressable>
            <Pressable onPress={() => setFontSizeOffset((v) => (Math.min(2, v + 1) as -1 | 0 | 1 | 2))} style={styles.sizeBtn}>
              <Text style={styles.sizeText}>Aa+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.transport}>
            <Pressable onPress={() => jump(-15)} style={styles.roundSm} accessibilityLabel="Rewind 15 words">
              <Icon name="replay_10" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => setIsPlaying((p) => !p)}
              style={styles.roundLg}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            >
              <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={24} color="#fff" />
            </Pressable>
            <Pressable onPress={() => jump(15)} style={styles.roundSm} accessibilityLabel="Forward 15 words">
              <Icon name="forward_10" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <Pressable onPress={saveCurrentPassage} style={styles.saveBtn}>
            <Icon name="format_ink_highlighter" size={16} color={colors.primary} />
            <Text style={styles.saveText}>Save Passage</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    borderRadius: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  pulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  kicker: { ...type.labelSm, color: colors.primary, letterSpacing: 1 },
  chapter: { fontFamily: F.sans, fontSize: 11, color: colors.muted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainer,
    padding: 2,
    borderRadius: 8,
  },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  segText: { fontFamily: F.sansMedium, fontSize: 12 },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  exitText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  guideWrap: { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  guideLine: { width: '100%', height: 1, backgroundColor: 'rgba(137,52,20,0.25)' },
  guideCap: {
    position: 'absolute',
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(137,52,20,0.75)',
  },
  rsvpRow: { width: '100%', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 10, minHeight: 60 },
  side: { flex: 1, fontSize: 15, color: 'rgba(96,94,90,0.45)' },
  focusWord: {
    color: colors.primary,
    textDecorationLine: 'underline',
    textDecorationColor: colors.primaryFixedDim,
    flexShrink: 0,
    maxWidth: '80%',
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28 },
  hint: { fontFamily: F.sans, fontSize: 11, letterSpacing: 1.2, color: 'rgba(96,94,90,0.75)' },
  tapeCaption: { fontFamily: F.sans, fontSize: 12, color: 'rgba(96,94,90,0.8)', marginBottom: 12 },
  ribbon: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingVertical: 24 },
  ribbonSide: { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  ribbonWordWrap: { paddingHorizontal: 5, flexShrink: 0 },
  ribbonActive: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,219,207,0.5)',
    flexShrink: 0,
  },
  controls: {
    paddingTop: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
  },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  count: { fontFamily: F.sans, fontSize: 11, color: colors.muted, width: 62, textAlign: 'right' },
  percent: { fontFamily: F.sansSemi, fontSize: 11, color: colors.primary, width: 36 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  pillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceContainer,
    padding: 4,
    borderRadius: 12,
  },
  speedLabel: { fontFamily: F.sansSemi, fontSize: 10, color: colors.muted, paddingHorizontal: 6 },
  speedBtn: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  speedText: { fontFamily: F.sansSemi, fontSize: 12 },
  sizeBtn: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  sizeText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundSm: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  saveText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
});
