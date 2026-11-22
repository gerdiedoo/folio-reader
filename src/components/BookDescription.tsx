import React, { useMemo } from 'react';
import { StyleProp, Text, TextStyle, View } from 'react-native';
import { useAppTheme } from '../AppTheme';
import { parseBookDescription } from '../lib/bookDescription';
import { F, type } from '../theme';

export function BookDescription({ value, emptyText = 'No description is available for this edition.', textStyle }: {
  value?: string; emptyText?: string; textStyle?: StyleProp<TextStyle>;
}) {
  const palette = useAppTheme();
  const paragraphs = useMemo(() => parseBookDescription(value), [value]);
  const body = [{ ...type.bodyMd, color: palette.onSurfaceVariant }, textStyle];
  if (!paragraphs.length) return <Text selectable style={body}>{emptyText}</Text>;
  return <View style={{ gap: 12 }}>{paragraphs.map((paragraph, index) => (
    <Text key={index} selectable accessibilityRole={paragraph.heading ? 'header' : undefined}
      style={[body, paragraph.heading && { fontFamily: F.sansSemi }]}>
      {paragraph.runs.map((run, runIndex) => <Text key={runIndex} style={[
        run.emphasis && { fontStyle: 'italic' }, run.strong && { fontFamily: F.sansSemi },
      ]}>{run.text}</Text>)}
    </Text>
  ))}</View>;
}
