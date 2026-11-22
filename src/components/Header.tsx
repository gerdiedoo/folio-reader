import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { useAppTheme } from '../AppTheme';
import { useReducedMotion } from '../MotionPreferences';
import { TabType } from '../types';
import { Icon } from './ui/Icon';

export const HEADER_HEIGHT = 64;
const FOLIO_LOGO = require('../../assets/folio-logo.png');

interface HeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenSearch: () => void;
  onOpenProfile: () => void;
  visible?: boolean;
  userAvatar?: string;
  detailsTitle?: string;
  onBackFromDetails?: () => void;
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
  visible = true,
  userAvatar,
  detailsTitle,
  onBackFromDetails,
}) => {
  const insets = useSafeAreaInsets();
  const palette = useAppTheme();
  const reducedMotion = useReducedMotion();
  const total = HEADER_HEIGHT + insets.top;
  const anim = useRef(new Animated.Value(visible ? 0 : 1)).current;

  useEffect(() => {
    anim.stopAnimation();
    if (reducedMotion) { anim.setValue(visible ? 0 : 1); return; }
    const transition = Animated.timing(anim, { toValue: visible ? 0 : 1, duration: 260, useNativeDriver: true });
    transition.start();
    return () => transition.stop();
  }, [visible, anim, reducedMotion]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -total] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.header,
        {
          backgroundColor: palette.surface,
          borderBottomColor: palette.borderSoft,
          paddingTop: insets.top,
          height: total,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          {detailsTitle ? (
            <>
              <Pressable
                onPress={onBackFromDetails}
                accessibilityLabel="Back to Library"
                accessibilityRole="button"
                style={styles.backBtn}
              >
                <Icon name="arrow_back" size={24} color={palette.onSurface} />
              </Pressable>
              <View style={{ flexShrink: 1 }}>
                <Text style={[styles.brandLabel, { color: palette.muted }]}>BOOK DETAILS</Text>
                <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={1}>
                  {detailsTitle}
                </Text>
              </View>
            </>
          ) : activeTab === 'reading' ? (
            <Pressable
              onPress={() => onTabChange('library')}
              accessibilityLabel="Back to Library"
              accessibilityRole="button"
              style={styles.backBtn}
            >
              <Icon name="arrow_back" size={24} color={palette.onSurface} />
            </Pressable>
          ) : null}

          {!detailsTitle ? (
            <Pressable onPress={() => onTabChange('library')} accessibilityRole="button" accessibilityLabel="Folio Library" style={styles.brand}>
              <Image testID="folio-header-mark" source={FOLIO_LOGO} accessible={false} style={styles.logo} resizeMode="contain" />
              <View style={{ flexShrink: 1 }}>
                <Text style={[styles.brandLabel, { color: palette.muted }]}>FOLIO</Text>
                <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={1}>
                  {TITLES[activeTab]}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.right}>
          {!detailsTitle && activeTab !== 'reading' && (
            <Pressable onPress={onOpenSearch} accessibilityRole="button" accessibilityLabel={activeTab === 'library' ? 'Search Library' : 'Search Archive'} style={styles.iconBtn}>
              <Icon name="search" size={22} color={palette.muted} />
            </Pressable>
          )}

          {!detailsTitle ? (
            <Pressable onPress={onOpenProfile} accessibilityRole="button" accessibilityLabel="Reader Profile" style={styles.iconBtn}>
              {userAvatar ? (
                <Image source={{ uri: userAvatar }} style={styles.avatar} />
              ) : (
                <Icon name="account_circle" size={32} color={palette.muted} />
              )}
            </Pressable>
          ) : null}
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
    width: 48,
    height: 48,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minHeight: 48 },
  logo: { height: 32, width: 32, backgroundColor: '#F7F2E9', borderRadius: 7 },
  brandLabel: { ...type.labelSm, color: colors.muted, lineHeight: 12, letterSpacing: 1.2 },
  title: { ...type.headlineSm, color: colors.onSurface, lineHeight: 24, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 48,
    height: 48,
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
