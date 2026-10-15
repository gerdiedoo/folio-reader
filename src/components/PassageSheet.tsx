import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { HighlightColorName, HighlightEntry } from '../types';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

export const HIGHLIGHT_COLORS: { name: HighlightColorName; hex: string; label: string }[] = [
  { name: 'Amber Crayon', hex: '#F8E8A2', label: 'Amber' },
  { name: 'Terracotta Ink', hex: '#ffb59c', label: 'Terracotta' },
  { name: 'Sage Pencil', hex: '#d8ebd5', label: 'Sage' },
  { name: 'Lavender Quill', hex: '#e5dbff', label: 'Lavender' },
];

interface PassageSheetProps {
  /** The paragraph the user long-pressed. */
  text: string;
  /** Text to pre-select (an existing highlight, or the default suggestion). */
  initialSelection?: string;
  /** Present when the user tapped an already-saved highlight. */
  existing?: HighlightEntry | null;
  onClose: () => void;
  onHighlight: (selected: string, color: (typeof HIGHLIGHT_COLORS)[number]) => void;
  onSaveNote: (selected: string, color: (typeof HIGHLIGHT_COLORS)[number], note: string) => void;
  onDefine: (word: string, context: string) => void;
  onCopy: (selected: string) => void;
  onDelete?: () => void;
}

interface Token {
  start: number;
  end: number; // exclusive
  word: string;
  gap: string;
}

interface PassageWordProps {
  token: Token;
  index: number;
  selected: boolean;
  selectedStyle: object;
  onPressWord: (index: number) => void;
}

const PassageWord = React.memo<PassageWordProps>(
  ({ token, index, selected, selectedStyle, onPressWord }) => {
    const handlePress = useCallback(() => onPressWord(index), [index, onPressWord]);
    return (
      <Text onPress={handlePress} style={selected ? selectedStyle : undefined}>
        {token.gap}
        {token.word}
      </Text>
    );
  }
);

/**
 * React Native has no browser-style text selection with a floating toolbar, so
 * the reader opens this sheet on long-press. Tap a word to start a selection and
 * a second word to extend it; the actions below then apply to the selected range.
 */
export const PassageSheet: React.FC<PassageSheetProps> = ({
  text,
  initialSelection,
  existing,
  onClose,
  onHighlight,
  onSaveNote,
  onDefine,
  onCopy,
  onDelete,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tokens = useMemo<Token[]>(() => {
    const out: Token[] = [];
    const re = /\S+/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      out.push({ start: m.index, end, word: m[0], gap: text.slice(cursor, m.index) });
      cursor = end;
    }
    return out;
  }, [text]);

  const initialRange = useMemo<{ a: number; b: number } | null>(() => {
    const target = initialSelection || existing?.text;
    if (!target) return null;
    const idx = text.indexOf(target);
    if (idx < 0) return null;
    const end = idx + target.length;
    let first = -1;
    let last = -1;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.start >= end) break;
      if (token.end > idx) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return first >= 0 ? { a: first, b: last } : null;
  }, [text, tokens, initialSelection, existing]);

  const [range, setRange] = useState<{ a: number; b: number } | null>(initialRange);
  const [activeColor, setActiveColor] = useState(
    HIGHLIGHT_COLORS.find((c) => c.name === existing?.colorName) ?? HIGHLIGHT_COLORS[0]
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(existing?.note ?? '');

  const selected = range ? text.slice(tokens[range.a].start, tokens[range.b].end) : '';
  const hasSelection = selected.length > 0;

  const onWordPress = useCallback((i: number) => {
    setRange((prev) => {
      if (!prev) return { a: i, b: i };
      if (prev.a === prev.b && prev.a !== i) return { a: Math.min(prev.a, i), b: Math.max(prev.a, i) };
      return { a: i, b: i };
    });
  }, []);

  const handleDefine = () => {
    const first = selected.split(/\s+/)[0] || '';
    const word = first.replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, '');
    onDefine(word, selected);
  };

  const handleSaveNote = () => {
    if (!note.trim()) return;
    onSaveNote(selected, activeColor, note.trim());
  };

  const selectedStyle = useMemo(
    () => ({ backgroundColor: activeColor.hex, color: colors.onSurface }),
    [activeColor.hex, colors.onSurface]
  );
  const rendered = tokens.map((token, index) => (
    <PassageWord
      key={index}
      token={token}
      index={index}
      selected={range ? index >= range.a && index <= range.b : false}
      selectedStyle={selectedStyle}
      onPressWord={onWordPress}
    />
  ));

  return (
    <ModalShell onClose={onClose} align="bottom" maxWidth={560} cardStyle={{ maxHeight: '86%' }}>
      <View style={styles.handle} />
      <View style={styles.titleRow}>
        <Text style={styles.title}>{existing ? 'Highlight' : 'Select Passage'}</Text>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Tap a word to start, then tap another to extend the selection.
      </Text>

      <ScrollView style={styles.passageScroll} contentContainerStyle={styles.passageBox} keyboardShouldPersistTaps="handled">
        <Text style={styles.passage}>{rendered}</Text>
      </ScrollView>

      <View style={styles.actions}>
        <View style={styles.colorRow}>
          {HIGHLIGHT_COLORS.map((c) => (
            <Pressable
              key={c.name}
              onPress={() => setActiveColor(c)}
              accessibilityLabel={c.label}
              style={[
                styles.colorDot,
                { backgroundColor: c.hex },
                activeColor.name === c.name && styles.colorDotActive,
              ]}
            />
          ))}
          <Text style={styles.colorLabel}>{activeColor.label}</Text>
        </View>

        <View style={styles.buttonRow}>
          <ActionButton
            icon="format_ink_highlighter"
            label="Highlight"
            disabled={!hasSelection}
            onPress={() => onHighlight(selected, activeColor)}
          />
          <ActionButton
            icon="edit_note"
            label="Note"
            disabled={!hasSelection}
            active={noteOpen}
            onPress={() => setNoteOpen((o) => !o)}
          />
          <ActionButton icon="menu_book" label="Define" disabled={!hasSelection} onPress={handleDefine} />
          <ActionButton
            icon="content_copy"
            label="Copy"
            disabled={!hasSelection && !existing}
            onPress={() => onCopy(selected || existing?.text || '')}
          />
          {existing && onDelete ? (
            <ActionButton icon="delete" label="Delete" danger onPress={onDelete} />
          ) : null}
        </View>

        {noteOpen && (
          <View style={{ gap: 8 }}>
            <TextInput
              autoFocus
              multiline
              value={note}
              onChangeText={setNote}
              placeholder="Add reflection or marginalia note..."
              placeholderTextColor={colors.muted}
              style={styles.noteInput}
            />
            <View style={styles.noteButtons}>
              <Pressable onPress={() => setNoteOpen(false)} style={{ padding: 8 }}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveNote} style={styles.saveNote}>
                <Text style={styles.saveNoteText}>Save Note</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ModalShell>
  );
};

const ActionButton: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}> = ({ icon, label, onPress, disabled, active, danger }) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.action,
        active && { backgroundColor: colors.primaryFixed },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Icon name={icon} size={20} color={danger ? colors.danger : colors.primary} />
      <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  handle: {
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondaryFixedDim,
    alignSelf: 'center',
    marginTop: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  title: { ...type.headlineSm, color: colors.onSurface },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  hint: { ...type.bodySm, color: colors.muted, paddingHorizontal: 20, paddingBottom: 8 },
  passageScroll: { maxHeight: 240, flexGrow: 0 },
  passageBox: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  passage: { fontFamily: F.serif, fontSize: 18, lineHeight: 28, color: colors.onSurface },
  actions: { padding: 16, gap: 12 },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  colorDotActive: { borderWidth: 2, borderColor: colors.primary, transform: [{ scale: 1.1 }] },
  colorLabel: { ...type.labelMd, color: colors.muted, marginLeft: 4 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
  },
  actionLabel: { fontFamily: F.sansSemi, fontSize: 11, color: colors.onSurface },
  noteInput: {
    minHeight: 64,
    maxHeight: 120,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: F.sans,
    fontSize: 13,
    color: colors.onSurface,
    textAlignVertical: 'top',
  },
  noteButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  cancel: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  saveNote: { backgroundColor: colors.primaryContainer, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  saveNoteText: { fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
});
