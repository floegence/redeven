import '../index.css';
import { BUILT_IN_SHELL_THEME_DEFAULTS, builtInShellThemePresets, FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { EnvAppThemePicker } from './EnvAppThemePicker';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('dark', 'light');
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
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe('porcelain-dark');
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
  expect(host.querySelector('[role="dialog"]')).toBeNull();
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
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe('porcelain-light');
  expect(host.querySelector<HTMLElement>('[data-envapp-theme-preset]')?.dataset.envappThemePreset).toBe('porcelain-light');
});
