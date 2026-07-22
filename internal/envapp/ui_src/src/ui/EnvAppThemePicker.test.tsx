// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const themeHarness = vi.hoisted(() => ({
  source: (() => 'light') as () => 'system' | 'light' | 'dark',
  setSource: (() => {}) as (value: 'system' | 'light' | 'dark') => void,
  resolved: (() => 'light') as () => 'light' | 'dark',
  setResolved: (() => {}) as (value: 'light' | 'dark') => void,
  selected: (() => ({
    light: 'classic-light',
    dark: 'classic-dark',
  })) as () => { light: string; dark: string },
  setSelected: (() => {}) as (value: { light: string; dark: string }) => void,
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floegence/floe-webapp-core')>();
  return {
    ...actual,
    useTheme: () => ({
      theme: themeHarness.source,
      resolvedTheme: themeHarness.resolved,
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
      themePresets: () => [],
      themePreset: () => undefined,
      setThemePreset: vi.fn(),
      shellPresets: () => actual.builtInShellThemePresets,
      shellPreset: () =>
        actual.builtInShellThemePresets.find((preset) => preset.name === themeHarness.selected()[themeHarness.resolved()]),
      shellPresetForMode: (mode: 'light' | 'dark') =>
        actual.builtInShellThemePresets.find((preset) => preset.name === themeHarness.selected()[mode]),
      setShellPreset: vi.fn(),
      selectShellTheme: vi.fn(),
    }),
  };
});

import { EnvAppThemePicker } from './EnvAppThemePicker';

describe('EnvAppThemePicker', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    const [source, setSource] = createSignal<'system' | 'light' | 'dark'>('light');
    const [resolved, setResolved] = createSignal<'light' | 'dark'>('light');
    const [selected, setSelected] = createSignal({ light: 'classic-light', dark: 'classic-dark' });
    themeHarness.source = source;
    themeHarness.setSource = setSource;
    themeHarness.resolved = resolved;
    themeHarness.setResolved = setResolved;
    themeHarness.selected = selected;
    themeHarness.setSelected = setSelected;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function mountPicker(
    openRequestSeq?: () => number,
    outcomes: Readonly<{ source?: boolean; shellTheme?: boolean }> = {},
  ) {
    const onSourceChange = vi.fn(() => outcomes.source ?? true);
    const onShellThemeChange = vi.fn(() => outcomes.shellTheme ?? true);
    const dispose = render(
      () => (
        <EnvAppThemePicker
          openRequestSeq={openRequestSeq}
          tooltip="Appearance"
          onSourceChange={onSourceChange}
          onShellThemeChange={onShellThemeChange}
        />
      ),
      host,
    );
    return { dispose, onSourceChange, onShellThemeChange };
  }

  function openPicker(): HTMLButtonElement {
    const trigger = host.querySelector<HTMLButtonElement>('[data-envapp-theme-trigger="topbar"]');
    expect(trigger).toBeTruthy();
    trigger!.click();
    return trigger!;
  }

  it('shows all 11 light themes, including the original Classic Light preset', () => {
    const { dispose } = mountPicker();
    try {
      const trigger = openPicker();
      const presets = Array.from(host.querySelectorAll<HTMLElement>('[data-envapp-theme-preset]'));

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(presets).toHaveLength(11);
      expect(presets.map((preset) => preset.dataset.envappThemePreset)).toContain('classic-light');
      expect(presets.map((preset) => preset.dataset.envappThemePreset)).toContain('github-light');
      expect(presets.map((preset) => preset.dataset.envappThemePreset)).not.toContain('classic-dark');
      expect(host.textContent).toContain('Classic Light');
    } finally {
      dispose();
    }
  });

  it('shows all 11 dark themes and selects Nord without changing the source', () => {
    themeHarness.setSource('dark');
    themeHarness.setResolved('dark');
    const { dispose, onSourceChange, onShellThemeChange } = mountPicker();
    try {
      openPicker();
      const presets = Array.from(host.querySelectorAll<HTMLElement>('[data-envapp-theme-preset]'));
      const nord = host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="nord"]');

      expect(presets).toHaveLength(11);
      expect(presets.map((preset) => preset.dataset.envappThemePreset)).toContain('classic-dark');
      expect(presets.map((preset) => preset.dataset.envappThemePreset)).not.toContain('classic-light');
      nord?.click();
      expect(onShellThemeChange).toHaveBeenCalledWith('dark', 'nord');
      expect(onSourceChange).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('keeps system mode while selecting the preset for the currently resolved side', () => {
    themeHarness.setSource('system');
    themeHarness.setResolved('dark');
    const { dispose, onSourceChange, onShellThemeChange } = mountPicker();
    try {
      openPicker();
      host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="monokai"]')?.click();

      expect(onShellThemeChange).toHaveBeenCalledWith('dark', 'monokai');
      expect(onSourceChange).not.toHaveBeenCalled();
      expect(host.textContent).toContain('System is currently using dark mode');
    } finally {
      dispose();
    }
  });

  it('changes the color source through the mode radiogroup', () => {
    const { dispose, onSourceChange } = mountPicker();
    try {
      openPicker();
      const darkMode = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
        (button) => button.textContent === 'Dark',
      );
      darkMode?.click();
      expect(onSourceChange).toHaveBeenCalledWith('dark');
    } finally {
      dispose();
    }
  });

  it('supports command requests, Escape focus restoration, and responsive bounds', async () => {
    const [openRequestSeq, setOpenRequestSeq] = createSignal(0);
    const { dispose } = mountPicker(openRequestSeq);
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[data-envapp-theme-trigger="topbar"]')!;
      setOpenRequestSeq(1);
      await Promise.resolve();

      const menu = host.querySelector<HTMLElement>('[data-envapp-theme-menu="topbar"]');
      expect(menu).toBeTruthy();
      expect(menu?.className).toContain('max-sm:fixed');
      expect(menu?.className).toContain('max-sm:left-2');
      expect(menu?.querySelector('[data-envapp-theme-grid="presets"]')?.className).toContain('grid-cols-1');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
      expect(host.querySelector('[data-envapp-theme-menu="topbar"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      dispose();
    }
  });

  it('closes when focus leaves and does not truncate long theme names', async () => {
    const { dispose } = mountPicker();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      openPicker();
      const mode = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
        (button) => button.textContent === 'Light',
      )!;
      const longLabel = host.querySelector<HTMLElement>('[data-envapp-theme-preset-label="hc-light"]');

      expect(longLabel?.className).toContain('break-words');
      expect(longLabel?.className).not.toContain('truncate');
      mode.focus();
      mode.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
      outside.focus();
      await Promise.resolve();
      expect(host.querySelector('[data-envapp-theme-menu="topbar"]')).toBeNull();
      expect(document.activeElement).not.toBe(host.querySelector('[data-envapp-theme-trigger="topbar"]'));
    } finally {
      dispose();
    }
  });

  it('closes when Shift+Tab returns focus to the trigger', async () => {
    const { dispose } = mountPicker();
    try {
      const trigger = openPicker();
      const mode = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
        (button) => button.textContent === 'Light',
      )!;
      mode.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: trigger }));
      await Promise.resolve();
      expect(host.querySelector('[data-envapp-theme-menu="topbar"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('scrolls the selected theme and refocuses the remembered side after a system mode change', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    themeHarness.setSource('system');
    themeHarness.setSelected({ light: 'classic-light', dark: 'monokai' });
    const { dispose } = mountPicker();
    try {
      openPicker();
      await Promise.resolve();
      expect(scrollIntoView).toHaveBeenCalled();

      host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="classic-light"]')?.focus();
      themeHarness.setResolved('dark');
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(host.querySelector('[data-envapp-theme-menu="topbar"]')).toBeTruthy();
      const monokai = host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="monokai"]');
      expect(monokai?.getAttribute('aria-checked')).toBe('true');
      expect(document.activeElement).toBe(monokai);
    } finally {
      dispose();
    }
  });

  it('shows an accessible inline error when the validated update is rejected', () => {
    const { dispose } = mountPicker(undefined, { source: false });
    try {
      openPicker();
      const darkMode = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
        (button) => button.textContent === 'Dark',
      );
      darkMode?.click();

      const alert = host.querySelector<HTMLElement>('[role="alert"]');
      expect(alert?.textContent).toBe('Could not update appearance. Try again.');
    } finally {
      dispose();
    }
  });

  it('uses roving keyboard selection within the theme grid', () => {
    themeHarness.setSource('dark');
    themeHarness.setResolved('dark');
    const { dispose, onShellThemeChange } = mountPicker();
    try {
      openPicker();
      const classicDark = host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="classic-dark"]')!;
      expect(classicDark.tabIndex).toBe(0);
      classicDark.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(onShellThemeChange).toHaveBeenCalledWith('dark', 'ink');
    } finally {
      dispose();
    }
  });
});
