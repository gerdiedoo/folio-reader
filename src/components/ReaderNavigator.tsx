import React, { useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppPalette, useAppTheme } from '../AppTheme';
import { F, type } from '../theme';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

export interface ChapterInfo {
  number: string;
  title: string;
  /** Index (into the source pages array) of the chapter's first page. */
  startIndex: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Scrubber: press + drag anywhere on the bar to fly through the book.
// A bubble above the thumb shows the chapter and page you'd land on; the jump
// happens when you let go (so the heavy list/page render only runs once).
// ---------------------------------------------------------------------------
interface ScrubBarProps {
  /** Number of stops (pages) the bar spans. */
  count: number;
  /** Current stop. */
  index: number;
  /** Text for the preview bubble. Use "\n" to split chapter / page lines. */
  labelFor: (index: number) => string;
  onCommit: (index: number) => void;
  /** Chapter boundaries as 0..1 fractions, drawn as ticks on the track. */
  marks?: number[];
}

export const ScrubBar: React.FC<ScrubBarProps> = ({ count, index, labelFor, onCommit, marks = [] }) => {
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const countRef = useRef(count);
  countRef.current = count;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const resolve = (e: GestureResponderEvent) => {
    const f = Math.max(0, Math.min(1, e.nativeEvent.locationX / widthRef.current));
    return Math.round(f * Math.max(0, countRef.current - 1));
  };
  const handle = (e: GestureResponderEvent) => {
    const i = resolve(e);
    if (i !== dragRef.current) {
      dragRef.current = i;
      setDrag(i);
    }
  };
  const release = () => {
    const i = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (i !== null) commitRef.current(i);
  };
  const cancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const dragging = drag !== null;
  const shown = drag ?? index;
  const frac = Math.max(0, Math.min(1, shown / Math.max(1, count - 1)));
  const thumbX = frac * width;
  const bubbleW = 190;
  const bubbleLeft = Math.max(0, Math.min(width - bubbleW, thumbX - bubbleW / 2));
  const [chapterLine, pageLine] = (dragging ? labelFor(drag as number) : '').split('\n');

  return (
    <View
      style={styles.hit}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
        setWidth(widthRef.current);
      }}
      onStartShouldSetResponder={() => count > 1}
      onMoveShouldSetResponder={() => count > 1}
      onResponderGrant={handle}
      onResponderMove={handle}
      onResponderRelease={release}
      onResponderTerminate={cancel}
      onResponderTerminationRequest={() => false}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
      </View>
      {marks.map((m, i) => (
        <View key={i} pointerEvents="none" style={[styles.tick, { left: m * width - 1 }]} />
      ))}
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { left: Math.max(0, thumbX - (dragging ? 11 : 8)) },
          dragging && styles.thumbActive,
        ]}
      />
      {dragging && (
        <View pointerEvents="none" style={[styles.bubble, { width: bubbleW, left: bubbleLeft }]}>
          <Text style={styles.bubbleChapter} numberOfLines={1}>
            {chapterLine}
          </Text>
          {pageLine ? <Text style={styles.bubblePage}>{pageLine}</Text> : null}
        </View>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Chapter list: tap any chapter to jump straight to it.
// ---------------------------------------------------------------------------
interface ChapterSheetProps {
  chapters: ChapterInfo[];
  currentIndex: number;
  onSelect: (startIndex: number) => void;
  onClose: () => void;
}

export const ChapterSheet: React.FC<ChapterSheetProps> = ({ chapters, currentIndex, onSelect, onClose }) => {
  const palette = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ModalShell onClose={onClose} align="bottom" maxWidth={560} cardStyle={{ maxHeight: '80%' }}>
      <View style={styles.handle} />
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Contents</Text>
        <Text style={styles.sheetCount}>{chapters.length} chapters</Text>
        <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
          <Icon name="close" size={20} color={palette.muted} />
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {chapters.map((c, i) => {
          const active = i === currentIndex;
          return (
            <Pressable
              key={`${c.number}-${i}`}
              onPress={() => onSelect(c.startIndex)}
              onLayout={(e) => {
                if (active) scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 80), animated: false });
              }}
              style={[styles.row, active && { backgroundColor: palette.primaryFixed }]}
            >
              <Text style={[styles.rowNo, active && { color: palette.primary }]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, active && { color: palette.primary }]} numberOfLines={2}>
                  {c.title}
                </Text>
                <Text style={styles.rowMeta}>
                  {c.pageCount} {c.pageCount === 1 ? 'page' : 'pages'} · starts p. {c.startIndex + 1}
                </Text>
              </View>
              {active ? <Icon name="bookmark" size={18} color={palette.primary} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </ModalShell>
  );
};

const createStyles = (p: AppPalette) =>
  StyleSheet.create({
    hit: { height: 36, justifyContent: 'center' },
    track: { height: 6, borderRadius: 3, backgroundColor: p.surfaceHighest, overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: p.primary },
    tick: { position: 'absolute', top: 12, width: 2, height: 12, borderRadius: 1, backgroundColor: p.outline, opacity: 0.45 },
    thumb: {
      position: 'absolute',
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: p.primary,
      borderWidth: 2,
      borderColor: '#fff',
      top: 10,
    },
    thumbActive: { width: 22, height: 22, borderRadius: 11, top: 7, elevation: 4 },
    bubble: {
      position: 'absolute',
      bottom: 40,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: p.onSurface,
      alignItems: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    bubbleChapter: { fontFamily: F.serifMedium, fontSize: 14, color: p.background },
    bubblePage: { ...type.labelSm, color: p.tertiaryFixed, marginTop: 1 },

    handle: { width: 40, height: 6, borderRadius: 3, backgroundColor: p.secondaryFixedDim, alignSelf: 'center', marginTop: 12 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
    sheetTitle: { ...type.headlineSm, color: p.onSurface },
    sheetCount: { ...type.bodySm, color: p.muted, flex: 1 },
    closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
    rowNo: { fontFamily: F.serifSemi, fontSize: 18, width: 28, textAlign: 'center', color: p.muted },
    rowTitle: { fontFamily: F.serifMedium, fontSize: 16, lineHeight: 21, color: p.onSurface },
    rowMeta: { ...type.bodySm, color: p.muted, marginTop: 1 },
  });
