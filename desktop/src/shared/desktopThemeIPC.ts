import {
  isDesktopShellThemeSelection,
  normalizeDesktopHexColor,
  type DesktopThemeSnapshot,
} from './desktopTheme';

export const DESKTOP_THEME_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:theme-get-snapshot';
export const DESKTOP_THEME_SET_SOURCE_CHANNEL = 'redeven-desktop:theme-set-source';
export const DESKTOP_THEME_SET_SHELL_THEME_CHANNEL = 'redeven-desktop:theme-set-shell-theme';
export const DESKTOP_THEME_UPDATED_CHANNEL = 'redeven-desktop:theme-updated';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopThemeSnapshot(value: unknown): DesktopThemeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopThemeSnapshot> & {
    window?: Partial<DesktopThemeSnapshot['window']>;
  };
  const source = compact(candidate.source);
  const resolvedTheme = compact(candidate.resolvedTheme);
  const shellThemes = candidate.shellThemes;
  const activeShellTheme = compact(candidate.activeShellTheme);
  const backgroundColor = normalizeDesktopHexColor(candidate.window?.backgroundColor);
  const symbolColor = normalizeDesktopHexColor(candidate.window?.symbolColor);
  if (
    (source !== 'system' && source !== 'light' && source !== 'dark')
    || (resolvedTheme !== 'light' && resolvedTheme !== 'dark')
    || (source !== 'system' && source !== resolvedTheme)
    || !isDesktopShellThemeSelection(shellThemes)
    || activeShellTheme !== shellThemes[resolvedTheme]
    || !backgroundColor
    || !symbolColor
  ) {
    return null;
  }

  return {
    source,
    resolvedTheme,
    shellThemes,
    activeShellTheme,
    window: {
      backgroundColor,
      symbolColor,
    },
  };
}
