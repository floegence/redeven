import type { DesktopResolvedTheme, DesktopWindowThemeSnapshot } from '../shared/desktopTheme';

export type DesktopThemePalette = Readonly<{
  nativeWindow: DesktopWindowThemeSnapshot;
  pageBackground: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}>;

export const desktopLightTheme = {
  nativeWindow: {
    backgroundColor: '#f0eeea',
    symbolColor: '#141f2e',
  },
  pageBackground: '#f0eeea',
  surface: '#f6f5f4',
  surfaceMuted: '#e3e1dd',
  border: '#d6d2cd',
  text: '#141f2e',
  muted: '#566881',
  accent: '#141f2e',
  accentText: '#fafafa',
  accentSoft: '#e3e1dd',
  success: 'oklch(0.68 0.16 150)',
  warning: 'oklch(0.78 0.14 80)',
  danger: 'oklch(0.65 0.2 25)',
  info: 'oklch(0.65 0.13 250)',
} as const satisfies DesktopThemePalette;

export const desktopDarkTheme = {
  nativeWindow: {
    backgroundColor: '#0e121b',
    symbolColor: '#f9fafb',
  },
  pageBackground: '#0e121b',
  surface: '#121721',
  surfaceMuted: '#1b212d',
  border: '#252b37',
  text: '#f9fafb',
  muted: '#8596ad',
  accent: '#1f2533',
  accentText: '#f9fafb',
  accentSoft: '#1b212d',
  success: 'oklch(0.72 0.19 150)',
  warning: 'oklch(0.82 0.16 80)',
  danger: 'oklch(0.7 0.22 25)',
  info: 'oklch(0.7 0.15 250)',
} as const satisfies DesktopThemePalette;

export const desktopTheme = desktopLightTheme;

export function desktopPaletteForResolvedTheme(resolvedTheme: DesktopResolvedTheme): DesktopThemePalette {
  return resolvedTheme === 'dark' ? desktopDarkTheme : desktopLightTheme;
}

export function desktopWindowThemeSnapshotForResolvedTheme(
  resolvedTheme: DesktopResolvedTheme,
): DesktopWindowThemeSnapshot {
  const palette = desktopPaletteForResolvedTheme(resolvedTheme);
  return palette.nativeWindow;
}
