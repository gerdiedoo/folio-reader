import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../../theme';
import { Icon } from './Icon';

interface ToastProps {
  message: string | null;
  bottom: number;
}

/** Floating confirmation pill. Replaces the reader-only "ambient toast" so every tab can use it. */
export const Toast: React.FC<ToastProps> = ({ message, bottom }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState('');

  useEffect(() => {
    if (message) {
      setShown(message);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }
  }, [message, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { bottom, opacity }]}>
      <View style={styles.pill}>
        <Icon name="check_circle" size={14} color={colors.tertiaryFixed} />
        <Text style={styles.text} numberOfLines={2}>
          {shown}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.onSurface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: 360,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { ...type.labelSm, color: colors.surface, flexShrink: 1 },
});
