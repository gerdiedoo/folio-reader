import type { LineSpacing, ReadingSettings, Typeface } from '../types';

export const READER_FONTS: readonly Typeface[] = ['Literata', 'EB Garamond', 'Manrope', 'System Serif', 'System Sans'];

/** Retain the appearance of old aliases without continuing to advertise absent fonts. */
export function normalizeTypeface(font: unknown): Typeface {
  switch (font) {
    case 'Literata': case 'EB Garamond': case 'Manrope': case 'System Serif': case 'System Sans':
      return font;
    case 'Bookerly': case 'Georgia': return 'System Serif';
    case 'Inter': return 'Manrope';
    case 'OpenDyslexic': return 'System Sans';
    default: return 'Literata';
  }
}

const LINE_SPACING: Record<LineSpacing, number> = { compact: 1.45, standard: 1.7, loose: 2.0 };
export function readerTextMetrics(settings: Pick<ReadingSettings, 'fontSizeStep' | 'lineSpacing'>) {
  const step = Number.isFinite(settings.fontSizeStep) ? Math.max(1, Math.min(8, Math.round(settings.fontSizeStep))) : 4;
  const fontSize = 14 + step * 1.5;
  const multiplier = Object.prototype.hasOwnProperty.call(LINE_SPACING, settings.lineSpacing) ? LINE_SPACING[settings.lineSpacing] : LINE_SPACING.standard;
  return { fontSize, lineHeight: Math.round(fontSize * multiplier) };
}

export const DEFAULT_READER_SETTINGS: Readonly<ReadingSettings> = {
  theme: 'parchment', font: 'Literata', fontSizeStep: 4, lineSpacing: 'standard', margins: 'regular',
  usePublisherDefaults: false, displayReadingPace: true, defaultCoverStyle: 'image',
  readingFlowMode: 'continuous', wpm: 240,
};

export type ReaderSettingsChange = Partial<ReadingSettings> | ((current: ReadingSettings) => Partial<ReadingSettings>);

/** Saved JSON and cloud rows are untrusted; return only supported, bounded fields. */
export function normalizeReaderSettings(value: unknown): ReadingSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const own = (key: string) => Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
  const choice = <const T extends string>(key: string, options: readonly T[], fallback: T): T =>
    options.includes(own(key) as T) ? own(key) as T : fallback;
  const number = (key: string, min: number, max: number, fallback: number) => {
    const n = own(key);
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  return {
    theme: choice('theme', ['parchment', 'white', 'sepia', 'charcoal'], 'parchment'),
    font: normalizeTypeface(own('font')),
    fontSizeStep: number('fontSizeStep', 1, 8, 4),
    lineSpacing: choice('lineSpacing', ['compact', 'standard', 'loose'], 'standard'),
    margins: choice('margins', ['narrow', 'regular', 'wide'], 'regular'),
    usePublisherDefaults: false,
    displayReadingPace: typeof own('displayReadingPace') === 'boolean' ? own('displayReadingPace') as boolean : true,
    defaultCoverStyle: choice('defaultCoverStyle', ['image', 'typographic'], 'image'),
    readingFlowMode: choice('readingFlowMode', ['continuous', 'paginated', 'single-line'], 'continuous'),
    wpm: number('wpm', 60, 600, 240),
  };
}
