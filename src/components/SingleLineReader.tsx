import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppPalette, useAppTheme } from '../AppTheme';
import { F, readerFontFamily, readerPaper, type } from '../theme';
import { Book, BookContentPage, HighlightEntry, ReadingSettings } from '../types';
import { createLineChapter, firstLineWord, linePassage, lineQuote, lineSpeed } from '../lib/lineReader';
import { Icon } from './ui/Icon';
import { SeekBar } from './ui/SeekBar';

interface SingleLineReaderProps {
  book: Book;
  chapterTitle: string;
  chapterPages: BookContentPage[];
  initialPageNumber: number;
  initialWordOffset?: number;
  onPositionChange: (page: BookContentPage, wordOffset: number) => void;
  playbackBlocked?: boolean;
  settings: ReadingSettings;
  onExit: () => void;
  onAddHighlight: (highlight: Omit<HighlightEntry, 'id' | 'dateAdded'>) => Promise<boolean>;
  showToast: (msg: string) => void;
}

const ACTIVE_SIZE = { '-1': 24, '0': 30, '1': 36, '2': 48 } as const;
const RIBBON_WINDOW = 14; // words rendered on each side of the active word

export const SingleLineReader: React.FC<SingleLineReaderProps> = ({
  book,
  chapterTitle,
  chapterPages,
  initialPageNumber,
  initialWordOffset = 0,
  onPositionChange,
  playbackBlocked = false,
  settings,
  onExit,
  onAddHighlight,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const chapter = useMemo(() => createLineChapter(chapterPages), [chapterPages]);
  const words = useMemo(() => chapter.words.map(word => word.text), [chapter]);

  // 'rsvp' = one focus word on a guideline; 'ribbon' = a continuous tape of words
  const [lineStyle, setLineStyle] = useState<'rsvp' | 'ribbon'>('rsvp');
  const [currentIndex, setCurrentIndex] = useState(() => firstLineWord(chapter, initialPageNumber, initialWordOffset));
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(() => lineSpeed(settings.wpm));
  const [fontSizeOffset, setFontSizeOffset] = useState<-1 | 0 | 1 | 2>(0);
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);

  const intervalMs = Math.round((60 / wpm) * 1000);
  const paper = readerPaper[settings.theme];
  const fontFamily = readerFontFamily(settings.font);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foreground = useRef(AppState.currentState === 'active');
  const blockedRef = useRef(playbackBlocked);
  blockedRef.current = playbackBlocked;
  useEffect(() => {
    if (playbackBlocked) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsPlaying(false);
    }
  }, [playbackBlocked]);
  useEffect(() => {
    foreground.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (!foreground.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setIsPlaying(false);
      }
    });
    return () => subscription.remove();
  }, []);

  // One cancellable tick at a time. Returning to the app never starts playback.
  useEffect(() => {
    if (!isPlaying || !foreground.current || playbackBlocked || words.length < 2) return;
    if (currentIndex >= words.length - 1) { setIsPlaying(false); return; }
    const id = setTimeout(() => {
      if (foreground.current && !blockedRef.current) setCurrentIndex(index => Math.min(words.length - 1, index + 1));
    }, intervalMs);
    timerRef.current = id;
    return () => { clearTimeout(id); timerRef.current = null; };
  }, [isPlaying, intervalMs, words.length, currentIndex, playbackBlocked]);

  const sourcePage = linePassage(chapter, currentIndex);
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  useEffect(() => {
    if (sourcePage) onPositionChangeRef.current(sourcePage, currentIndex - firstLineWord(chapter, sourcePage.pageNumber));
  }, [chapter, currentIndex, sourcePage]);

  const currentWord = words[currentIndex] || '';
  const prevWords = words.slice(Math.max(0, currentIndex - 4), currentIndex).join(' ');
  const nextWords = words.slice(currentIndex + 1, Math.min(words.length, currentIndex + 5)).join(' ');
  const percent = words.length === 1 ? 100 : Math.round((currentIndex / Math.max(1, words.length - 1)) * 100);
  const ended = words.length > 1 && currentIndex >= words.length - 1;
  const playLabel = isPlaying ? 'Pause playback' : ended ? 'Replay chapter' : 'Play chapter';
  const cannotPlay = words.length < 2 || playbackBlocked;
  const pausePlayback = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsPlaying(false);
  };
  const togglePlayback = () => {
    if (isPlaying) { pausePlayback(); return; }
    if (words.length < 2 || !foreground.current || playbackBlocked) return;
    if (ended) setCurrentIndex(0);
    setIsPlaying(true);
  };
  const seek = (index: number) => {
    pausePlayback();
    setCurrentIndex(Math.max(0, Math.min(Math.max(0, words.length - 1), index)));
  };

  const jump = (delta: number) =>
    seek(currentIndex + delta);

  const saveCurrentPassage = async () => {
    const quote = lineQuote(chapter, currentIndex);
    if (!quote || savePending.current) return;
    pausePlayback();
    savePending.current = true; setSaving(true);
    try {
      const saved = await onAddHighlight({
        bookId: book.id,
        bookTitle: book.title,
        chapter: quote.page.chapterTitle,
        page: quote.page.pageNumber,
        loc: quote.page.locNumber,
        colorName: 'Amber Crayon',
        colorHex: '#F8E8A2',
        text: quote.text,
      });
      if (saved) showToast('Passage saved on this device');
    } finally { savePending.current = false; setSaving(false); }
  };

  const leftWindow = words.slice(Math.max(0, currentIndex - RIBBON_WINDOW), currentIndex);
  const rightWindow = words.slice(currentIndex + 1, currentIndex + 1 + RIBBON_WINDOW);
  const leftStart = Math.max(0, currentIndex - RIBBON_WINDOW);

  const ribbonWord = (w: string, idx: number) => {
    const dist = Math.abs(idx - currentIndex);
    return (
      <Pressable key={idx} onPress={() => seek(idx)} style={styles.ribbonWordWrap}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontSize: dist < 3 ? 18 : 14,
            color: dist < 3 ? colors.onSurface : colors.muted,
          }}
        >
          {w}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.root, { backgroundColor: paper.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pulse} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>STRAIGHT-LINE READER</Text>
            <Text accessibilityRole="header" style={styles.chapter}>
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
                accessibilityRole="button"
                accessibilityLabel={`${s === 'rsvp' ? 'Focus' : 'Tape'} display`}
                accessibilityState={{ selected: lineStyle === s }}
                style={[styles.segBtn, lineStyle === s && { backgroundColor: colors.primaryContainer }]}
              >
                <Text style={[styles.segText, { color: lineStyle === s ? colors.onPrimaryContainer : colors.muted }]}>
                  {s === 'rsvp' ? 'Focus' : 'Tape'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => { pausePlayback(); onExit(); }} accessibilityRole="button" accessibilityLabel="Return to pages" style={styles.exitBtn}>
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
        <Pressable onPress={togglePlayback} accessibilityRole="button" accessibilityLabel={playLabel} accessibilityValue={{ text: currentWord }} disabled={cannotPlay} accessibilityState={{ disabled: cannotPlay }} style={styles.stage}>
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
                { fontFamily, fontSize: ACTIVE_SIZE[String(fontSizeOffset) as keyof typeof ACTIVE_SIZE] },
              ]}
            >
              {currentWord}
            </Text>
            <Text numberOfLines={1} style={[styles.side, { textAlign: 'left', fontFamily }]}>
              {nextWords}
            </Text>
          </View>

          <View style={styles.hintRow}>
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={14} color={colors.muted} />
            <Text style={styles.hint}>{isPlaying ? 'TAP LINE TO PAUSE' : ended ? 'CHAPTER COMPLETE • TAP TO REPLAY' : 'PAUSED • TAP TO PLAY'}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.stage}>
          <Text style={styles.tapeCaption}>Words stream continuously along one unbroken line</Text>
          <View style={[styles.guideLine, { height: 2, width: '100%' }]} />
          <View style={styles.ribbon}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.ribbonSide, { justifyContent: 'flex-end' }]}>
              {leftWindow.map((w, i) => ribbonWord(w, leftStart + i))}
            </View>
            <Pressable onPress={togglePlayback} accessibilityRole="button" accessibilityLabel={playLabel} accessibilityValue={{ text: currentWord }} disabled={cannotPlay} accessibilityState={{ disabled: cannotPlay }} style={styles.ribbonActive}>
              <Text
                style={{
                  fontFamily,
                  fontSize: ACTIVE_SIZE[String(fontSizeOffset) as keyof typeof ACTIVE_SIZE],
                  color: colors.primary,
                  textDecorationLine: 'underline',
                }}
              >
                {currentWord}
              </Text>
            </Pressable>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.ribbonSide, { justifyContent: 'flex-start' }]}>
              {rightWindow.map((w, i) => ribbonWord(w, currentIndex + 1 + i))}
            </View>
          </View>
          <View style={[styles.guideLine, { height: 2, width: '100%' }]} />
          <Text style={styles.hint}>{isPlaying ? 'PLAYING • TAP WORD TO PAUSE' : ended ? 'CHAPTER COMPLETE • TAP WORD TO REPLAY' : 'PAUSED • TAP WORD TO PLAY'}</Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.seekRow}>
          <Text style={styles.count}>
            {Math.min(currentIndex + 1, words.length)} / {words.length}
          </Text>
          <SeekBar
            count={words.length}
            index={currentIndex}
            word={currentWord}
            onChange={seek}
          />
          <Text style={styles.percent}>{percent}%</Text>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.pillGroup}>
            <Text style={styles.speedLabel}>{wpm} WPM</Text>
            {[180, 240, 300, 380].map((s) => (
              <Pressable
                key={s}
                onPress={() => setWpm(s)}
                accessibilityRole="button"
                accessibilityLabel={`${s} words per minute`}
                accessibilityState={{ selected: wpm === s }}
                style={[styles.speedBtn, wpm === s && { backgroundColor: colors.primaryContainer }]}
              >
                <Text style={[styles.speedText, { color: wpm === s ? colors.onPrimaryContainer : colors.muted }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.pillGroup}>
            <Pressable accessibilityRole="button" accessibilityLabel="Decrease focus word size" disabled={fontSizeOffset === -1} accessibilityState={{ disabled: fontSizeOffset === -1 }} onPress={() => setFontSizeOffset((v) => (Math.max(-1, v - 1) as -1 | 0 | 1 | 2))} style={styles.sizeBtn}>
              <Text style={styles.sizeText}>Aa-</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Increase focus word size" disabled={fontSizeOffset === 2} accessibilityState={{ disabled: fontSizeOffset === 2 }} onPress={() => setFontSizeOffset((v) => (Math.min(2, v + 1) as -1 | 0 | 1 | 2))} style={styles.sizeBtn}>
              <Text style={styles.sizeText}>Aa+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.transport}>
            <Pressable onPress={() => jump(-15)} style={styles.roundSm} accessibilityRole="button" accessibilityLabel="Rewind 15 words" disabled={currentIndex === 0 || !words.length} accessibilityState={{ disabled: currentIndex === 0 || !words.length }}>
              <Icon name="replay_10" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={togglePlayback}
              style={styles.roundLg}
              accessibilityRole="button"
              accessibilityLabel={playLabel}
              disabled={cannotPlay}
              accessibilityState={{ disabled: cannotPlay }}
            >
              <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={24} color={colors.onPrimaryContainer} />
            </Pressable>
            <Pressable onPress={() => jump(15)} style={styles.roundSm} accessibilityRole="button" accessibilityLabel="Forward 15 words" disabled={currentIndex >= words.length - 1} accessibilityState={{ disabled: currentIndex >= words.length - 1 }}>
              <Icon name="forward_10" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <Pressable onPress={saveCurrentPassage} accessibilityRole="button" accessibilityLabel="Save current passage" disabled={!words.length || saving} accessibilityState={{ disabled: !words.length || saving, busy: saving }} style={styles.saveBtn}>
            <Icon name="format_ink_highlighter" size={16} color={colors.primary} />
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Passage'}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  root: {
    flexGrow: 1,
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
  segBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  segText: { fontFamily: F.sansMedium, fontSize: 12 },
  exitBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  exitText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
  stage: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  guideWrap: { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  guideLine: { width: '100%', height: 1, backgroundColor: colors.border },
  guideCap: {
    position: 'absolute',
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  rsvpRow: { width: '100%', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 10, minHeight: 60 },
  side: { flex: 1, fontSize: 15, color: colors.muted },
  focusWord: {
    color: colors.primary,
    textDecorationLine: 'underline',
    textDecorationColor: colors.primary,
    flexShrink: 0,
    maxWidth: '80%',
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28 },
  hint: { fontFamily: F.sans, fontSize: 11, letterSpacing: 1.2, color: colors.muted, textAlign: 'center' },
  tapeCaption: { fontFamily: F.sans, fontSize: 12, color: colors.muted, marginBottom: 12 },
  ribbon: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingVertical: 24 },
  ribbonSide: { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  ribbonWordWrap: { paddingHorizontal: 5, flexShrink: 0 },
  ribbonActive: {
    maxWidth: '70%',
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.primaryFixed,
    flexShrink: 1,
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
    flexWrap: 'wrap',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceContainer,
    padding: 4,
    borderRadius: 12,
  },
  speedLabel: { fontFamily: F.sansSemi, fontSize: 10, color: colors.muted, paddingHorizontal: 6 },
  speedBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  speedText: { fontFamily: F.sansSemi, fontSize: 12 },
  sizeBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  sizeText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundSm: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  saveBtn: {
    minHeight: 48,
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
