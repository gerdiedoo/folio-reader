import React, { createContext, useContext, useMemo } from 'react';
import type { PaperTheme } from './types';
import { colors } from './theme';

export interface AppPalette {
  background: string;
  surface: string;
  surfaceLow: string;
  surfaceContainer: string;
  surfaceHigh: string;
  surfaceHighest: string;
  surfaceDim: string;
  white: string;
  onSurface: string;
  onSurfaceVariant: string;
  muted: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  primaryFixed: string;
  secondaryFixedDim: string;
  secondaryContainer: string;
  tertiary: string;
  tertiaryContainer: string;
  tertiaryFixed: string;
  emerald: string;
  danger: string;
  border: string;
  borderSoft: string;
  borderMid: string;
  scrim: string;
}

export function createPalette(theme: PaperTheme): AppPalette {
  if (theme === 'charcoal') {
    return {
      background: '#23221e',
      surface: '#2b2a26',
      surfaceLow: '#31302c',
      surfaceContainer: '#393833',
      surfaceHigh: '#44423c',
      surfaceHighest: '#504e47',
      surfaceDim: '#1d1c19',
      white: '#35342f',
      onSurface: '#f4f0e9',
      onSurfaceVariant: '#d0c9bd',
      muted: '#b7b0a5',
      outline: '#a89d90',
      outlineVariant: '#625b51',
      primary: '#ffb59c',
      primaryContainer: '#893414',
      onPrimaryContainer: '#ffe0d6',
      primaryFixed: '#563024',
      secondaryFixedDim: '#625b51',
      secondaryContainer: '#44423c',
      tertiary: '#e6c093',
      tertiaryContainer: '#80623c',
      tertiaryFixed: '#e6c093',
      emerald: '#34d399',
      danger: '#f87171',
      border: 'rgba(244,240,233,0.14)',
      borderSoft: 'rgba(244,240,233,0.08)',
      borderMid: 'rgba(244,240,233,0.11)',
      scrim: 'rgba(0,0,0,0.65)',
    };
  }

  if (theme === 'sepia') {
    return {
      background: '#f7ecd7',
      surface: '#fff5e5',
      surfaceLow: '#f3e6d0',
      surfaceContainer: '#eadcc5',
      surfaceHigh: '#e2d2b8',
      surfaceHighest: '#d9c8ac',
      surfaceDim: '#d4c2a5',
      white: '#fff8ed',
      onSurface: '#3c2a1e',
      onSurfaceVariant: '#5c4635',
      muted: '#786754',
      outline: '#927a62',
      outlineVariant: '#d0bda3',
      primary: '#893414',
      primaryContainer: '#a84b29',
      onPrimaryContainer: '#ffe0d6',
      primaryFixed: '#f3d5c3',
      secondaryFixedDim: '#c2b8a8',
      secondaryContainer: '#e6d8c2',
      tertiary: '#654a26',
      tertiaryContainer: '#80623c',
      tertiaryFixed: '#ffddb6',
      emerald: '#059669',
      danger: '#b91c1c',
      border: 'rgba(60,42,30,0.14)',
      borderSoft: 'rgba(60,42,30,0.07)',
      borderMid: 'rgba(60,42,30,0.11)',
      scrim: 'rgba(28,20,12,0.48)',
    };
  }

  if (theme === 'white') {
    return {
      background: '#ffffff',
      surface: '#ffffff',
      surfaceLow: '#fafafa',
      surfaceContainer: '#f2f2f2',
      surfaceHigh: '#eaeaea',
      surfaceHighest: '#e2e2e2',
      surfaceDim: '#d8d8d8',
      white: '#ffffff',
      onSurface: '#1a1a18',
      onSurfaceVariant: '#4e4b47',
      muted: '#605e5a',
      outline: '#89726b',
      outlineVariant: '#d8d1ca',
      primary: '#893414',
      primaryContainer: '#a84b29',
      onPrimaryContainer: '#ffe0d6',
      primaryFixed: '#ffdbcf',
      secondaryFixedDim: '#cac6c1',
      secondaryContainer: '#e6e2dc',
      tertiary: '#654a26',
      tertiaryContainer: '#80623c',
      tertiaryFixed: '#ffddb6',
      emerald: '#059669',
      danger: '#b91c1c',
      border: 'rgba(28,28,24,0.10)',
      borderSoft: 'rgba(28,28,24,0.05)',
      borderMid: 'rgba(28,28,24,0.08)',
      scrim: 'rgba(28,28,24,0.40)',
    };
  }

  return {
    background: colors.surface,
    surface: colors.surface,
    surfaceLow: colors.surfaceLow,
    surfaceContainer: colors.surfaceContainer,
    surfaceHigh: colors.surfaceHigh,
    surfaceHighest: colors.surfaceHighest,
    surfaceDim: colors.surfaceDim,
    white: colors.white,
    onSurface: colors.onSurface,
    onSurfaceVariant: colors.onSurfaceVariant,
    muted: colors.muted,
    outline: colors.outline,
    outlineVariant: colors.outlineVariant,
    primary: colors.primary,
    primaryContainer: colors.primaryContainer,
    onPrimaryContainer: colors.onPrimaryContainer,
    primaryFixed: colors.primaryFixed,
    secondaryFixedDim: colors.secondaryFixedDim,
    secondaryContainer: colors.secondaryContainer,
    tertiary: colors.tertiary,
    tertiaryContainer: colors.tertiaryContainer,
    tertiaryFixed: colors.tertiaryFixed,
    emerald: colors.emerald,
    danger: colors.danger,
    border: colors.border,
    borderSoft: colors.borderSoft,
    borderMid: colors.borderMid,
    scrim: colors.scrim,
  };
}

const AppThemeContext = createContext<AppPalette>(createPalette('parchment'));

export const AppThemeProvider: React.FC<React.PropsWithChildren<{ theme: PaperTheme }>> = ({
  theme,
  children,
}) => {
  const palette = useMemo(() => createPalette(theme), [theme]);
  return <AppThemeContext.Provider value={palette}>{children}</AppThemeContext.Provider>;
};

export function useAppTheme(): AppPalette {
  return useContext(AppThemeContext);
}
