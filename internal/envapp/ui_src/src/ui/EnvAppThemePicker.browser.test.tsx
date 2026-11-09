import '../index.css';
import { BUILT_IN_SHELL_THEME_DEFAULTS, builtInShellThemePresets, FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { EnvAppThemePicker } from './EnvAppThemePicker';
import { I18nProvider } from './i18n';
import { writeStoredLanguagePreference } from './i18n/storage';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('dark', 'light');
  writeStoredLanguagePreference('system');
});

it.each([
  ['en-US', 1100], ['zh-CN', 1100], ['zh-TW', 1100],
  ['en-US', 320], ['zh-CN', 320], ['zh-TW', 320],
] as const)('keeps shared appearance controls compact and named in %s at %i px', async (locale, width) => {
  await page.viewport(width, 800); writeStoredLanguagePreference(locale);
  const host = document.createElement('div'); document.body.appendChild(host);
  dispose = render(() => <I18nProvider><FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}>
    <div class="p-4"><EnvAppThemePicker onSourceChange={() => true} onShellThemeChange={() => true} /></div>
  </FloeProvider></I18nProvider>, host);
  await expect.poll(() => host.querySelector('[role=region]')).not.toBeNull();
  const region = host.querySelector<HTMLElement>('[role=region]')!;
  const modes = host.querySelector<HTMLElement>('.floe-theme-picker__modes')!;
  expect(region.getAttribute('aria-label')).toBeTruthy();
  expect(modes.getAttribute('aria-label')).toBeTruthy();
  expect(region.querySelector('h1, h2, [role=dialog], [data-envapp-theme-trigger]')).toBeNull();
  expect(modes.getBoundingClientRect().width).toBeLessThan(340);
  expect(modes.getBoundingClientRect().height).toBeLessThanOrEqual(36);
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1);
  const checks = [...region.querySelectorAll<HTMLElement>('.floe-theme-picker__caption > .floe-theme-picker__check')].filter(node => getComputedStyle(node).visibility === 'visible');
  expect(checks).toHaveLength(1);
  expect(checks[0].closest('[data-theme-preset]')?.getAttribute('aria-checked')).toBe('true');
});

it('paints feedback, retains drafts and completes the accepted preference after the category hides', async () => {
  await page.viewport(1100, 800);
  const host = document.createElement('div'); document.body.appendChild(host);
  let writes = 0; let complete!: () => void; let setActive!: (active: boolean) => void;
  const acknowledgement = new Promise<void>(resolve => { complete = resolve; });
  function Workspace() {
    const theme = useTheme(); const [active, updateActive] = createSignal(true); setActive = updateActive;
    return <><div hidden={!active()}><EnvAppThemePicker active={active()}
      onSourceChange={source => { theme.setTheme(source); return true; }}
      onShellThemeChange={async (mode, name) => { writes++; await acknowledgement; theme.selectShellTheme(mode, name); return true; }} /></div>
      <textarea aria-label="Unsaved workspace draft" /></>;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}><Workspace /></FloeProvider>, host);
  const draft = host.querySelector('textarea')!; draft.value = 'Keep this unsaved draft'; draft.setSelectionRange(2, 6);
  const target = host.querySelector<HTMLButtonElement>('[data-theme-preset=nord]')!; target.click(); target.click();
  expect(writes).toBe(0); expect(target.getAttribute('aria-busy')).toBe('true'); expect(target.getAttribute('aria-checked')).toBe('false');
  await expect.element(page.elementLocator(host.querySelector<HTMLElement>('[role=status]')!)).toBeVisible();
  await expect.poll(() => writes).toBe(1);
  setActive(false); draft.focus(); complete();
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe('nord');
  expect(host.querySelector('textarea')).toBe(draft); expect(document.activeElement).toBe(draft);
  expect(draft.value).toBe('Keep this unsaved draft'); expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 6]);
  setActive(true); expect(target.getAttribute('aria-checked')).toBe('true');
  const light = [...host.querySelectorAll<HTMLButtonElement>('.floe-theme-picker__modes [role=radio]')].find(node => node.textContent === 'Light')!;
  light.click(); await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(BUILT_IN_SHELL_THEME_DEFAULTS.light);
  expect(host.querySelector<HTMLElement>('[data-theme-preset]')?.dataset.themePreset).toBe('porcelain-light');
});

it.each([
  ['light', 'cloud-white', 'rgb(255, 255, 255)', 'rgb(48, 52, 59)'],
  ['dark', 'soft-black', 'rgb(9, 9, 11)', 'rgb(198, 197, 193)'],
] as const)('applies the published %s preset %s without replacing the draft', async (mode, name, background, foreground) => {
  await page.viewport(1100, 800);
  const host = document.createElement('div');
  document.body.appendChild(host);
  function Workspace() {
    const theme = useTheme();
    return <>
      <EnvAppThemePicker
        onSourceChange={source => { theme.setTheme(source); return true; }}
        onShellThemeChange={(targetMode, targetName) => { theme.selectShellTheme(targetMode, targetName); return true; }}
      />
      <textarea aria-label="Retained theme draft" />
      <div data-reading-surface style={{ background: 'var(--background)', color: 'var(--foreground)' }}>Reading surface</div>
    </>;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: mode, shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}><Workspace /></FloeProvider>, host);
  const draft = host.querySelector('textarea')!;
  draft.value = 'Keep the draft while changing appearance';
  draft.setSelectionRange(5, 14);
  const target = host.querySelector<HTMLButtonElement>('[data-theme-preset="' + name + '"]')!;
  expect(target).toBeTruthy();
  target.click();
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(name);
  expect(target.getAttribute('aria-checked')).toBe('true');
  const reading = getComputedStyle(host.querySelector<HTMLElement>('[data-reading-surface]')!);
  expect(reading.backgroundColor).toBe(background);
  expect(reading.color).toBe(foreground);
  expect(host.querySelector('textarea')).toBe(draft);
  expect(draft.value).toBe('Keep the draft while changing appearance');
  expect([draft.selectionStart, draft.selectionEnd]).toEqual([5, 14]);
});
