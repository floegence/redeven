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
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    const [source, setSource] = createSignal<'system' | 'light' | 'dark'>('light');
    const [resolved, setResolved] = createSignal<'light' | 'dark'>('light');
    const [selected, setSelected] = createSignal({ light: 'classic-light', dark: 'classic-dark' });
    Object.assign(themeHarness, { source, setSource, resolved, setResolved, selected, setSelected });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    host = document.createElement('div'); document.body.appendChild(host);
  });
  afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function mount(outcomes: { source?: boolean | Promise<boolean>; shellTheme?: boolean | Promise<boolean> } = {}) {
    const [active, setActive] = createSignal(true);
    const onSourceChange = vi.fn(() => outcomes.source ?? true);
    const onShellThemeChange = vi.fn(() => outcomes.shellTheme ?? true);
    dispose = render(() => <EnvAppThemePicker active={active()} onSourceChange={onSourceChange} onShellThemeChange={onShellThemeChange} />, host);
    return { setActive, onSourceChange, onShellThemeChange };
  }
  const preset = (name: string) => host.querySelector<HTMLButtonElement>(`[data-theme-preset="${name}"]`)!;
  const mode = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.floe-theme-picker__modes [role=radio]')].find(button => button.textContent === name)!;
  it('uses the published appearance region without a duplicate heading, trigger or Escape owner', () => {
    mount(); const content = host.querySelector<HTMLElement>('[data-envapp-theme-menu=inline]')!;
    expect(content.getAttribute('aria-label')).toBe('Theme');
    expect(host.querySelector('h2, [aria-haspopup="dialog"], [data-envapp-theme-trigger]')).toBeNull();
    expect(content.querySelector('[role=radiogroup]')?.getAttribute('aria-label')).toBe('Color mode');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    content.dispatchEvent(escape); expect(escape.defaultPrevented).toBe(false); expect(content.isConnected).toBe(true);
  });
  it.each([['light', 13, 'cloud-white'], ['dark', 15, 'soft-black']] as const)('keeps all published %s presets including %s', (mode, count, included) => {
    themeHarness.setResolved(mode); mount();
    const controls = [...host.querySelectorAll<HTMLElement>('[data-theme-preset]')];
    expect(controls).toHaveLength(count); expect(controls[0].dataset.themePreset).toBe(`porcelain-${mode}`);
    expect(preset(included)).not.toBeNull();
  });
  it('paints before a serialized write and retains its failure across category changes', async () => {
    let finish!: (value: boolean) => void;
    const view = mount({ shellTheme: new Promise(resolve => { finish = resolve; }) });
    const target = preset('paper'); target.click(); target.click();
    expect(view.onShellThemeChange).not.toHaveBeenCalled();
    expect(target.getAttribute('aria-busy')).toBe('true'); expect(target.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('[role=status]')?.textContent).toContain('Switching appearance');
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledTimes(1));
    view.setActive(false); finish(false);
    await vi.waitFor(() => expect(target.getAttribute('aria-busy')).toBe('false'));
    view.setActive(true); expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not update appearance');
    expect(preset('classic-light').getAttribute('aria-checked')).toBe('true');
  });
  it('changes only the resolved preset while retaining system mode', async () => {
    themeHarness.setSource('system'); themeHarness.setResolved('dark'); const view = mount();
    preset('nord').click(); await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledWith('dark', 'nord'));
    expect(view.onSourceChange).not.toHaveBeenCalled();
  });
  it('routes mode choices through the preference owner and exposes rejected writes', async () => {
    const view = mount({ source: false }); mode('Dark').click();
    await vi.waitFor(() => expect(view.onSourceChange).toHaveBeenCalledWith('dark'));
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not update appearance'));
    expect(mode('Light').getAttribute('aria-checked')).toBe('true');
  });
  it('rejects hidden choices and cancels pre-paint admission', async () => {
    const view = mount(); preset('paper').click(); view.setActive(false);
    await vi.waitFor(() => expect(preset('paper').getAttribute('aria-busy')).toBe('false'));
    preset('cloud-white').click(); mode('Dark').click();
    expect(view.onSourceChange).not.toHaveBeenCalled(); expect(view.onShellThemeChange).not.toHaveBeenCalled();
  });
  it('keeps focus on the remembered preset when system appearance changes', async () => {
    themeHarness.setSource('system'); themeHarness.setSelected({ light: 'classic-light', dark: 'monokai' }); mount();
    preset('classic-light').focus(); themeHarness.setResolved('dark');
    await vi.waitFor(() => expect(document.activeElement).toBe(preset('monokai')));
    expect(preset('monokai').getAttribute('aria-checked')).toBe('true');
  });
  it.each(['mode', 'preset'])('retires a deferred %s choice after hiding and immediately returning', async kind => {
    const view = mount(); const target = kind === 'preset' ? preset('paper') : mode('Dark');
    target.click(); view.setActive(false); view.setActive(true);
    await vi.waitFor(() => expect(target.getAttribute('aria-busy')).toBe('false'));
    expect(view.onSourceChange).not.toHaveBeenCalled(); expect(view.onShellThemeChange).not.toHaveBeenCalled();
    target.click();
    await vi.waitFor(() => expect(kind === 'preset' ? view.onShellThemeChange : view.onSourceChange).toHaveBeenCalledTimes(1));
  });
  it('uses published roving keyboard selection and preserves the complete localized name', async () => {
    const view = mount(); preset('classic-light').focus();
    preset('classic-light').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledWith('light', 'paper'));
    expect(preset('hc-light').getAttribute('aria-label')).toBe('High Contrast Light');
  });
});
