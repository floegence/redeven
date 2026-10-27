import { describe, expect, it } from 'vitest';

import {
  DESKTOP_SHELL_THEME_DEFAULTS,
  DESKTOP_SHELL_THEME_PRESETS,
  isDesktopShellThemePresetForMode,
  normalizeDesktopShellThemeSelection,
} from './desktopTheme';

describe('desktop shell theme contract', () => {
  it('defaults to Classic without rewriting explicit Classic choices', () => {
    expect(DESKTOP_SHELL_THEME_DEFAULTS).toEqual({ version: 1, light: 'classic-light', dark: 'classic-dark' });
    const stored = { version: 1, light: 'classic-light', dark: 'classic-dark' };
    expect(normalizeDesktopShellThemeSelection(stored)).toEqual(stored);
  });

  it('keeps the published unique presets for each mode', () => {
    expect(DESKTOP_SHELL_THEME_PRESETS.light).toHaveLength(13);
    expect(DESKTOP_SHELL_THEME_PRESETS.dark).toHaveLength(15);
    expect(new Set([
      ...DESKTOP_SHELL_THEME_PRESETS.light,
      ...DESKTOP_SHELL_THEME_PRESETS.dark,
    ]).size).toBe(28);
  });

  it('retains the new published presets in a version-one saved selection', () => {
    const saved = { version: 1, light: 'cloud-white', dark: 'soft-black' };
    expect(normalizeDesktopShellThemeSelection(saved)).toEqual(saved);
    expect(isDesktopShellThemePresetForMode('cloud-white', 'light')).toBe(true);
    expect(isDesktopShellThemePresetForMode('soft-black', 'dark')).toBe(true);
    expect(isDesktopShellThemePresetForMode('cloud-white', 'dark')).toBe(false);
    expect(isDesktopShellThemePresetForMode('soft-black', 'light')).toBe(false);
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
