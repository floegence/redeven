import { describe, expect, it } from 'vitest';

import {
  DESKTOP_SHELL_THEME_DEFAULTS,
  DESKTOP_SHELL_THEME_PRESETS,
  isDesktopShellThemePresetForMode,
  normalizeDesktopShellThemeSelection,
} from './desktopTheme';

describe('desktop shell theme contract', () => {
  it('keeps eleven unique presets for each mode', () => {
    expect(DESKTOP_SHELL_THEME_PRESETS.light).toHaveLength(11);
    expect(DESKTOP_SHELL_THEME_PRESETS.dark).toHaveLength(11);
    expect(new Set([
      ...DESKTOP_SHELL_THEME_PRESETS.light,
      ...DESKTOP_SHELL_THEME_PRESETS.dark,
    ]).size).toBe(22);
  });

  it('normalizes persisted selections per mode and version', () => {
    expect(normalizeDesktopShellThemeSelection(JSON.stringify({
      version: 1,
      light: 'mist',
      dark: 'forest',
    }))).toEqual({ version: 1, light: 'mist', dark: 'forest' });

    expect(normalizeDesktopShellThemeSelection({
      version: 1,
      light: 'ocean',
      dark: 'paper',
    })).toEqual(DESKTOP_SHELL_THEME_DEFAULTS);

    expect(normalizeDesktopShellThemeSelection({
      version: 2,
      light: 'mist',
      dark: 'forest',
    })).toEqual(DESKTOP_SHELL_THEME_DEFAULTS);
    expect(normalizeDesktopShellThemeSelection('{broken')).toEqual(DESKTOP_SHELL_THEME_DEFAULTS);
  });

  it('rejects preset ids assigned to the wrong mode', () => {
    expect(isDesktopShellThemePresetForMode('paper', 'light')).toBe(true);
    expect(isDesktopShellThemePresetForMode('paper', 'dark')).toBe(false);
    expect(isDesktopShellThemePresetForMode('ocean', 'dark')).toBe(true);
    expect(isDesktopShellThemePresetForMode('ocean', 'light')).toBe(false);
  });
});
