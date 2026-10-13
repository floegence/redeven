import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); });

async function mount(surface: 'desktop' | 'env', stored: boolean, dark = false) {
  await page.viewport(dark ? 390 : 1280, 900);
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); document.body.append(host);
  const confirm = vi.fn<(draft: FlowerProviderDraft) => void>();
  const [open, setOpen] = createSignal(true);
  function Theme() {
    const theme = useTheme();
    onMount(() => theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'porcelain-dark' : 'porcelain-light'));
    return null;
  }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><FlowerProviderDialog
    open={open()} mode="edit" provider={{ id: 'endpoint', type: 'openai_compatible', name: 'Custom endpoint', base_url: 'https://api.example.com/v1',
      web_search: { mode: 'brave' }, models: [{ model_name: 'agent', context_window: 32768, max_output_tokens: 4096 }] }}
    keyConfigured={stored} webSearchKeyConfigured={stored} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
  await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  const keys = [...dialog.querySelectorAll<HTMLInputElement>('input[type=password]')];
  expect(keys).toHaveLength(2);
  return { dialog, keys, confirm };
}

for (const surface of ['desktop', 'env'] as const) {
  for (const dark of [false, true]) it(`preserves saved API and Brave keys through focus and cleared replacement in ${surface} (${dark ? 'narrow dark' : 'wide light'})`, async () => {
    const { dialog, keys, confirm } = await mount(surface, true, dark);
    for (const key of keys) {
      expect(key.type).toBe('password');
      expect(key.value).toBe('');
      expect(key.placeholder).toBe('••••••••');
      expect(key.getAttribute('aria-label')).toBe(key === keys[0] ? copy.apiKey : copy.braveAPIKey);
      expect(key.getAttribute('aria-description')).toBe(copy.storedKeyKept);
      const placeholder = getComputedStyle(key, '::placeholder');
      expect(placeholder.opacity).toBe('1');
      expect(parseFloat(placeholder.letterSpacing)).toBeGreaterThan(2);
      await userEvent.click(key);
      expect(key.matches(':placeholder-shown')).toBe(true);
      await userEvent.fill(key, 'temporary-key');
      expect(key.getAttribute('aria-description')).toBe(copy.replaceStoredKeyHint);
      expect(key.matches(':placeholder-shown')).toBe(false);
      await userEvent.fill(key, '');
      expect(document.activeElement).toBe(key);
      expect(key.matches(':placeholder-shown')).toBe(true);
      expect(key.getAttribute('aria-description')).toBe(copy.storedKeyKept);
    }
    expect(dialog.scrollWidth).toBe(dialog.clientWidth);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-saved-key-${surface}-${dark ? 'narrow-dark' : 'wide-light'}.png` });
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].provider_api_key).toBe('');
    expect(confirm.mock.calls[0][0].web_search_api_key).toBe('');
    await userEvent.fill(keys[0], 'new-api-key');
    await userEvent.fill(keys[1], 'new-brave-key');
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm.mock.calls[1][0].provider_api_key).toBe('new-api-key');
    expect(confirm.mock.calls[1][0].web_search_api_key).toBe('new-brave-key');
  });

  it(`retains entry guidance and missing-key readiness for unsaved credentials in ${surface}`, async () => {
    const { dialog, keys, confirm } = await mount(surface, false);
    expect(keys[0].placeholder).toBe(copy.pasteAPIKey);
    expect(keys[0].getAttribute('aria-description')).toBe(copy.catalog.optionalKey);
    expect(keys[1].placeholder).toBe(copy.pasteBraveAPIKey);
    expect(keys[1].getAttribute('aria-description')).toBe(copy.requiredForBraveSearch);
    expect(keys.every(key => key.value === '' && !key.hasAttribute('data-stored-secret'))).toBe(true);
    expect((page.getByRole('button', { name: copy.saveProvider, exact: true }).element() as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    await userEvent.fill(keys[1], 'new-brave-key');
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].web_search_api_key).toBe('new-brave-key');
  });
}
