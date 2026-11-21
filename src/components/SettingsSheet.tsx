import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { READER_FONTS, normalizeReaderSettings, readerTextMetrics } from '../lib/readerPreferences';
import { INITIAL_SETTINGS } from '../data/initialData';
import { F, previewPaper, readerFontFamily, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LineSpacing, Margins, PaperTheme, ReadingSettings } from '../types';
import { Icon, IconName } from './ui/Icon';
import { choiceAppearance, choiceStyles } from './ui/choiceStyles';
import { ModalShell } from './ui/ModalShell';

interface SettingsSheetProps {
  settings: ReadingSettings;
  onSave: (changes: Partial<ReadingSettings>) => Promise<boolean>;
  saveStatus?: 'loading' | 'ready' | 'error';
  saveNotice?: string | null;
  saveBusy?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  /** True when shown as a modal bottom sheet over the reader; false for the Settings tab. */
  isSheetOnly?: boolean;
  /** Bottom padding so the inline (tab) version clears the floating nav. */
  bottomSpace?: number;
}

type SheetTab = 'font' | 'themes' | 'info';

const TOTAL_STEPS = 8;

const THEME_OPTIONS: { id: PaperTheme; label: string }[] = [
  { id: 'parchment', label: 'Parchment' },
  { id: 'white', label: 'White' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'charcoal', label: 'Charcoal' },
];

const SPACING_OPTIONS: { id: LineSpacing; icon: IconName }[] = [
  { id: 'compact', icon: 'format_align_justify' },
  { id: 'standard', icon: 'format_line_spacing' },
  { id: 'loose', icon: 'density_large' },
];

const MARGIN_OPTIONS: { id: Margins; icon: IconName }[] = [
  { id: 'narrow', icon: 'view_day' },
  { id: 'regular', icon: 'format_indent_increase' },
  { id: 'wide', icon: 'vertical_split' },
];


export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  settings,
  onSave,
  onClose,
  saveStatus = 'ready',
  saveNotice = null,
  saveBusy = false,
  onRetry,
  isSheetOnly = false,
  bottomSpace = 24,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [local, setLocal] = useState<ReadingSettings>(() => normalizeReaderSettings(settings));
  const dirty = useRef(new Set<keyof ReadingSettings>());
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = saving || saveBusy;
  useEffect(() => {
    setLocal(previous => {
      const next = normalizeReaderSettings(settings);
      for (const key of dirty.current) Object.assign(next, { [key]: previous[key] });
      return next;
    });
  }, [settings]);
  const close = () => { if (!pending.current && !saveBusy) onClose(); };
  const [activeTab, setActiveTab] = useState<SheetTab>('font');

  const step = local.fontSizeStep;
  const metrics = readerTextMetrics(local);
  const flowMode = local.readingFlowMode || 'continuous';
  const coverStyle = local.defaultCoverStyle || 'image';
  const paper = previewPaper[local.theme];

  const update = (partial: Partial<ReadingSettings>) => {
    if (pending.current || saveBusy) return;
    for (const key of Object.keys(partial) as (keyof ReadingSettings)[]) dirty.current.add(key);
    setLocal(previous => normalizeReaderSettings({ ...previous, ...partial }));
    setError(null);
  };

  const apply = async () => {
    if (!mounted.current || pending.current || saveBusy || saveStatus !== 'ready') return;
    const changes: Partial<ReadingSettings> = {};
    for (const key of dirty.current) Object.assign(changes, { [key]: local[key] });
    pending.current = true; setSaving(true); setError(null);
    try {
      const saved = await onSave(changes);
      if (!mounted.current) return;
      if (saved) { dirty.current.clear(); onClose(); }
      else setError('Your choices have been kept here. Try saving again.');
    } catch { if (mounted.current) setError('Your choices have been kept here. Try saving again.'); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  };

  const reset = () => update({ ...INITIAL_SETTINGS });

  const tabs: { id: SheetTab; label: string; icon: IconName }[] = [
    { id: 'font', label: 'Font & Layout', icon: 'menu_book' },
    { id: 'themes', label: 'Themes', icon: 'palette' },
    { id: 'info', label: 'Reading Info', icon: 'speed' },
  ];

  const body = (
    <>
      <View style={styles.headerWrap}>
        {isSheetOnly && <View style={styles.handle} />}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Icon name="format_size" size={22} color={colors.primary} />
            <Text accessibilityRole="header" style={styles.headerTitle}>Reading settings</Text>
          </View>
          {isSheetOnly && (
            <Pressable disabled={locked} onPress={close} accessibilityRole="button" accessibilityLabel="Close Settings" style={styles.closeBtn}>
              <Icon name="close" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segment} keyboardShouldPersistTaps="handled">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setActiveTab(t.id)}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: active }}
                style={choiceStyles.target}
              >
                <View style={[choiceStyles.face, choiceAppearance(colors, active)]} pointerEvents="none">
                  <Icon name={t.icon} size={16} color={active ? colors.onPrimaryContainer : colors.onSurface} />
                  <Text style={[styles.segText, { color: active ? colors.onPrimaryContainer : colors.onSurface }]}>
                    {t.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Preview is useful for font and theme choices; Reading Info stays compact. */}
        {activeTab !== 'info' && <View style={[styles.preview, { backgroundColor: paper.bg }]}>
          <View style={styles.previewHead}>
            <Text style={[styles.previewLabel, { color: paper.fg }]}>LIVE TYPOGRAPHY PREVIEW</Text>
            <Text style={[styles.previewFont, { color: paper.fg }]}>
              {local.font} · Size {metrics.fontSize}
            </Text>
          </View>
          <Text
            style={{
              color: paper.fg,
              fontFamily: readerFontFamily(local.font),
              fontSize: metrics.fontSize,
              lineHeight: metrics.lineHeight,
            }}
          >
            “There is no frigate like a book to take us lands away, nor any coursers like a page of prancing poetry.”
          </Text>
          <Text style={[styles.previewAuthor, { color: paper.fg }]}>— Emily Dickinson</Text>
        </View>}

        {activeTab === 'font' && (
          <>
            {/* Typeface */}
            <View style={{ gap: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.fieldLabel}>TYPEFACE</Text>
                <Text style={styles.fieldHint}>
                  {local.font === 'Literata' || local.font === 'EB Garamond' || local.font === 'System Serif'
                    ? 'Serif'
                    : 'Sans serif'}
                </Text>
              </View>
              <View style={styles.pillWrap}>
                {READER_FONTS.map((f) => {
                  const selected = local.font === f;
                  return (
                    <Pressable
                      key={f}
                      onPress={() => update({ font: f })}
                      accessibilityRole="button"
                      accessibilityLabel={`${f} typeface`}
                      disabled={locked}
                      accessibilityState={{ selected, ...(locked ? { disabled: true } : {}) }}
                      style={[choiceStyles.target, styles.fittedChoice]}
                    >
                      <View style={[choiceStyles.face, choiceAppearance(colors, selected)]} pointerEvents="none">
                        {selected && <Icon name="check_small" size={16} color={colors.onPrimaryContainer} />}
                        <Text style={[styles.fontPillText, { color: selected ? colors.onPrimaryContainer : colors.onSurface }]}>
                          {f}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={[type.bodySm, { color: colors.muted }]}>
              Publisher layout and ornamentation are not preserved in this reader.
            </Text>

            {/* Font size */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.fieldLabel}>FONT SIZE</Text>
                <Text style={styles.stepText}>
                  Step {step} / {TOTAL_STEPS}
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => update({ fontSizeStep: Math.max(1, step - 1) })}
                  style={[styles.stepBtn, step <= 1 && { opacity: 0.35 }]}
                  accessibilityLabel="Decrease text size"
                  accessibilityRole="button"
                  disabled={locked || step <= 1}
                  accessibilityState={{ disabled: locked || step <= 1 }}
                >
                  <Text style={{ fontFamily: F.serifSemi, fontSize: 15, color: colors.onSurface }}>Aa-</Text>
                </Pressable>

                <View
                  style={styles.track}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Text size"
                  accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step, text: `${metrics.fontSize} points, size ${step} of ${TOTAL_STEPS}` }}
                  accessibilityState={{ disabled: locked }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={({ nativeEvent }) => {
                    const delta = nativeEvent.actionName === 'increment' ? 1 : nativeEvent.actionName === 'decrement' ? -1 : 0;
                    if (delta) update({ fontSizeStep: Math.max(1, Math.min(TOTAL_STEPS, step + delta)) });
                  }}
                >
                  {Array.from({ length: TOTAL_STEPS }).map((_, idx) => {
                    const n = idx + 1;
                    const isCurrent = n === step;
                    const isPast = n < step;
                    return (
                      <React.Fragment key={n}>
                        <Pressable accessible={false} importantForAccessibility="no" onPress={() => update({ fontSizeStep: n })} hitSlop={8}>
                          <View
                            style={
                              isCurrent
                                ? styles.dotCurrent
                                : [styles.dot, { backgroundColor: isPast ? colors.primary : colors.secondaryFixedDim }]
                            }
                          />
                        </Pressable>
                        {idx < TOTAL_STEPS - 1 && (
                          <View
                            style={[
                              styles.seg,
                              { backgroundColor: isPast ? 'rgba(137,52,20,0.4)' : colors.secondaryFixedDim },
                            ]}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </View>

                <Pressable
                  onPress={() => update({ fontSizeStep: Math.min(TOTAL_STEPS, step + 1) })}
                  style={[styles.stepBtn, step >= TOTAL_STEPS && { opacity: 0.35 }]}
                  accessibilityLabel="Increase text size"
                  accessibilityRole="button"
                  disabled={locked || step >= TOTAL_STEPS}
                  accessibilityState={{ disabled: locked || step >= TOTAL_STEPS }}
                >
                  <Text style={{ fontFamily: F.serifSemi, fontSize: 20, color: colors.onSurface }}>Aa+</Text>
                </Pressable>
              </View>
            </View>

            {/* Line spacing & margins */}
            <View style={styles.layoutOptions}>
              <View style={styles.layoutGroup}>
                <Text style={styles.fieldLabel}>LINE SPACING</Text>
                <View style={styles.iconSegment}>
                  {SPACING_OPTIONS.map((o) => {
                    const selected = local.lineSpacing === o.id;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => update({ lineSpacing: o.id })}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.id} line spacing`}
                        disabled={locked}
                        accessibilityState={{ selected, ...(locked ? { disabled: true } : {}) }}
                        style={[styles.iconSegBtn, selected && { backgroundColor: colors.surfaceContainer }]}
                      >
                        <Icon name={o.icon} size={18} color={selected ? colors.primary : colors.muted} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.layoutGroup}>
                <Text style={styles.fieldLabel}>MARGINS</Text>
                <View style={styles.iconSegment}>
                  {MARGIN_OPTIONS.map((o) => {
                    const selected = local.margins === o.id;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => update({ margins: o.id })}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.id} margins`}
                        disabled={locked}
                        accessibilityState={{ selected, ...(locked ? { disabled: true } : {}) }}
                        style={[styles.iconSegBtn, selected && { backgroundColor: colors.surfaceContainer }]}
                      >
                        <Icon name={o.icon} size={18} color={selected ? colors.primary : colors.muted} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </>
        )}

        {activeTab === 'themes' && (
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>PAGE SURFACE &amp; TONE</Text>
            <View style={styles.choiceRow}>
              {THEME_OPTIONS.map((t) => {
                const selected = local.theme === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => update({ theme: t.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.label} page theme`}
                    disabled={locked}
                    accessibilityState={{ selected, ...(locked ? { disabled: true } : {}) }}
                    style={[choiceStyles.target, styles.fittedChoice]}
                  >
                    <View style={[choiceStyles.face, choiceAppearance(colors, selected)]} pointerEvents="none">
                      <View style={[styles.swatch, { backgroundColor: previewPaper[t.id].bg }]}>
                        {selected && <Icon name="check" size={14} color={previewPaper[t.id].fg} />}
                      </View>
                      <Text style={[styles.choiceText, { color: selected ? colors.onPrimaryContainer : colors.onSurface }]}>{t.label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {activeTab === 'info' && (
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.switchTitle}>Reading time</Text>
                <Text style={styles.switchSub}>Show an estimate for the current passage.</Text>
              </View>
              <Switch
                disabled={locked}
                accessibilityLabel="Display estimated reading time"
                value={local.displayReadingPace}
                onValueChange={(v) => update({ displayReadingPace: v })}
                trackColor={{ false: colors.secondaryFixedDim, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.divider} />

            <View style={{ gap: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.switchTitle}>Reading mode</Text>
                <Text style={styles.fieldHint}>
                  {flowMode === 'paginated'
                    ? 'Page by Page'
                    : flowMode === 'single-line'
                    ? 'Single Line'
                    : 'Non-Stop Scroll'}
                </Text>
              </View>
              <Text style={styles.switchSub}>
                Scroll continuously, turn pages, or read one word at a time in Line mode.
              </Text>
              <View style={styles.choiceRow}>
                <ChoiceButton
                  disabled={locked}
                  icon="unfold_more"
                  label="Non-Stop Scroll"
                  active={flowMode === 'continuous'}
                  onPress={() => update({ readingFlowMode: 'continuous' })}
                />
                <ChoiceButton
                  disabled={locked}
                  icon="auto_stories"
                  label="Page by Page"
                  active={flowMode === 'paginated'}
                  onPress={() => update({ readingFlowMode: 'paginated' })}
                />
                <ChoiceButton
                  disabled={locked}
                  icon="play_arrow"
                  label="Single Line"
                  active={flowMode === 'single-line'}
                  onPress={() => update({ readingFlowMode: 'single-line' })}
                />
              </View>
            </View>

            <View style={styles.divider} />

            <View style={{ gap: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.switchTitle}>Default cover style</Text>
                <Text style={styles.fieldHint}>
                  {coverStyle === 'typographic' ? 'Typographic Text' : 'Illustrated Image'}
                </Text>
              </View>
              <Text style={styles.switchSub}>
                Used when a book has no saved cover style. Edit a saved cover in Library to change it.
              </Text>
              <View style={styles.choiceRow}>
                <ChoiceButton
                  disabled={locked}
                  icon="image"
                  label="Illustrated"
                  active={coverStyle === 'image'}
                  onPress={() => update({ defaultCoverStyle: 'image' })}
                />
                <ChoiceButton
                  disabled={locked}
                  icon="title"
                  label="Typographic"
                  active={coverStyle === 'typographic'}
                  onPress={() => update({ defaultCoverStyle: 'typographic' })}
                />
              </View>
            </View>
          </View>
        )}

        {(saveStatus === 'loading' || saveNotice || error) && (
          <View style={styles.card}>
            <Text accessibilityLiveRegion="polite" style={[type.bodySm, { color: colors.onSurface }]}>
              {saveStatus === 'loading' ? 'Loading saved reading preferences…' : error || saveNotice}
            </Text>
            {onRetry && saveStatus !== 'loading' && saveNotice && (
              <Pressable onPress={onRetry} disabled={locked} accessibilityRole="button" accessibilityLabel="Try loading reading preferences again" accessibilityState={{ disabled: locked }} style={styles.actionBtn}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Try again</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.actionRow}>
          <Pressable disabled={locked} onPress={reset} accessibilityRole="button" accessibilityLabel="Reset Defaults" accessibilityState={{ disabled: locked }} style={[styles.actionBtn, styles.actionSlot, { backgroundColor: colors.surfaceContainer }]}>
            <Text style={[styles.actionText, { color: colors.muted }]}>Reset Defaults</Text>
          </Pressable>
          <Pressable disabled={locked || saveStatus !== 'ready'} onPress={apply} accessibilityRole="button" accessibilityLabel="Keep Changes" accessibilityState={{ disabled: locked || saveStatus !== 'ready', busy: saving }} style={[styles.actionBtn, styles.actionSlot, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.actionText, { color: '#fff' }]}>{saving ? 'Saving…' : 'Keep Changes'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );

  if (isSheetOnly) {
    return (
      <ModalShell onClose={close} align="bottom" maxWidth={512} cardStyle={{ maxHeight: '88%' }}>
        {body}
      </ModalShell>
    );
  }

  return <View style={styles.inline}>{body}</View>;
};

const ChoiceButton: React.FC<{
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}> = ({ icon, label, active, onPress, disabled = false }) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ selected: active, ...(disabled ? { disabled: true } : {}) }}
      style={[choiceStyles.target, styles.fittedChoice]}
    >
      <View style={[choiceStyles.face, choiceAppearance(colors, active)]} pointerEvents="none">
        <Icon name={icon} size={17} color={active ? colors.onPrimaryContainer : colors.onSurface} />
        <Text style={[styles.choiceText, { color: active ? colors.onPrimaryContainer : colors.onSurface }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  inline: {
    flex: 1,
    backgroundColor: colors.surfaceLow,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerWrap: { paddingTop: 12, paddingBottom: 8, paddingHorizontal: 20, backgroundColor: colors.surfaceLow },
  handle: { width: 40, height: 6, borderRadius: 3, backgroundColor: colors.secondaryFixedDim, alignSelf: 'center', marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  headerTitle: { ...type.headlineSm, color: colors.onSurface, flexShrink: 1 },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segText: { ...type.labelMd },
  scroller: { flexShrink: 1, minHeight: 0 },
  content: { paddingHorizontal: 20, paddingTop: 0, gap: 14 },
  preview: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  previewHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', marginBottom: 8 },
  previewLabel: { ...type.labelSm, color: colors.muted },
  previewFont: { ...type.labelSm, color: colors.primary },
  previewAuthor: { ...type.labelSm, opacity: 0.7, fontStyle: 'italic', textAlign: 'right', marginTop: 8 },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...type.labelMd, color: colors.muted, letterSpacing: 0.8 },
  fieldHint: { ...type.labelSm, color: colors.primary },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fontPillText: { ...type.labelMd, flexShrink: 1 },
  card: {
    gap: 10,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  stepText: { ...type.labelMd, color: colors.primary, fontFamily: F.sansBold },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotCurrent: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.primaryFixed,
  },
  seg: { flex: 1, height: 2 },
  iconSegment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 4,
    borderRadius: 12,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  layoutOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  layoutGroup: { flexGrow: 1, flexBasis: 168, minWidth: 168, gap: 6 },
  iconSegBtn: { flex: 1, minWidth: 48, minHeight: 48, justifyContent: 'center', paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 0 },
  fittedChoice: { maxWidth: '100%' },
  swatch: {
    width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchTitle: { fontFamily: F.sansSemi, fontSize: 14, color: colors.onSurface },
  switchSub: { fontFamily: F.sans, fontSize: 12, lineHeight: 16, color: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  choiceText: { ...type.labelMd, flexShrink: 1 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  actionSlot: { flexGrow: 1, flexBasis: 136, minWidth: 136 },
  actionBtn: { minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.labelLg, textAlign: 'center', flexShrink: 1 },
});
