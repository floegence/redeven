import { describe, expect, it } from 'vitest';

import { builtInShellThemePresets } from '../shared/floeThemeMetadata';

import {
  desktopShellThemeCatalog,
  desktopShellThemeSemanticCatalog,
  desktopWindowThemeSnapshotForResolvedTheme,
} from './desktopTheme';
import {
  DESKTOP_SHELL_THEME_PRESETS,
  type DesktopShellThemePreset,
} from '../shared/desktopTheme';

type PublishedShellThemePreset = Readonly<{
  name: string;
  mode: string;
  inheritsBaseTokens: boolean;
  previewBackground: string;
  background: string;
  foreground: string;
  surface?: string;
  muted?: string;
  mutedForeground?: string;
  border?: string;
  primary?: string;
  primaryForeground?: string;
  info?: string;
  success?: string;
  warning?: string;
  error?: string;
}>;

function publishedShellThemePresets(): readonly PublishedShellThemePreset[] {
  return builtInShellThemePresets.map((preset) => ({
    name: preset.name,
    mode: preset.mode ?? '',
    inheritsBaseTokens: preset.inheritsBaseTokens === true,
    previewBackground: preset.preview?.background ?? '',
    background: preset.semanticTokens?.['--background'] ?? '',
    foreground: preset.semanticTokens?.['--foreground']
      ?? preset.monaco?.[preset.mode === 'light' || preset.mode === 'dark' ? preset.mode : 'light']?.colors?.['editor.foreground']
      ?? '',
    surface: preset.semanticTokens?.['--card'],
    muted: preset.semanticTokens?.['--muted'],
    mutedForeground: preset.semanticTokens?.['--muted-foreground'],
    border: preset.semanticTokens?.['--border'],
    primary: preset.semanticTokens?.['--primary'],
    primaryForeground: preset.semanticTokens?.['--primary-foreground'],
    info: preset.semanticTokens?.['--info'],
    success: preset.semanticTokens?.['--success'],
    warning: preset.semanticTokens?.['--warning'],
    error: preset.semanticTokens?.['--error'],
  }));
}

type Rgb = readonly [number, number, number];

function parseHex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    throw new Error(`Unsupported Desktop theme color: ${value}`);
  }
  return [0, 2, 4].map((offset) => (
    Number.parseInt(match[1].slice(offset, offset + 2), 16)
  )) as unknown as Rgb;
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function contrastRatio(first: string, second: string): number {
  const luminance = ([red, green, blue]: Rgb) => (
    0.2126 * channelToLinear(red)
    + 0.7152 * channelToLinear(green)
    + 0.0722 * channelToLinear(blue)
  );
  const firstLuminance = luminance(parseHex(first));
  const secondLuminance = luminance(parseHex(second));
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('desktop shell theme native catalog', () => {
  it('matches the published Floe 0.39 shell theme catalog', () => {
    const builtInShellThemePresets = publishedShellThemePresets();
    const presetNames = Object.keys(desktopShellThemeCatalog) as DesktopShellThemePreset[];
    expect(presetNames).toEqual(builtInShellThemePresets.map((preset) => preset.name));
    expect(presetNames).toEqual([
      ...DESKTOP_SHELL_THEME_PRESETS.light,
      ...DESKTOP_SHELL_THEME_PRESETS.dark,
    ]);

    for (const presetName of presetNames) {
      const entry = desktopShellThemeCatalog[presetName];
      const upstream = builtInShellThemePresets.find((preset) => preset.name === presetName);
      expect(upstream, presetName).toBeDefined();
      expect(entry.mode, presetName).toBe(upstream?.mode);
      const expectedBackground = upstream?.inheritsBaseTokens
        ? desktopWindowThemeSnapshotForResolvedTheme(entry.mode).backgroundColor
        : upstream?.previewBackground.toLowerCase();
      expect(entry.window.backgroundColor, presetName).toBe(expectedBackground);
      const expectedSymbolColor = upstream?.inheritsBaseTokens
        ? desktopWindowThemeSnapshotForResolvedTheme(entry.mode).symbolColor
        : upstream?.foreground.toLowerCase();
      expect(entry.window.symbolColor, presetName).toBe(expectedSymbolColor);
    }
  });

  it('keeps native titlebar symbols distinguishable for every preset', () => {
    for (const [presetName, entry] of Object.entries(desktopShellThemeCatalog)) {
      expect(
        contrastRatio(entry.window.backgroundColor, entry.window.symbolColor),
        presetName,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('mirrors every published semantic token used by Desktop documents', () => {
    const builtInShellThemePresets = publishedShellThemePresets();

    for (const upstream of builtInShellThemePresets) {
      const semantic = desktopShellThemeSemanticCatalog[upstream.name as DesktopShellThemePreset];
      expect(semantic, upstream.name).toMatchObject({
        background: upstream.background,
        surface: upstream.surface,
        muted: upstream.muted,
        foreground: upstream.foreground,
        mutedForeground: upstream.mutedForeground,
        border: upstream.border,
        primary: upstream.primary,
        primaryForeground: upstream.primaryForeground,
        info: upstream.info,
        success: upstream.success,
        warning: upstream.warning,
        error: upstream.error,
      });
    }
  });
});
