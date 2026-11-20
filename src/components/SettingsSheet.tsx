import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { READER_FONTS, normalizeReaderSettings, readerTextMetrics } from '../lib/readerPreferences';
import { INITIAL_SETTINGS } from '../data/initialData';
import { colors, F, previewPaper, readerFontFamily, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { LineSpacing, Margins, PaperTheme, ReadingSettings } from '../types';
import { Icon, IconName } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';

interface SettingsSheetProps {
  settings: ReadingSettings;
  onSave: (settings: ReadingSettings) => void;
  onClose: () => void;
  /** True when shown as a modal bottom sheet over the reader; false for the Settings tab. */
  isSheetOnly?: boolean;
  /** Bottom padding so the inline (tab) version clears the floating nav. */
  bottomSpace?: number;
}

type SheetTab = 'font' | 'themes' | 'info';

const TOTAL_STEPS = 8;

const THEME_OPTIONS: { id: PaperTheme; label: string; swatch: string; check: string; border?: boolean }[] = [
  { id: 'parchment', label: 'Parchment', swatch: '#fdf9f2', check: colors.primary },
  { id: 'white', label: 'White', swatch: '#ffffff', check: colors.primary },
  { id: 'sepia', label: 'Sepia', swatch: '#ffddb6', check: colors.tertiary },
  { id: 'charcoal', label: 'Charcoal', swatch: '#31302c', check: '#f4f0e9' },
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
  isSheetOnly = false,
  bottomSpace = 24,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [local, setLocal] = useState<ReadingSettings>(() => normalizeReaderSettings(settings));
  const [activeTab, setActiveTab] = useState<SheetTab>('font');

  const step = local.fontSizeStep;
  const metrics = readerTextMetrics(local);
  const flowMode = local.readingFlowMode || 'continuous';
  const coverStyle = local.defaultCoverStyle || 'image';
  const paper = previewPaper[local.theme];

  const update = (partial: Partial<ReadingSettings>) => setLocal((prev) => normalizeReaderSettings({ ...prev, ...partial }));

  const apply = () => {
    onSave(local);
    onClose();
  };

  const reset = () => setLocal({ ...INITIAL_SETTINGS });

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
            <Text style={styles.headerTitle}>Typography &amp; Layout</Text>
          </View>
          {isSheetOnly && (
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close Settings" style={styles.closeBtn}>
              <Icon name="close" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <View style={styles.segment}>
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setActiveTab(t.id)}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: active }}
                style={[styles.segBtn, active && styles.segBtnActive]}
              >
                <Icon name={t.icon} size={16} color={active ? colors.primary : colors.muted} />
                <Text style={[styles.segText, { color: active ? colors.primary : colors.muted }]} numberOfLines={1}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Live preview */}
        <View style={[styles.preview, { backgroundColor: paper.bg }]}>
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
        </View>

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
                      accessibilityState={{ selected }}
                      style={[styles.fontPill, { backgroundColor: selected ? colors.primaryContainer : colors.surface }]}
                    >
                      {selected && <Icon name="check_small" size={16} color="#fff" />}
                      <Text style={[styles.fontPillText, { color: selected ? '#fff' : colors.onSurface }]}>
                        {f}
                      </Text>
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
                  disabled={step <= 1}
                  accessibilityState={{ disabled: step <= 1 }}
                >
                  <Text style={{ fontFamily: F.serifSemi, fontSize: 15, color: colors.onSurface }}>Aa-</Text>
                </Pressable>

                <View
                  style={styles.track}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Text size"
                  accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step, text: `${metrics.fontSize} points, size ${step} of ${TOTAL_STEPS}` }}
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
                  disabled={step >= TOTAL_STEPS}
                  accessibilityState={{ disabled: step >= TOTAL_STEPS }}
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
                        accessibilityState={{ selected }}
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
                        accessibilityState={{ selected }}
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
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {THEME_OPTIONS.map((t) => {
                const selected = local.theme === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => update({ theme: t.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.label} page theme`}
                    accessibilityState={{ selected }}
                    style={[
                      styles.themeBtn,
                      selected
                        ? { backgroundColor: colors.surfaceContainer, borderColor: 'rgba(137,52,20,0.3)' }
                        : { backgroundColor: colors.surfaceLow, borderColor: 'transparent' },
                    ]}
                  >
                    <View style={[styles.swatch, { backgroundColor: t.swatch }]}>
                      {selected && <Icon name="check" size={20} color={t.check} />}
                    </View>
                    <Text
                      style={{
                        fontFamily: selected ? F.sansSemi : F.sans,
                        fontSize: 11,
                        color: selected ? colors.onSurface : colors.muted,
                      }}
                    >
                      {t.label}
                    </Text>
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
                <Text style={styles.switchTitle}>Display Reading Pace</Text>
                <Text style={styles.switchSub}>Show an approximate time based on passage length</Text>
              </View>
              <Switch
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
                <Text style={styles.switchTitle}>Reading Flow Mode</Text>
                <Text style={styles.fieldHint}>
                  {flowMode === 'paginated'
                    ? 'Page by Page'
                    : flowMode === 'single-line'
                    ? 'Single Line'
                    : 'Non-Stop Scroll'}
                </Text>
              </View>
              <Text style={styles.switchSub}>
                Choose how book chapters are delivered: constantly scroll non-stop or flip page-by-page.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ChoiceButton
                  icon="unfold_more"
                  label="Non-Stop Scroll"
                  active={flowMode === 'continuous'}
                  onPress={() => update({ readingFlowMode: 'continuous' })}
                />
                <ChoiceButton
                  icon="auto_stories"
                  label="Page by Page"
                  active={flowMode === 'paginated'}
                  onPress={() => update({ readingFlowMode: 'paginated' })}
                />
              </View>
            </View>

            <View style={styles.divider} />

            <View style={{ gap: 8 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.switchTitle}>Library Book Thumbnail Style</Text>
                <Text style={styles.fieldHint}>
                  {coverStyle === 'typographic' ? 'Typographic Text' : 'Illustrated Image'}
                </Text>
              </View>
              <Text style={styles.switchSub}>
                Choose between illustrated image covers or pure typographic cloth binding.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ChoiceButton
                  icon="image"
                  label="Illustrated"
                  active={coverStyle === 'image'}
                  onPress={() => update({ defaultCoverStyle: 'image' })}
                />
                <ChoiceButton
                  icon="title"
                  label="Typographic"
                  active={coverStyle === 'typographic'}
                  onPress={() => update({ defaultCoverStyle: 'typographic' })}
                />
              </View>
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
          <Pressable onPress={reset} accessibilityRole="button" style={[styles.actionBtn, { backgroundColor: colors.surfaceContainer }]}>
            <Text style={[styles.actionText, { color: colors.muted }]}>Reset Defaults</Text>
          </Pressable>
          <Pressable onPress={apply} accessibilityRole="button" style={[styles.actionBtn, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.actionText, { color: '#fff' }]}>Keep Changes</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );

  if (isSheetOnly) {
    return (
      <ModalShell onClose={onClose} align="bottom" maxWidth={512} cardStyle={{ maxHeight: '88%' }}>
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
}> = ({ icon, label, active, onPress }) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[
        styles.choice,
        active
          ? { backgroundColor: colors.primaryContainer, borderColor: colors.primaryContainer }
          : { backgroundColor: colors.surfaceContainer, borderColor: colors.border },
      ]}
    >
      <Icon name={icon} size={17} color={active ? '#fff' : colors.muted} />
      <Text style={[styles.choiceText, { color: active ? '#fff' : colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { ...type.headlineSm, color: colors.onSurface },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    marginTop: 12,
    backgroundColor: colors.surfaceContainer,
    padding: 4,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
  },
  segBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 7,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  segBtnActive: {
    backgroundColor: colors.surface,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  segText: { ...type.labelMd, fontSize: 11.5 },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 20 },
  preview: {
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  previewHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', marginBottom: 8 },
  previewLabel: { ...type.labelSm, color: colors.muted },
  previewFont: { ...type.labelSm, color: colors.primary },
  previewAuthor: { ...type.labelSm, opacity: 0.7, fontStyle: 'italic', textAlign: 'right', marginTop: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...type.labelMd, color: colors.muted, letterSpacing: 0.8 },
  fieldHint: { ...type.labelSm, color: colors.primary },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fontPill: {
    minHeight: 48,    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  fontPillText: { ...type.labelMd },
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
  themeBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 1,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchTitle: { fontFamily: F.sansSemi, fontSize: 14, color: colors.onSurface },
  switchSub: { fontFamily: F.sans, fontSize: 12, lineHeight: 16, color: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  choice: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  choiceText: { fontFamily: F.sansSemi, fontSize: 12 },
  actionBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  actionText: { ...type.labelLg },
});
