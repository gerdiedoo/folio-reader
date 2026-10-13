import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { TabType } from '../types';
import { Icon, IconName } from './ui/Icon';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  visible?: boolean;
}

const TABS: { id: TabType; label: string; icon: IconName }[] = [
  { id: 'library', label: 'Library', icon: 'local_library' },
  { id: 'reading', label: 'Reading', icon: 'menu_book' },
  { id: 'notebook', label: 'Notebook', icon: 'ink_pen' },
  { id: 'settings', label: 'Settings', icon: 'tune' },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, visible = true }) => {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(visible ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 0 : 1, duration: 260, useNativeDriver: true }).start();
  }, [visible, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 120] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: 20 + insets.bottom, opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.nav}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              accessibilityState={{ selected: isActive }}
              style={styles.tab}
            >
              <Icon name={tab.icon} size={20} color={isActive ? colors.primaryContainer : colors.muted} />
              <Text style={[styles.label, { color: isActive ? colors.primaryContainer : colors.muted }]}>
                {tab.label}
              </Text>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: isActive ? colors.primaryContainer : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 50 },
  nav: {
    width: '100%',
    maxWidth: 384,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(253,249,242,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220,193,184,0.5)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
    elevation: 10,
    shadowColor: '#1f1e1d',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: { ...type.labelSm, letterSpacing: 0.4, lineHeight: 12 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
