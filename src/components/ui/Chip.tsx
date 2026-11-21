import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { type } from '../../theme';
import { useAppTheme } from '../../AppTheme';
import { Icon, IconName } from './Icon';
import { choiceAppearance, choiceStyles } from './choiceStyles';

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
  dotColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Compact rounded rectangle shared by Library, Notebook and free-book filters. */
export const Chip: React.FC<ChipProps> = ({
  label,
  active,
  onPress,
  icon,
  dotColor,
  style,
}) => {
  const palette = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[choiceStyles.target, style]}
    >
      <View style={[choiceStyles.face, choiceAppearance(palette, active)]} pointerEvents="none">
        {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
        {icon ? <Icon name={icon} size={14} color={active ? palette.onPrimaryContainer : palette.onSurface} /> : null}
        <Text style={[styles.label, { color: active ? palette.onPrimaryContainer : palette.onSurface }]}>{label}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...type.labelMd },
});
