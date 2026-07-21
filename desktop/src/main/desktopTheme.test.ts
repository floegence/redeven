import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  desktopPaletteForResolvedTheme,
  desktopShellThemeCatalog,
} from './desktopTheme';
import {
  DESKTOP_SHELL_THEME_PRESETS,
  type DesktopShellThemePreset,
} from '../shared/desktopTheme';

type PublishedShellThemePreset = Readonly<{
  name: string;
  mode: string;
  inheritsBaseTokens: boolean;
  background: string;
  foreground: string;
}>;

function publishedShellThemePresets(): readonly PublishedShellThemePreset[] {
  // The Desktop suite resolves Solid for SSR, so load the public browser entry in an isolated DOM.
  const script = `
    import { JSDOM } from 'jsdom';
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: dom.window },
      document: { configurable: true, value: dom.window.document },
      navigator: { configurable: true, value: dom.window.navigator },
      Node: { configurable: true, value: dom.window.Node },
      HTMLElement: { configurable: true, value: dom.window.HTMLElement },
      CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    });
    const { builtInShellThemePresets } = await import('@floegence/floe-webapp-core');
    process.stdout.write(JSON.stringify(builtInShellThemePresets.map((preset) => ({
      name: preset.name,
      mode: preset.mode,
      inheritsBaseTokens: preset.inheritsBaseTokens === true,
      background: preset.preview?.background,
      foreground: preset.tokens?.[preset.mode]?.['--foreground']
        ?? preset.monaco?.[preset.mode]?.colors?.['editor.foreground'],
    }))));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ['--conditions=browser', '--input-type=module', '--eval', script],
    { cwd: process.cwd(), encoding: 'utf8' },
  )) as PublishedShellThemePreset[];
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
        ? desktopPaletteForResolvedTheme(entry.mode).nativeWindow.backgroundColor
        : upstream?.background.toLowerCase();
      expect(entry.window.backgroundColor, presetName).toBe(expectedBackground);
      expect(entry.window.symbolColor, presetName).toBe(upstream?.foreground.toLowerCase());
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
});
