import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); });

async function mount(surface: 'desktop' | 'env', width: number, locale: 'en-US' | 'zh-CN' = 'en-US') {
  await page.viewport(width, 900);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const localizedCopy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  }).settings.dialog;
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
  const catalog = Array.from({ length: 16 }, (_, index) => ({ model_name: `compatible-${index}`, status: 'needs_configuration' as const, input_modalities: ['text'] }));
  const [open, setOpen] = createSignal(true);
  const [provider, setProvider] = createSignal<FlowerProviderDraft>({ id: 'custom', type: 'openai_compatible', base_url: 'https://example.test/v1', models: [] });
  const confirm = vi.fn((draft: FlowerProviderDraft) => {
    const saved = serializeFlowerProvider(draft);
    setProvider({ ...saved, catalog_models: catalog, models: resolveFlowerProviderModels(saved, catalog) });
    setOpen(false);
  });
  function Theme() {
    const theme = useTheme();
    onMount(() => {
      theme.selectShellTheme(width === 1280 ? 'dark' : 'light', width === 1280 ? 'porcelain-dark' : 'porcelain-light');
      theme.setTheme(width === 1280 ? 'dark' : 'light');
    });
    return null;
  }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><FlowerProviderDialog copy={localizedCopy} open={open()} mode="edit" provider={provider()}
    onDiscoverModels={async () => ({ models: catalog })} keyConfigured={false} webSearchKeyConfigured={false}
    onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(width === 1280);
  await userEvent.click(page.getByRole('button', { name: localizedCopy.catalog.refresh, exact: true }));
  await expect.element(page.getByRole('checkbox', { name: 'compatible-15', exact: true })).toBeInTheDocument();
  return { confirm, reopen: () => setOpen(true), copy: localizedCopy };
}

for (const surface of ['desktop', 'env'] as const) for (const width of [1280, 390]) {
  it(`completes discovered compatible-model configuration, saves and reopens in ${surface} at ${width}px`, async () => {
    const { confirm, reopen, copy } = await mount(surface, width, 'zh-CN');
    await userEvent.click(page.getByRole('checkbox', { name: 'compatible-15', exact: true }).element().closest('label')!);
    const save = page.getByRole('button', { name: copy.saveProvider, exact: true });
    await expect.element(save).toBeEnabled();
    await userEvent.click(save);
    expect(confirm).not.toHaveBeenCalled();
    const context = page.getByRole('spinbutton', { name: copy.contextWindow, exact: true });
    await expect.element(context).toBeVisible();
    await expect.poll(() => document.activeElement === context.element()).toBe(true);
    const bounds = context.element().getBoundingClientRect();
    expect(bounds.top).toBeGreaterThan(0); expect(bounds.bottom).toBeLessThan(900);
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.scrollWidth).toBe(dialog.clientWidth);
    expect((save.element() as HTMLButtonElement).disabled).toBe(false);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-compatible-capabilities-${surface}-${width}.png` });
    await userEvent.fill(context, '32768');
    await userEvent.fill(page.getByRole('spinbutton', { name: copy.maxOutput, exact: true }), '4096');
    await userEvent.click(save);
    expect(confirm).not.toHaveBeenCalled();
    const tools = page.getByRole('combobox', { name: copy.catalog.tools, exact: true });
    await expect.poll(() => document.activeElement === tools.element()).toBe(true);
    await userEvent.selectOptions(tools, 'supported');
    await userEvent.click(save);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].models).toEqual([expect.objectContaining({ model_name: 'compatible-15', context_window: 32768, max_output_tokens: 4096, supports_tools: true })]);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    reopen();
    await expect.element(page.getByRole('checkbox', { name: 'compatible-15', exact: true })).toBeChecked();
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0].models[0]).toMatchObject({ context_window: 32768, max_output_tokens: 4096, supports_tools: true });
  });
}

it('finds hidden incomplete models and requires every selected model before confirming', async () => {
  const { confirm } = await mount('env', 1280);
  const search = page.getByPlaceholder(copy.catalog.search, { exact: true });
  for (const name of ['compatible-14', 'compatible-15']) {
    await userEvent.fill(search, name);
    await userEvent.click(page.getByRole('checkbox', { name, exact: true }).element().closest('label')!);
  }
  await userEvent.fill(search, 'compatible-0');
  await userEvent.click(page.getByRole('button', { name: copy.catalog.configure, exact: true }));
  expect((search.element() as HTMLInputElement).value).toBe('');
  for (const name of ['compatible-14', 'compatible-15']) {
    const editor = document.querySelector<HTMLElement>('[data-flower-model-editor]')!;
    expect(editor.closest('.flower-provider-model-row')!.textContent).toContain(name);
    await userEvent.fill(page.getByRole('spinbutton', { name: copy.contextWindow, exact: true }), '32768');
    await userEvent.fill(page.getByRole('spinbutton', { name: copy.maxOutput, exact: true }), '4096');
    await userEvent.selectOptions(page.getByRole('combobox', { name: copy.catalog.tools, exact: true }), name === 'compatible-14' ? 'unsupported' : 'supported');
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  }
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0].models.map(model => model.supports_tools)).toEqual([false, true]);
});

it('can deselect an incomplete model and save the connection without inventing capabilities', async () => {
  const { confirm } = await mount('env', 390);
  const checkbox = page.getByRole('checkbox', { name: 'compatible-15', exact: true });
  await userEvent.click(checkbox.element().closest('label')!);
  await userEvent.click(checkbox.element().closest('label')!);
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0].models).toEqual([]);
});
