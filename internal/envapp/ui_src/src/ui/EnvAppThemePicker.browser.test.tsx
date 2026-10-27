import '../index.css';
import { BUILT_IN_SHELL_THEME_DEFAULTS, builtInShellThemePresets, FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
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
  ['en-US', 'Theme', 1100],
  ['zh-CN', '主题', 1100],
  ['zh-TW', '主題', 1100],
  ['en-US', 'Theme', 320],
  ['zh-CN', '主题', 320],
  ['zh-TW', '主題', 320],
] as const)('keeps the %s heading %s on one compact line at %i px', async (locale, title, width) => {
  await page.viewport(width, 800);
  writeStoredLanguagePreference(locale);
  const host = document.createElement('div');
  document.body.appendChild(host);
  dispose = render(() => <I18nProvider><FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}>
    <div class="flex justify-end p-4"><EnvAppThemePicker onSourceChange={() => true} onShellThemeChange={() => true} /></div>
  </FloeProvider></I18nProvider>, host);
  await expect.poll(() => host.querySelector('[data-envapp-theme-trigger]')).not.toBeNull();
  host.querySelector<HTMLButtonElement>('[data-envapp-theme-trigger]')!.click();
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  await expect.poll(() => dialog.dataset.floatingPresence).toBe('open');
  const heading = dialog.querySelector<HTMLElement>('h2')!;
  const modes = dialog.querySelector<HTMLElement>('[role="radiogroup"]')!;
  expect(heading.textContent).toBe(title);
  expect(heading.parentElement?.textContent).toBe(title);
  expect(dialog.querySelector('[id$="-mode-label"]')).toBeNull();
  expect(modes.getAttribute('aria-label')).toBeTruthy();
  const rect = heading.getBoundingClientRect();
  expect(rect.height).toBeLessThanOrEqual(parseFloat(getComputedStyle(heading).lineHeight) + 1);
  expect(modes.getBoundingClientRect().top - rect.bottom).toBeLessThanOrEqual(13);
  expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  await page.screenshot({ element: dialog });
});

it('paints feedback and keeps the workspace usable while the actual theme provider awaits a change', async () => {
  await page.viewport(1100, 800);
  const host = document.createElement('div');
  document.body.appendChild(host);
  let writes = 0;
  let complete!: () => void;
  const acknowledgement = new Promise<void>(resolve => { complete = resolve; });
  function Workspace() {
    const theme = useTheme();
    return <>
      <div class="flex justify-end p-4">
        <EnvAppThemePicker
          onSourceChange={source => { theme.setTheme(source); return true; }}
          onShellThemeChange={async (mode, name) => {
            writes++;
            await acknowledgement;
            theme.selectShellTheme(mode, name);
            return true;
          }}
        />
      </div>
      <textarea aria-label="Unsaved workspace draft" />
    </>;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}><Workspace /></FloeProvider>, host);
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(BUILT_IN_SHELL_THEME_DEFAULTS.dark);
  const draft = host.querySelector('textarea')!;
  draft.value = 'Keep this unsaved draft';
  draft.setSelectionRange(2, 6);
  const trigger = host.querySelector<HTMLButtonElement>('[data-envapp-theme-trigger]')!;
  trigger.click();
  expect(host.querySelector<HTMLElement>('[data-envapp-theme-preset]')?.dataset.envappThemePreset).toBe('porcelain-dark');
  const target = host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="nord"]')!;
  target.click();
  target.click();
  expect(writes).toBe(0);
  expect(target.getAttribute('aria-busy')).toBe('true');
  expect(target.getAttribute('aria-checked')).toBe('false');
  const status = host.querySelector<HTMLElement>('[role="status"]')!;
  await expect.element(page.elementLocator(status)).toBeVisible();
  expect(status.textContent).toContain('Switching appearance');
  await expect.poll(() => writes).toBe(1);
  trigger.click();
  // The dialog plays floe's floating-menu exit before it unmounts.
  await expect.poll(() => host.querySelector('[role="dialog"]')).toBeNull();
  // Closing restores the trigger first; subsequent user input owns focus.
  await Promise.resolve();
  draft.focus();
  complete();
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe('nord');
  await expect.poll(() => trigger.getAttribute('aria-busy')).toBe('false');
  expect(host.querySelector('textarea')).toBe(draft);
  expect(document.activeElement).toBe(draft);
  expect(draft.value).toBe('Keep this unsaved draft');
  expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 6]);
  trigger.click();
  host.querySelector<HTMLButtonElement>('[id$="-mode-light"]')!.click();
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(BUILT_IN_SHELL_THEME_DEFAULTS.light);
  expect(host.querySelector<HTMLElement>('[data-envapp-theme-preset]')?.dataset.envappThemePreset).toBe('porcelain-light');
});

it('opens and closes on floe\'s floating-menu motion, the contract the download panel uses', async () => {
  await page.viewport(1100, 800);
  const host = document.createElement('div');
  document.body.appendChild(host);
  function Workspace() {
    return <EnvAppThemePicker onSourceChange={() => true} onShellThemeChange={() => true} />;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}><Workspace /></FloeProvider>, host);

  const trigger = host.querySelector<HTMLButtonElement>('[data-envapp-theme-trigger]')!;
  trigger.click();
  const menu = await vi.waitFor(() => {
    const found = host.querySelector<HTMLElement>('[data-envapp-theme-menu="topbar"]');
    expect(found).toBeTruthy();
    return found!;
  });

  // Same class contract and same presence attribute as DownloadTaskButton.
  expect(menu.classList.contains('floe-floating-presence')).toBe(true);
  expect(menu.classList.contains('floe-floating-menu')).toBe(true);
  expect(['entering', 'open']).toContain(menu.getAttribute('data-floating-presence'));
  // floe's menu origin is the top edge, so the panel grows downward from the
  // trigger rather than from its centre.
  const origin = getComputedStyle(menu).transformOrigin.split(' ').map(part => part.trim());
  expect(origin[1]).toBe('0px');

  await expect.poll(() => menu.getAttribute('data-floating-presence')).toBe('open');

  trigger.click();
  // The layer stays mounted through the exit instead of disappearing at once.
  expect(menu.getAttribute('data-floating-presence')).toBe('exiting');
  await expect.poll(() => host.querySelector('[data-envapp-theme-menu="topbar"]')).toBeNull();
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
        presentation="inline"
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
  const target = host.querySelector<HTMLButtonElement>('[data-envapp-theme-preset="' + name + '"]')!;
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
