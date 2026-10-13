import React, { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

interface SeekBarProps {
  /** 0..1 */
  value: number;
  onChange: (value: number) => void;
}

/** Minimal tap/drag seek bar (React Native core has no slider). */
export const SeekBar: React.FC<SeekBarProps> = ({ value, onChange }) => {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);

  const handle = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    onChange(Math.max(0, Math.min(1, x / widthRef.current)));
  };

  return (
    <View
      style={styles.hit}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
        setWidth(widthRef.current);
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handle}
      onResponderMove={handle}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${value * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: Math.max(0, value * width - 8) }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  hit: { flex: 1, height: 28, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHighest, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primary },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
