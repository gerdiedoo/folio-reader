import React, { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../../AppTheme';

interface SeekBarProps {
  count: number;
  index: number;
  word: string;
  onChange: (index: number) => void;
}

/** Minimal tap/drag seek bar (React Native core has no slider). */
export const SeekBar: React.FC<SeekBarProps> = ({ count, index, word, onChange }) => {
  const colors = useAppTheme();
  const value = Math.max(0, Math.min(1, index / Math.max(1, count - 1)));
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);

  const handle = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    if (count > 1) onChange(Math.round(Math.max(0, Math.min(1, x / widthRef.current)) * (count - 1)));
  };

  return (
    <View
      style={styles.hit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Word position"
      accessibilityHint="Adjust to move one word at a time."
      accessibilityState={{ disabled: count <= 1 }}
      accessibilityValue={{ min: count ? 1 : 0, max: count, now: count ? index + 1 : 0, text: count ? `Word ${index + 1} of ${count}: ${word}` : 'No words' }}
      accessibilityActions={count > 1 ? [{ name: 'increment' }, { name: 'decrement' }] : []}
      onAccessibilityAction={({ nativeEvent }) => {
        if (count <= 1) return;
        const delta = nativeEvent.actionName === 'increment' ? 1 : nativeEvent.actionName === 'decrement' ? -1 : 0;
        const next = Math.max(0, Math.min(count - 1, index + delta));
        if (delta && next !== index) onChange(next);
      }}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
        setWidth(widthRef.current);
      }}
      onStartShouldSetResponder={() => count > 1}
      onMoveShouldSetResponder={() => count > 1}
      onResponderGrant={handle}
      onResponderMove={handle}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.surfaceHighest }]}>
        <View style={[styles.fill, { backgroundColor: colors.primary, width: `${value * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { backgroundColor: colors.primary, left: Math.max(0, value * width - 8) }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  hit: { flex: 1, minWidth: 48, height: 48, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
