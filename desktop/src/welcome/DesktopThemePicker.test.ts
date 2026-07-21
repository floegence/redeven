import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type PublishedPreset = Readonly<{
  name: string;
  mode: 'light' | 'dark';
  preview: Readonly<{
    background: string;
    surface: string;
    primary: string;
    colors: readonly string[];
  }>;
  hasMonacoTheme: boolean;
}>;

function publishedPresets(): readonly PublishedPreset[] {
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
      preview: preset.preview,
      hasMonacoTheme: Boolean(preset.monaco?.[preset.mode]),
    }))));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ['--conditions=browser', '--input-type=module', '--eval', script],
    { cwd: process.cwd(), encoding: 'utf8' },
  )) as readonly PublishedPreset[];
}

const builtInShellThemePresets = publishedPresets();

const LIGHT_PRESET_NAMES = [
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
] as const;

const DARK_PRESET_NAMES = [
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
] as const;

function readPickerSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopThemePicker.tsx'), 'utf8');
}

function readWelcomeStyles(): string {
  return fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');
}

describe('DesktopThemePicker', () => {
  it('keeps the 11 light and 11 dark Floe 0.39 presets in their published order', () => {
    const lightPresets = builtInShellThemePresets.filter((preset) => preset.mode === 'light');
    const darkPresets = builtInShellThemePresets.filter((preset) => preset.mode === 'dark');

    expect(lightPresets.map((preset) => preset.name)).toEqual(LIGHT_PRESET_NAMES);
    expect(darkPresets.map((preset) => preset.name)).toEqual(DARK_PRESET_NAMES);
    expect(lightPresets[0]?.name).toBe('classic-light');
    expect(darkPresets[0]?.name).toBe('classic-dark');
    expect([...lightPresets, ...darkPresets]).toHaveLength(22);
  });

  it('provides a localized label mapping and a complete Monaco-aware preview for every preset', () => {
    const pickerSource = readPickerSource();

    for (const preset of builtInShellThemePresets) {
      expect(pickerSource).toContain(`shell.themePicker.presets.${preset.name}`);
      expect(preset.preview).toMatchObject({
        background: expect.any(String),
        surface: expect.any(String),
        primary: expect.any(String),
        colors: expect.any(Array),
      });
      expect(preset.preview?.colors).toHaveLength(5);
      expect(preset.hasMonacoTheme).toBe(true);
    }

    expect(pickerSource).toContain("'background-color': preview()?.background");
    expect(pickerSource).toContain("'background-color': preview()?.surface");
    expect(pickerSource).toContain("'background-color': preview()?.sidebar ?? preview()?.surface");
    expect(pickerSource).toContain("'border-color': preview()?.border");
    expect(pickerSource).toContain("'background-color': preview()?.primary");
    expect(pickerSource).toContain('<For each={preview()?.colors ?? []}>');
  });

  it('implements the signed non-modal radiogroup keyboard and focus contract', () => {
    const pickerSource = readPickerSource();

    expect(pickerSource).toContain('aria-haspopup="dialog"');
    expect(pickerSource).toContain('ariaModal={false}');
    expect(pickerSource.match(/role="radiogroup"/gu)).toHaveLength(2);
    expect((pickerSource.match(/role="radio"/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(pickerSource).toContain('tabIndex={selected() ? 0 : -1}');
    expect(pickerSource).toContain("case 'ArrowRight':");
    expect(pickerSource).toContain("case 'ArrowLeft':");
    expect(pickerSource).toContain("case 'Home':");
    expect(pickerSource).toContain("case 'End':");
    expect(pickerSource).toContain("event.key === 'Enter' || event.key === ' '");
    expect(pickerSource).toContain("event.key === 'Escape'");
    expect(pickerSource).toContain("document.addEventListener('mousedown', handleMouseDown)");
    expect(pickerSource).toContain('closePicker(false)');
    expect(pickerSource).toContain('closePicker(true)');
    expect(pickerSource).toContain('buttonRef?.focus()');
    expect(pickerSource).toContain("scrollIntoView({ block: 'nearest' })");
    expect(pickerSource).toContain('modeChanged && themeGroupFocused()');
    expect(pickerSource).toContain('queueMicrotask(() => {');
  });

  it('keeps system mode selected while changing only the currently resolved preset', () => {
    const pickerSource = readPickerSource();

    expect(pickerSource).toContain("props.snapshot.source === 'system' ? props.snapshot.resolvedTheme : props.snapshot.source");
    expect(pickerSource).toContain('const mode = activeMode();');
    expect(pickerSource).toContain('props.onShellThemeChange(mode, preset.name)');
    expect(pickerSource).not.toContain('selectSource(mode)');
  });

  it('surfaces bridge failures inline without inventing a successful local selection', () => {
    const pickerSource = readPickerSource();

    expect(pickerSource).toContain("props.i18n.t(translationKey('shell.themePicker.changeFailed'))");
    expect(pickerSource).toContain('if (result.source !== source)');
    expect(pickerSource).toContain('if (result.shellThemes[mode] !== preset.name)');
    expect((pickerSource.match(/showUpdateFailure\(\);/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(pickerSource).toContain('role="alert"');
    expect(pickerSource).not.toContain('setThemeSnapshot');
  });

  it('keeps the picker responsive, readable, pointer-friendly, and accessible', () => {
    const styles = readWelcomeStyles();

    expect(styles).toContain('width: min(36rem, calc(100vw - 1rem));');
    expect(styles).toContain('max-height: min(44rem, calc(100dvh - var(--redeven-desktop-titlebar-height) - 1.5rem));');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('@media (max-width: 34rem)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (forced-colors: active)');
    expect(styles).toContain('.redeven-theme-picker__mode:focus-visible');
    expect(styles).toContain('.redeven-theme-picker__theme:focus-visible');
    expect((styles.match(/cursor: pointer;/gu) ?? []).length).toBeGreaterThanOrEqual(3);

    const nameRuleStart = styles.indexOf('.redeven-theme-picker__theme-name {');
    const nameRuleEnd = styles.indexOf('\n}', nameRuleStart);
    const nameRule = styles.slice(nameRuleStart, nameRuleEnd);
    expect(nameRule).toContain('overflow-wrap: anywhere;');
    expect(nameRule).not.toContain('text-overflow: ellipsis;');
    expect(nameRule).not.toContain('white-space: nowrap;');
  });

  it('derives Welcome shell surfaces from Floe semantic tokens instead of fixed theme colors', () => {
    const styles = readWelcomeStyles();

    expect(styles).toContain('--redeven-welcome-window-bg: var(--background);');
    expect(styles).toContain('--redeven-welcome-page-bg: var(--background);');
    expect(styles).toContain('--redeven-welcome-panel-bg: var(--card);');
    expect(styles).toContain('--redeven-welcome-rail-bg: var(--sidebar);');
    expect(styles).toContain('--redeven-welcome-card-border: var(--border);');
    expect(styles).not.toMatch(/--redeven-welcome-(?:window-bg|page-bg|panel-bg|rail-bg|card):\s*#[0-9a-f]{3,8}/iu);
    expect(styles).not.toMatch(/\.dark\s*\{[^}]*--(?:border|input):\s*hsl\(/isu);
  });
});
