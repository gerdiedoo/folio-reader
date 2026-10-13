import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOLIO_LOGO_URL, USER_AVATAR_URL } from '../data/initialData';
import { colors, type } from '../theme';
import { TabType } from '../types';
import { Icon } from './ui/Icon';

export const HEADER_HEIGHT = 64;

interface HeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenSearch: () => void;
  onOpenProfile: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  visible?: boolean;
  userAvatar?: string;
}

const TITLES: Record<TabType, string> = {
  library: 'Library',
  reading: 'Reader View',
  notebook: 'Notebook',
  settings: 'Settings',
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSearch,
  onOpenProfile,
  isBookmarked,
  onToggleBookmark,
  visible = true,
  userAvatar,
}) => {
  const insets = useSafeAreaInsets();
  const total = HEADER_HEIGHT + insets.top;
  const anim = useRef(new Animated.Value(visible ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 0 : 1, duration: 260, useNativeDriver: true }).start();
  }, [visible, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -total] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.header, { paddingTop: insets.top, height: total, opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          {activeTab === 'reading' && (
            <Pressable
              onPress={() => onTabChange('library')}
              accessibilityLabel="Back to Library"
              style={styles.backBtn}
            >
              <Icon name="arrow_back" size={24} color={colors.onSurface} />
            </Pressable>
          )}

          <Pressable onPress={() => onTabChange('library')} style={styles.brand}>
            <Image source={{ uri: FOLIO_LOGO_URL }} style={styles.logo} resizeMode="contain" />
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.brandLabel}>FOLIO</Text>
              <Text style={styles.title} numberOfLines={1}>
                {TITLES[activeTab]}
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.right}>
          {activeTab === 'reading' ? (
            <Pressable
              onPress={onToggleBookmark}
              accessibilityLabel="Bookmark page"
              style={[styles.iconBtn, isBookmarked && { backgroundColor: 'rgba(255,219,207,0.5)' }]}
            >
              <Icon
                name={isBookmarked ? 'bookmark' : 'bookmark_border'}
                size={22}
                color={isBookmarked ? colors.primary : colors.muted}
              />
            </Pressable>
          ) : (
            <Pressable onPress={onOpenSearch} accessibilityLabel="Search Archive" style={styles.iconBtn}>
              <Icon name="search" size={22} color={colors.muted} />
            </Pressable>
          )}

          <Pressable onPress={onOpenProfile} accessibilityLabel="Reader Profile" style={styles.iconBtn}>
            <Image source={{ uri: userAvatar || USER_AVATAR_URL }} style={styles.avatar} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    backgroundColor: 'rgba(253,249,242,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  row: {
    height: HEADER_HEIGHT,
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 8 },
  backBtn: {
    width: 40,
    height: 40,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  logo: { height: 32, width: 32 },
  brandLabel: { ...type.labelSm, color: colors.muted, lineHeight: 12, letterSpacing: 1.2 },
  title: { ...type.headlineSm, color: colors.onSurface, lineHeight: 24, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(137,52,20,0.2)',
  },
});
