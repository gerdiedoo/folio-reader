import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { F } from '../theme';

/** Bundled artwork, not a claim to reproduce a publisher's original cover. */
export function CoverIllustration({ title, author, compact }: { title: string; author: string; compact: boolean }) {
  let hash = 0;
  for (const character of `${title}\0${author}`) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  const palettes = [
    { paper: '#f3e4cb', sky: '#c9d4ce', sun: '#e0a05a', far: '#718d83', near: '#304f49', ink: '#233c36' },
    { paper: '#f1dfd4', sky: '#dfbeb2', sun: '#f2c781', far: '#a06d69', near: '#543c50', ink: '#4b303a' },
    { paper: '#e4e8de', sky: '#b9ced3', sun: '#f1d99c', far: '#6a889d', near: '#2c455d', ink: '#253e50' },
    { paper: '#eee5cd', sky: '#d4cfb3', sun: '#d89b5d', far: '#88916b', near: '#43583e', ink: '#35442d' },
  ];
  const p = palettes[hash % palettes.length];
  return (
    <View style={[styles.cover, { backgroundColor: p.paper }]} accessible={false}>
      <View style={styles.art} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 200 175" preserveAspectRatio="xMidYMid slice">
          <Rect width={200} height={175} fill={p.sky} />
          <Circle cx={hash % 2 ? 146 : 57} cy={42} r={22} fill={p.sun} />
          <Path d="M0 126 L45 52 L92 112 L133 75 L200 129 V175 H0Z" fill={p.far} />
          <Path d="M0 145 Q42 100 92 137 T200 130 V175 H0Z" fill={p.near} />
          {hash % 3 === 0 ? <Path d="M98 175 Q155 151 115 140 Q85 131 103 115 Q66 137 97 147 Q127 160 55 175Z" fill={p.sky} opacity={0.8} />
            : <Path d="M25 175 V79 M25 142 Q3 124 6 108 Q29 111 25 142 M25 121 Q48 105 45 91 Q24 97 25 121 M174 175 V99 M174 151 Q150 133 154 118 Q177 123 174 151 M174 131 Q193 115 192 105 Q173 110 174 131" stroke={p.paper} strokeWidth={2} fill={p.paper} opacity={0.8} />}
          <Path d="M65 35 Q72 29 79 35 Q86 28 93 34" fill="none" stroke={p.near} strokeWidth={1.5} />
        </Svg>
      </View>
      <View style={[styles.copy, { padding: compact ? 5 : 10 }]}>
        <Text style={[styles.title, { color: p.ink, fontSize: compact ? 11 : 15, lineHeight: compact ? 13 : 19 }]} numberOfLines={3}>{title}</Text>
        <Text style={[styles.author, { color: p.ink, fontSize: compact ? 9 : 11 }]} numberOfLines={2}>{author}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  cover: { flex: 1 }, art: { flex: 1.3, overflow: 'hidden' },
  copy: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 4 },
  title: { fontFamily: F.serifSemi, textAlign: 'center' }, author: { fontFamily: F.sans, textAlign: 'center' },
});
