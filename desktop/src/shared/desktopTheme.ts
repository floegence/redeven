import {
  BUILT_IN_SHELL_THEME_DEFAULTS,
  builtInShellThemePresets,
} from './floeThemeMetadata';

export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';
export type DesktopHexColor = `#${string}`;
export type DesktopCssColor = DesktopHexColor
  | `rgb(${string})`
  | `hsl(${string})`
  | `oklch(${string})`;

function builtInPresetNamesForMode(mode: DesktopResolvedTheme): readonly string[] {
  const names = builtInShellThemePresets
    .filter((preset) => preset.mode === mode)
    .map((preset) => preset.name);
  const defaultName = BUILT_IN_SHELL_THEME_DEFAULTS[mode];
  if (!names.includes(defaultName)) {
    throw new Error(`Floe built-in ${mode} theme defaults are inconsistent`);
  }
  return Object.freeze(names);
}

export const DESKTOP_SHELL_THEME_PRESETS = Object.freeze({
  light: builtInPresetNamesForMode('light'),
  dark: builtInPresetNamesForMode('dark'),
});

export type DesktopLightShellThemePreset = typeof DESKTOP_SHELL_THEME_PRESETS.light[number];
export type DesktopDarkShellThemePreset = typeof DESKTOP_SHELL_THEME_PRESETS.dark[number];
export type DesktopShellThemePreset = DesktopLightShellThemePreset | DesktopDarkShellThemePreset;

export type DesktopShellThemeSelection = Readonly<{
  version: 1;
  light: DesktopLightShellThemePreset;
  dark: DesktopDarkShellThemePreset;
}>;

export const DESKTOP_SHELL_THEME_DEFAULTS = {
  version: 1,
  light: BUILT_IN_SHELL_THEME_DEFAULTS.light,
  dark: BUILT_IN_SHELL_THEME_DEFAULTS.dark,
} as const satisfies DesktopShellThemeSelection;

export type DesktopWindowThemeSnapshot = Readonly<{
  backgroundColor: DesktopHexColor;
  symbolColor: DesktopHexColor;
}>;

export const DESKTOP_THEME_SEMANTIC_PALETTE_VERSION = 1 as const;

export type DesktopThemeSemanticPalette = Readonly<{
  version: typeof DESKTOP_THEME_SEMANTIC_PALETTE_VERSION;
  background: DesktopCssColor;
  surface: DesktopCssColor;
  muted: DesktopCssColor;
  foreground: DesktopCssColor;
  mutedForeground: DesktopCssColor;
  border: DesktopCssColor;
  primary: DesktopCssColor;
  primaryForeground: DesktopCssColor;
  info: DesktopCssColor;
  success: DesktopCssColor;
  warning: DesktopCssColor;
  error: DesktopCssColor;
}>;

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  shellThemes: DesktopShellThemeSelection;
  activeShellTheme: DesktopShellThemePreset;
  window: DesktopWindowThemeSnapshot;
  semantic: DesktopThemeSemanticPalette;
}>;

export type DesktopRendererThemeSnapshot = Omit<DesktopThemeSnapshot, 'semantic'>;

export const DESKTOP_THEME_SOURCE_STATE_KEY = 'desktop:theme-source';
export const DESKTOP_SHELL_THEME_SELECTION_STATE_KEY = 'desktop:shell-theme-selection';
const DESKTOP_HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const DESKTOP_FUNCTION_COLOR_PATTERN = /^(?:rgb|hsl|oklch)\(\s*[-+.\d%]+(?:[\s,/]+[-+.\d%]+){2,3}\s*\)$/i;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function isDesktopHexColor(value: unknown): value is DesktopHexColor {
  return DESKTOP_HEX_COLOR_PATTERN.test(compact(value));
}

export function normalizeDesktopHexColor(value: unknown): DesktopHexColor | '' {
  return isDesktopHexColor(value) ? value : '';
}

export function isDesktopCssColor(value: unknown): value is DesktopCssColor {
  const candidate = compact(value);
  return DESKTOP_HEX_COLOR_PATTERN.test(candidate)
    || DESKTOP_FUNCTION_COLOR_PATTERN.test(candidate);
}

export function normalizeDesktopCssColor(value: unknown): DesktopCssColor | '' {
  return isDesktopCssColor(value) ? compact(value) as DesktopCssColor : '';
}

export function normalizeDesktopThemeSource(value: unknown, fallback: DesktopThemeSource = 'system'): DesktopThemeSource {
  const candidate = compact(value);
  if (candidate === 'system' || candidate === 'light' || candidate === 'dark') {
    return candidate;
  }
  return fallback;
}

export function isDesktopShellThemePresetForMode(
  value: unknown,
  mode: DesktopResolvedTheme,
): value is DesktopShellThemePreset {
  const candidate = compact(value);
  return (DESKTOP_SHELL_THEME_PRESETS[mode] as readonly string[]).includes(candidate);
}

export function normalizeDesktopShellThemeSelection(value: unknown): DesktopShellThemeSelection {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      candidate = null;
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return { ...DESKTOP_SHELL_THEME_DEFAULTS };
  }

  const selection = candidate as Partial<DesktopShellThemeSelection>;
  if (selection.version !== 1) {
    return { ...DESKTOP_SHELL_THEME_DEFAULTS };
  }
  return {
    version: 1,
    light: isDesktopShellThemePresetForMode(selection.light, 'light')
      ? selection.light as DesktopLightShellThemePreset
      : DESKTOP_SHELL_THEME_DEFAULTS.light,
    dark: isDesktopShellThemePresetForMode(selection.dark, 'dark')
      ? selection.dark as DesktopDarkShellThemePreset
      : DESKTOP_SHELL_THEME_DEFAULTS.dark,
  };
}

export function isDesktopShellThemeSelection(value: unknown): value is DesktopShellThemeSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const selection = value as Partial<DesktopShellThemeSelection>;
  return selection.version === 1
    && isDesktopShellThemePresetForMode(selection.light, 'light')
    && isDesktopShellThemePresetForMode(selection.dark, 'dark');
}

export function sameDesktopShellThemeSelection(
  left: DesktopShellThemeSelection,
  right: DesktopShellThemeSelection,
): boolean {
  return left.version === right.version
    && left.light === right.light
    && left.dark === right.dark;
}

export function sameDesktopWindowThemeSnapshot(
  left: DesktopWindowThemeSnapshot,
  right: DesktopWindowThemeSnapshot,
): boolean {
  return left.backgroundColor === right.backgroundColor
    && left.symbolColor === right.symbolColor;
}

export function sameDesktopThemeSemanticPalette(
  left: DesktopThemeSemanticPalette,
  right: DesktopThemeSemanticPalette,
): boolean {
  return left.version === right.version
    && left.background === right.background
    && left.surface === right.surface
    && left.muted === right.muted
    && left.foreground === right.foreground
    && left.mutedForeground === right.mutedForeground
    && left.border === right.border
    && left.primary === right.primary
    && left.primaryForeground === right.primaryForeground
    && left.info === right.info
    && left.success === right.success
    && left.warning === right.warning
    && left.error === right.error;
}

export function sameDesktopThemeSnapshot(left: DesktopThemeSnapshot, right: DesktopThemeSnapshot): boolean {
  return left.source === right.source
    && left.resolvedTheme === right.resolvedTheme
    && sameDesktopShellThemeSelection(left.shellThemes, right.shellThemes)
    && left.activeShellTheme === right.activeShellTheme
    && sameDesktopWindowThemeSnapshot(left.window, right.window)
    && sameDesktopThemeSemanticPalette(left.semantic, right.semantic);
}

export function sameDesktopRendererThemeSnapshot(
  left: DesktopRendererThemeSnapshot,
  right: DesktopRendererThemeSnapshot,
): boolean {
  return left.source === right.source
    && left.resolvedTheme === right.resolvedTheme
    && sameDesktopShellThemeSelection(left.shellThemes, right.shellThemes)
    && left.activeShellTheme === right.activeShellTheme
    && sameDesktopWindowThemeSnapshot(left.window, right.window);
}
