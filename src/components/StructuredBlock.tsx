import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { InlineRun, RichBlock } from '../types';

interface Props {
  block: RichBlock;
  ink: string;
  accent: string;
  renderText(text: string, runs: InlineRun[], style?: object, heading?: boolean): React.ReactNode;
}
export function StructuredBlock({ block, ink, accent, renderText }: Props) {
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(block.image?.width && block.image?.height ? block.image.width / block.image.height : 1);
  if (block.kind === 'image' && block.image) {
    const image = block.image;
    return <View style={{ gap: 8 }}>
      {failed ? <Text accessibilityRole="alert" style={{ color: ink }}>This illustration could not be displayed. Its original EPUB is kept.</Text>
        : image.svg ? <SvgXml xml={image.svg} width="100%" height={undefined} style={{ width: '100%', aspectRatio: Math.max(0.125, Math.min(8, ratio)) }} accessibilityLabel={image.alt || 'Illustration'} accessible onError={() => setFailed(true)} />
        : <Image source={{ uri: image.uri }} accessibilityRole="image" accessibilityLabel={image.alt || 'Illustration'} resizeMode="contain" style={{ width: '100%', aspectRatio: Math.max(0.125, Math.min(8, ratio)) }}
          onError={() => setFailed(true)} onLoad={event => { const s = event.nativeEvent.source; if (s.width > 0 && s.height > 0) setRatio(s.width / s.height); }} />}
      {image.alt ? renderText(image.alt, [{ text: image.alt }], { fontStyle: 'italic' }) : null}
    </View>;
  }
  if (block.kind === 'table' && block.table) {
    return <View style={{ gap: 8 }}>
      {block.table.caption ? renderText(block.table.caption, [{ text: block.table.caption }], { fontWeight: '600' }) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Table; scroll horizontally to read all columns">
        <View style={{ borderWidth: 1, borderColor: accent }}>
          {block.table.rows.map((row, r) => <View key={r} style={{ flexDirection: 'row' }}>
            {row.map((cell, c) => <View key={c} style={{ width: 160, padding: 10, borderRightWidth: c < row.length - 1 ? 1 : 0, borderBottomWidth: r < block.table!.rows.length - 1 ? 1 : 0, borderColor: accent }}>
              {renderText(cell.text, cell.runs, cell.header ? { fontWeight: '700' } : undefined, cell.header)}
            </View>)}
          </View>)}
        </View>
      </ScrollView>
    </View>;
  }
  const style = block.kind === 'heading' ? { fontWeight: '700' as const, marginBottom: 6 }
    : block.kind === 'code' ? { fontFamily: 'monospace', textAlign: 'left' as const }
    : block.kind === 'caption' ? { fontStyle: 'italic' as const } : {};
  return <View style={block.kind === 'quote' || block.quoteDepth ? { borderLeftWidth: 2, borderLeftColor: accent, paddingLeft: 12 } : undefined}>
    {block.kind === 'list-item' ? <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text accessible={false} style={{ color: ink, minWidth: 20, paddingTop: 3 }}>{block.marker}</Text>
      <View style={{ flex: 1 }}>{renderText(block.text, block.runs, style)}</View>
    </View> : renderText(block.text, block.runs, style, block.kind === 'heading')}
  </View>;
}
