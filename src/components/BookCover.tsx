import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, F, type } from '../theme';
import { Book } from '../types';
import { Icon } from './ui/Icon';

export type ClothTint = 'parchment' | 'terracotta' | 'slate' | 'sage';

export const CLOTH: Record<ClothTint, { bg: string; fg: string }> = {
  parchment: { bg: '#f4efe6', fg: '#1c1c18' },
  terracotta: { bg: '#edd9ce', fg: '#390c00' },
  sage: { bg: '#e2eadf', fg: '#1c2e19' },
  slate: { bg: '#31302c', fg: '#f4f0e9' },
};

interface BookCoverProps {
  book: Pick<Book, 'title' | 'author' | 'coverUrl' | 'coverAlt'>;
  style: 'image' | 'typographic';
  /** Overrides cover URL (used by the live preview in the cover editor). */
  uriOverride?: string;
  tint?: ClothTint;
  /** Compact = featured card / editor preview; regular = library grid. */
  size?: 'compact' | 'regular';
  badge?: { kind: 'read' } | { kind: 'percent'; value: number };
  onEdit?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

export const SpineShadow: React.FC<{ width?: number }> = ({ width = 10 }) => (
  <LinearGradient
    pointerEvents="none"
    colors={['rgba(28,28,24,0.25)', 'rgba(28,28,24,0.05)', 'rgba(28,28,24,0)']}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 0 }}
    style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width, zIndex: 10 }}
  />
);

/** Illustrated cover, or the "Invisible Cities" typographic cloth binding. */
export const BookCover: React.FC<BookCoverProps> = ({
  book,
  style,
  uriOverride,
  tint = 'parchment',
  size = 'regular',
  badge,
  onEdit,
  containerStyle,
}) => {
  const uri = uriOverride ?? book.coverUrl;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [uri]);

  const showTypographic = style === 'typographic' || !uri || imageFailed;
  const compact = size === 'compact';
  const palette = CLOTH[tint];

  return (
    <View style={[styles.cover, containerStyle]}>
      {showTypographic ? (
        <View
          style={[
            styles.cloth,
            { backgroundColor: palette.bg, padding: compact ? 8 : 12 },
          ]}
        >
          <SpineShadow width={compact ? 8 : 10} />
          <View style={[styles.frame, { borderColor: palette.fg }]} />
          <View style={[styles.rule, { backgroundColor: palette.fg, width: compact ? 18 : 32 }]} />
          <View style={styles.titleBlock}>
            <Text
              style={[
                styles.title,
                { color: palette.fg, fontSize: compact ? 12 : 16, lineHeight: compact ? 15 : 20 },
              ]}
              numberOfLines={5}
            >
              {book.title}
            </Text>
            <Text
              style={[
                styles.author,
                { color: palette.fg, fontSize: compact ? 10 : 13, marginTop: compact ? 2 : 4 },
              ]}
              numberOfLines={2}
            >
              {book.author}
            </Text>
          </View>
          <Icon name="auto_stories" size={compact ? 13 : 16} color={palette.fg} style={{ opacity: 0.45 }} />
        </View>
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri }}
            accessibilityLabel={book.coverAlt}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
          <SpineShadow />
        </View>
      )}

      {badge ? (
        badge.kind === 'read' ? (
          <View style={[styles.badge, { backgroundColor: colors.tertiaryContainer }]}>
            <Icon name="done" size={12} color="#ffe2c2" />
            <Text style={[styles.badgeText, { color: '#ffe2c2' }]}>Read</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: 'rgba(253,249,242,0.92)' }]}>
            <Text style={[styles.badgeText, { color: colors.onSurface }]}>{badge.value}%</Text>
          </View>
        )
      ) : null}

      {onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={6}
          accessibilityLabel="Customize thumbnail"
          style={[styles.edit, compact ? { width: 24, height: 24 } : null]}
        >
          <Icon name="palette" size={compact ? 13 : 14} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  cover: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighest,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  image: { width: '100%', height: '100%' },
  cloth: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220,193,184,0.4)',
  },
  frame: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    opacity: 0.25,
  },
  rule: { height: 2, opacity: 0.3, marginTop: 4 },
  titleBlock: { alignItems: 'center', paddingHorizontal: 4 },
  title: { fontFamily: F.serifSemi, textAlign: 'center' },
  author: { fontFamily: F.serifItalic, textAlign: 'center', opacity: 0.75 },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 20,
  },
  badgeText: { ...type.labelSm },
  edit: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
});
