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

export function normalizeReaderSettings(settings: ReadingSettings): ReadingSettings {
  return { ...settings, font: normalizeTypeface(settings.font), usePublisherDefaults: false };
}
