import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { providerDefaultsFixture } from '../../../../flower_ui/testing/providerCatalogFixture';
import type { FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
const longFailure = `Provider authorization failed: ${'credential-check-'.repeat(30)}`;
const longModels = Array.from({ length: 28 }, (_, index) => ({
  model_name: `custom-model-${index + 1}`,
  context_window: 32768,
  max_output_tokens: 4096,
}));
let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;

afterEach(() => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); });

async function mount(surface: 'desktop' | 'env', width: number) {
  await page.viewport(width, 820);
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  let attempts = 0;
  let savedDraft: FlowerProviderDraft | undefined;
  function Theme() {
    const theme = useTheme();
    onMount(() => theme.selectShellTheme('light', 'porcelain-light'));
    return null;
  }
  const onConfirm = async (draft: FlowerProviderDraft) => {
    setSaving(true);
    setError('');
    try {
      attempts++;
      if (attempts === 1) throw new Error(longFailure);
      savedDraft = JSON.parse(JSON.stringify(draft)) as FlowerProviderDraft;
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><FlowerProviderDialog
    open={open()} mode="edit" copy={copy} providerDefaults={providerDefaultsFixture}
    provider={{ id: 'endpoint', type: 'openai_compatible', name: 'Custom endpoint', base_url: 'https://api.example.com/v1',
      models: longModels, catalog_models: longModels }}
    keyConfigured={true} webSearchKeyConfigured={false} error={error()} saving={saving()}
    onOpenChange={setOpen} onConfirm={onConfirm} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
  await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  return {
    dialog,
    attempts: () => attempts,
    savedDraft: () => savedDraft,
    apiKey: dialog.querySelector<HTMLInputElement>('input[type="password"]')!,
  };
}

for (const surface of ['desktop', 'env'] as const) {
  for (const width of [1280, 390]) it(`keeps save failure visible, readable and retryable in ${surface} at ${width}px`, async () => {
    const mounted = await mount(surface, width);
    await userEvent.fill(mounted.apiKey, 'replacement-key');
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    const alert = page.getByRole('alert').element() as HTMLElement;
    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.poll(() => mounted.attempts()).toBe(1);
    expect(alert.textContent).toBe(longFailure);
    expect(mounted.apiKey.value).toBe('replacement-key');

    const dialogRoot = mounted.dialog.closest<HTMLElement>('[role="dialog"]')!;
    const scrollable = [dialogRoot, ...dialogRoot.querySelectorAll<HTMLElement>('*')].find(element => {
      const overflowY = getComputedStyle(element).overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
    });
    expect(scrollable).not.toBeUndefined();
    scrollable!.scrollTop = scrollable!.scrollHeight;
    await new Promise(requestAnimationFrame);

    const footer = mounted.dialog.querySelector<HTMLElement>('.flower-provider-footer')!;
    const actions = footer.querySelector<HTMLElement>('.flex.flex-wrap')!;
    const alertBounds = alert.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    expect(alertBounds.top).toBeGreaterThanOrEqual(footerBounds.top);
    expect(alertBounds.bottom).toBeLessThanOrEqual(actions.getBoundingClientRect().top + 1);
    expect(alert.clientHeight).toBeGreaterThan(parseFloat(getComputedStyle(alert).lineHeight));
    expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth + 1);
    expect(footerBounds.top).toBeGreaterThanOrEqual(0);
    expect(footerBounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(mounted.dialog.scrollWidth).toBeLessThanOrEqual(mounted.dialog.clientWidth + 1);
    expect((page.getByRole('button', { name: copy.saveProvider, exact: true }).element() as HTMLButtonElement).disabled).toBe(false);
    expect((page.getByRole('button', { name: copy.discard, exact: true }).element() as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    await expect.poll(() => mounted.attempts()).toBe(2);
    expect(mounted.savedDraft()?.provider_api_key).toBe('replacement-key');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it(`keeps a visible exit action after a failed save in ${surface}`, async () => {
    await mount(surface, 390);
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    await expect.element(page.getByRole('alert')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: copy.discard, exact: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
}
