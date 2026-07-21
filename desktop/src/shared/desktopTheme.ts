export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';
export type DesktopHexColor = `#${string}`;

export const DESKTOP_SHELL_THEME_PRESETS = {
  light: [
    'classic-light',
    'paper',
    'mist',
    'meadow',
    'citrus',
    'lilac',
    'light-plus',
    'quiet-light',
    'solarized-light',
    'github-light',
    'hc-light',
  ],
  dark: [
    'classic-dark',
    'ink',
    'slate',
    'forest',
    'ember',
    'ocean',
    'dark-plus',
    'monokai',
    'nord',
    'dracula',
    'abyss',
  ],
} as const;

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
  light: 'classic-light',
  dark: 'classic-dark',
} as const satisfies DesktopShellThemeSelection;

export type DesktopWindowThemeSnapshot = Readonly<{
  backgroundColor: DesktopHexColor;
  symbolColor: DesktopHexColor;
}>;

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  shellThemes: DesktopShellThemeSelection;
  activeShellTheme: DesktopShellThemePreset;
  window: DesktopWindowThemeSnapshot;
}>;

export const DESKTOP_THEME_SOURCE_STATE_KEY = 'desktop:theme-source';
export const DESKTOP_SHELL_THEME_SELECTION_STATE_KEY = 'desktop:shell-theme-selection';
const DESKTOP_HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function isDesktopHexColor(value: unknown): value is DesktopHexColor {
  return DESKTOP_HEX_COLOR_PATTERN.test(compact(value));
}

export function normalizeDesktopHexColor(value: unknown): DesktopHexColor | '' {
  return isDesktopHexColor(value) ? value : '';
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

export function sameDesktopThemeSnapshot(left: DesktopThemeSnapshot, right: DesktopThemeSnapshot): boolean {
  return left.source === right.source
    && left.resolvedTheme === right.resolvedTheme
    && sameDesktopShellThemeSelection(left.shellThemes, right.shellThemes)
    && left.activeShellTheme === right.activeShellTheme
    && sameDesktopWindowThemeSnapshot(left.window, right.window);
}
