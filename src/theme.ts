import { Platform, TextStyle } from 'react-native';
import { PaperTheme, Typeface } from './types';

/** Folio design tokens (ported from the Tailwind @theme block). */
export const colors = {
  surface: '#fdf9f2',
  surfaceLow: '#f7f3ec',
  surfaceContainer: '#f1ede6',
  surfaceHigh: '#ebe8e1',
  surfaceHighest: '#e6e2db',
  surfaceDim: '#dddad3',
  white: '#ffffff',
  onSurface: '#1c1c18',
  onSurfaceVariant: '#56423c',
  muted: '#605e5a',
  outline: '#89726b',
  outlineVariant: '#dcc1b8',
  primary: '#893414',
  primaryContainer: '#a84b29',
  onPrimaryContainer: '#ffe0d6',
  primaryFixed: '#ffdbcf',
  primaryFixedDim: '#ffb59c',
  secondaryContainer: '#e6e2dc',
  secondaryFixedDim: '#cac6c1',
  tertiary: '#654a26',
  tertiaryContainer: '#80623c',
  tertiaryFixed: '#ffddb6',
  tertiaryFixedDim: '#e6c093',
  emerald: '#059669',
  danger: '#b91c1c',
  /** Hairline borders drawn with the on-surface ink at low alpha */
  border: 'rgba(28,28,24,0.10)',
  borderSoft: 'rgba(28,28,24,0.05)',
  borderMid: 'rgba(28,28,24,0.08)',
  scrim: 'rgba(28,28,24,0.40)',
};

/** Font family names registered via expo-font in App.tsx */
export const F = {
  serif: 'EBGaramond_400Regular',
  serifItalic: 'EBGaramond_400Regular_Italic',
  serifMedium: 'EBGaramond_500Medium',
  serifSemi: 'EBGaramond_600SemiBold',
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemi: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
  literata: 'Literata_400Regular',
  literataSemi: 'Literata_600SemiBold',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

/** Typography tokens (the .font-* classes from index.css). */
export const type = {
  headlineLg: { fontFamily: F.serifMedium, fontSize: 32, lineHeight: 40 } as TextStyle,
  headlineMd: { fontFamily: F.serifMedium, fontSize: 26, lineHeight: 34 } as TextStyle,
  headlineSm: { fontFamily: F.serifSemi, fontSize: 22, lineHeight: 28 } as TextStyle,
  editorialLg: {
    fontFamily: F.serif,
    fontSize: 20,
    lineHeight: 32,
    letterSpacing: 0.2,
  } as TextStyle,
  editorialMd: {
    fontFamily: F.serif,
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: 0.18,
  } as TextStyle,
  bodyLg: { fontFamily: F.sans, fontSize: 16, lineHeight: 24 } as TextStyle,
  bodyMd: { fontFamily: F.sans, fontSize: 14, lineHeight: 20 } as TextStyle,
  bodySm: { fontFamily: F.sans, fontSize: 12, lineHeight: 16 } as TextStyle,
  labelLg: {
    fontFamily: F.sansSemi,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.28,
  } as TextStyle,
  labelMd: {
    fontFamily: F.sansSemi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.48,
  } as TextStyle,
  labelSm: {
    fontFamily: F.sansSemi,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.55,
  } as TextStyle,
};

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, xxl: 24, full: 999 };

/** Page surfaces used by the reader & single-line reader. */
export const readerPaper: Record<PaperTheme, { bg: string; fg: string }> = {
  parchment: { bg: '#FAF6EE', fg: '#262421' },
  white: { bg: '#ffffff', fg: '#1a1a18' },
  sepia: { bg: '#f7ecd7', fg: '#3c2a1e' },
  charcoal: { bg: '#23221e', fg: '#e4e0d7' },
};

/** Slightly different swatches used by the settings preview card. */
export const previewPaper: Record<PaperTheme, { bg: string; fg: string }> = {
  parchment: { bg: '#fdf9f2', fg: '#1c1c18' },
  white: { bg: '#ffffff', fg: '#1a1a18' },
  sepia: { bg: '#ffddb6', fg: '#2a1800' },
  charcoal: { bg: '#31302c', fg: '#f4f0e9' },
};

const SYSTEM_SERIF = Platform.select({ ios: 'Georgia', default: 'serif' }) as string;

/** Maps the user-facing typeface setting to a loaded font family. */
export function readerFontFamily(font: Typeface): string | undefined {
  switch (font) {
    case 'Literata':
      return F.literata;
    case 'Bookerly':
    case 'Georgia':
      return SYSTEM_SERIF;
    case 'Inter':
      return F.sans;
    case 'OpenDyslexic':
    default:
      return undefined; // system default sans
  }
}

/** Space reserved at the bottom of scrolling screens for the floating tab bar. */
export const NAV_SPACE = 104;
