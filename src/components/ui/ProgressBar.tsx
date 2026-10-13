import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../theme';

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
  fill = colors.primaryContainer,
  track = colors.surfaceHighest,
  style,
}) => (
  <View style={[{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }, style]}>
    <View
      style={{
        height: '100%',
        width: `${Math.max(0, Math.min(100, percent))}%`,
        backgroundColor: fill,
        borderRadius: height,
      }}
    />
  </View>
);

export const hairline = StyleSheet.hairlineWidth;
