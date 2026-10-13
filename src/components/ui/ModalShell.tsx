import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

interface ModalShellProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Where the card sits on screen. */
  align?: 'center' | 'top' | 'bottom';
  maxWidth?: number;
  cardStyle?: StyleProp<ViewStyle>;
}

/**
 * Replacement for the web's `fixed inset-0` scrim + centered dialog pattern.
 * Used by every dialog and bottom sheet in the app.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  onClose,
  children,
  align = 'center',
  maxWidth = 448,
  cardStyle,
}) => {
  const insets = useSafeAreaInsets();
  const isBottom = align === 'bottom';

  return (
    <Modal
      visible
      transparent
      animationType={isBottom ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.fill,
            {
              justifyContent: isBottom ? 'flex-end' : align === 'top' ? 'flex-start' : 'center',
              paddingTop: align === 'top' ? insets.top + 56 : insets.top + 16,
              paddingBottom: isBottom ? 0 : insets.bottom + 16,
              paddingHorizontal: isBottom ? 0 : 16,
            },
          ]}
        >
          <Pressable style={styles.scrim} onPress={onClose} />
          <View
            style={[
              styles.card,
              isBottom ? styles.sheet : styles.dialog,
              { maxWidth, paddingBottom: isBottom ? insets.bottom : 0 },
              cardStyle,
            ]}
          >
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  card: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxHeight: '88%',
  },
  dialog: {
    borderRadius: 16,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  sheet: {
    backgroundColor: colors.surfaceLow,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
