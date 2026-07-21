import {
  DESKTOP_SHELL_THEME_DEFAULTS,
  type DesktopResolvedTheme,
  type DesktopShellThemePreset,
  type DesktopWindowThemeSnapshot,
} from '../shared/desktopTheme';

export type DesktopShellThemeCatalogEntry = Readonly<{
  mode: DesktopResolvedTheme;
  window: DesktopWindowThemeSnapshot;
}>;

export const desktopShellThemeCatalog = {
  'classic-light': {
    mode: 'light',
    window: { backgroundColor: '#f4f1ed', symbolColor: '#202a37' },
  },
  paper: {
    mode: 'light',
    window: { backgroundColor: '#f5f1e8', symbolColor: '#243447' },
  },
  mist: {
    mode: 'light',
    window: { backgroundColor: '#eef3f7', symbolColor: '#1f3442' },
  },
  meadow: {
    mode: 'light',
    window: { backgroundColor: '#eef4ec', symbolColor: '#20372d' },
  },
  citrus: {
    mode: 'light',
    window: { backgroundColor: '#fff5e1', symbolColor: '#3f2d1c' },
  },
  lilac: {
    mode: 'light',
    window: { backgroundColor: '#f5f0fa', symbolColor: '#30253d' },
  },
  'light-plus': {
    mode: 'light',
    window: { backgroundColor: '#ffffff', symbolColor: '#1f1f1f' },
  },
  'quiet-light': {
    mode: 'light',
    window: { backgroundColor: '#f5f5f5', symbolColor: '#333333' },
  },
  'solarized-light': {
    mode: 'light',
    window: { backgroundColor: '#fdf6e3', symbolColor: '#586e75' },
  },
  'github-light': {
    mode: 'light',
    window: { backgroundColor: '#f6f8fa', symbolColor: '#24292f' },
  },
  'hc-light': {
    mode: 'light',
    window: { backgroundColor: '#ffffff', symbolColor: '#000000' },
  },
  'classic-dark': {
    mode: 'dark',
    window: { backgroundColor: '#0e121b', symbolColor: '#f9fafb' },
  },
  ink: {
    mode: 'dark',
    window: { backgroundColor: '#0b1420', symbolColor: '#eaf2f7' },
  },
  slate: {
    mode: 'dark',
    window: { backgroundColor: '#171b22', symbolColor: '#eef1f5' },
  },
  forest: {
    mode: 'dark',
    window: { backgroundColor: '#0b1a17', symbolColor: '#edf6f1' },
  },
  ember: {
    mode: 'dark',
    window: { backgroundColor: '#1d1115', symbolColor: '#fff1f1' },
  },
  ocean: {
    mode: 'dark',
    window: { backgroundColor: '#071a25', symbolColor: '#e9f7fc' },
  },
  'dark-plus': {
    mode: 'dark',
    window: { backgroundColor: '#1e1e1e', symbolColor: '#d4d4d4' },
  },
  monokai: {
    mode: 'dark',
    window: { backgroundColor: '#272822', symbolColor: '#f8f8f2' },
  },
  nord: {
    mode: 'dark',
    window: { backgroundColor: '#2e3440', symbolColor: '#eceff4' },
  },
  dracula: {
    mode: 'dark',
    window: { backgroundColor: '#282a36', symbolColor: '#f8f8f2' },
  },
  abyss: {
    mode: 'dark',
    window: { backgroundColor: '#000c18', symbolColor: '#ddeeff' },
  },
} as const satisfies Readonly<Record<DesktopShellThemePreset, DesktopShellThemeCatalogEntry>>;

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
    backgroundColor: '#f4f1ed',
    symbolColor: '#202a37',
  },
  pageBackground: '#f4f1ed',
  surface: '#fffdfa',
  surfaceMuted: '#f1efec',
  border: '#d8d3cc',
  text: '#202a37',
  muted: '#5a687c',
  accent: '#202a37',
  accentText: '#fffdfa',
  accentSoft: '#e4e1dd',
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
  return desktopWindowThemeSnapshotForShellTheme(DESKTOP_SHELL_THEME_DEFAULTS[resolvedTheme]);
}

export function desktopWindowThemeSnapshotForShellTheme(
  preset: DesktopShellThemePreset,
): DesktopWindowThemeSnapshot {
  return desktopShellThemeCatalog[preset].window;
}
