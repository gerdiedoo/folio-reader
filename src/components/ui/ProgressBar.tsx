import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../AppTheme';

interface ProgressBarProps {
  percent: number;
  height?: number;
  fill?: string;
  track?: string;
  style?: StyleProp<ViewStyle>;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  height = 4,
  fill,
  track,
  style,
}) => {
  const palette = useAppTheme();
  return (
    <View style={[{ height, borderRadius: height, backgroundColor: track ?? palette.surfaceHighest, overflow: 'hidden' }, style]}>
      <View
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, percent))}%`,
          backgroundColor: fill ?? palette.primary,
          borderRadius: height,
        }}
      />
    </View>
  );
};

export const hairline = StyleSheet.hairlineWidth;
