import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme, type AppPalette } from '../AppTheme';
import { useReducedMotion } from '../MotionPreferences';
import { type } from '../theme';
import { Icon } from './ui/Icon';
import { ProgressBar } from './ui/ProgressBar';

interface Props {
  phase: 'downloading' | 'preparing';
  percent: number | null;
  onCancel: () => void;
}

/** One transfer indicator stays visible when moving between details and results. */
export function BookDownloadProgress({ phase, percent, onCancel }: Props) {
  const palette = useAppTheme(), styles = useMemo(() => createStyles(palette), [palette]);
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  const known = percent !== null && Number.isFinite(percent) && percent > 0;
  const value = Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  const preparing = phase === 'preparing';
  useEffect(() => {
    pulse.setValue(1);
    if (preparing || known || reducedMotion) return;
    const animation = Animated.loop(Animated.timing(pulse, { toValue: 0.3, duration: 1000, useNativeDriver: true }));
    animation.start();
    return () => { animation.stop(); pulse.setValue(1); };
  }, [preparing, known, reducedMotion, pulse]);
  return <View style={styles.container}>
    <View style={styles.line}>
      <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={preparing ? 'Preparing book' : 'Downloading book'}
        accessibilityState={{ busy: true }} accessibilityValue={preparing ? { text: 'Preparing book for your Library' } : known ? { min: 0, max: 100, now: value } : { text: 'Downloading; file size not yet available' }}>
        <Text style={styles.label}>{preparing ? 'Preparing book…' : known ? `Downloading · ${value}%` : 'Downloading…'}</Text>
        {preparing || known ? <ProgressBar percent={preparing ? 100 : value} height={2} />
          : <View style={styles.track}><Animated.View style={[styles.indeterminate, { opacity: pulse }]} /></View>}
      </View>
      {!preparing && <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel book download" style={styles.cancel}>
        <Icon name="close" size={18} color={palette.muted} />
      </Pressable>}
    </View>
  </View>;
}

const createStyles = (palette: AppPalette) => StyleSheet.create({
  container: { marginHorizontal: 20, paddingBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  progress: { flex: 1, gap: 6 }, label: { ...type.labelSm, color: palette.muted },
  cancel: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  track: { height: 2, borderRadius: 2, overflow: 'hidden', backgroundColor: palette.surfaceHighest },
  indeterminate: { height: 2, width: '28%', backgroundColor: palette.primary },
});
