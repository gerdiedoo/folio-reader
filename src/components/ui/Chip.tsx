import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, type } from '../../theme';
import { Icon, IconName } from './Icon';

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  activeBg?: string;
  icon?: IconName;
  dotColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Rounded filter pill used on the Library and Notebook screens. */
export const Chip: React.FC<ChipProps> = ({
  label,
  active,
  onPress,
  activeBg = colors.primaryContainer,
  icon,
  dotColor,
  style,
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, { backgroundColor: active ? activeBg : colors.surfaceContainer }, style]}
  >
    {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
    {icon ? <Icon name={icon} size={14} color={active ? colors.white : colors.muted} /> : null}
    <Text style={[styles.label, { color: active ? colors.white : colors.muted }]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...type.labelMd },
});
