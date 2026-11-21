import { StyleSheet } from 'react-native';
import type { AppPalette } from '../../AppTheme';

/** A compact visible choice inside a full-size touch target. */
export const choiceStyles = StyleSheet.create({
  target: {
    minHeight: 48,
    minWidth: 48,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  face: {
    minHeight: 36,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export function choiceAppearance(palette: AppPalette, selected: boolean) {
  return {
    backgroundColor: selected ? palette.primaryContainer : palette.surface,
    borderColor: selected ? palette.primaryContainer : palette.borderSoft,
  };
}
