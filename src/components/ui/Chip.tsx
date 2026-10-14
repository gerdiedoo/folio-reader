import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { type } from '../../theme';
import { useAppTheme } from '../../AppTheme';
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
  activeBg,
  icon,
  dotColor,
  style,
}) => {
  const palette = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? activeBg ?? palette.primaryContainer : palette.surfaceContainer }, style]}
    >
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={active ? palette.white : palette.muted} /> : null}
      <Text style={[styles.label, { color: active ? palette.white : palette.muted }]}>{label}</Text>
    </Pressable>
  );
};

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
