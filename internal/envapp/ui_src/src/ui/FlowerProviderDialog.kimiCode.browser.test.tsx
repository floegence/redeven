import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { backendModelsForProviderType, providerDefaultsFixture } from '../../../../flower_ui/testing/providerCatalogFixture';
import { kimiCodeCopy } from '../../../../flower_ui/src/settings/kimiCodeCopy';
import { FlowerModelSettings } from '../../../../flower_ui/src/settings/FlowerModelSettings';
import type { FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let style: HTMLStyleElement;
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
beforeEach(() => { vi.spyOn(console, 'warn'); });
afterEach(async () => {
  dispose?.(); host?.remove(); style?.remove(); localStorage.clear();
  await media.emulateTouchInput(false);
  expect(vi.mocked(console.warn).mock.calls.filter(args => String(args[0]).includes('computations created outside'))).toEqual([]);
  vi.restoreAllMocks();
});
function styles(surface: 'env' | 'desktop') { style = document.createElement('style'); style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS; document.head.append(style); }
const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;

for (const width of [390, 1280]) {
  it('saves the subscription region and reviewed model while preserving the stored key at ' + width + 'px', async () => {
    await media.emulateTouchInput(width === 390);
    await page.viewport(width, 900); styles('env');
    host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
    const catalog = backendModelsForProviderType('kimi_code');
    const model = catalog.find(item => item.model_name === 'k3.1-pro')!;
    const confirm = vi.fn();
    const draft: FlowerProviderDraft = { id: 'subscription', type: 'kimi_code', name: 'Kimi Code', base_url: 'https://api.kimi.com/coding/v1/', models: [model], catalog_models: catalog, model_selection: { selected_models: [model.model_name] } };
    dispose = render(() => <FloeProvider><FlowerProviderDialog open mode="edit" provider={draft} keyConfigured webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    expect(document.querySelector('[role=note]')).toBeNull();
    const accessInfo = page.getByRole('button', { name: copy.kimiCode.access, exact: true });
    await userEvent.click(accessInfo);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(copy.kimiCode.separate);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(copy.kimiCode.notice);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(copy.kimiCode.saved);
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: copy.kimiCode.console })).toHaveAttribute('href', 'https://www.kimi.com/code/console');
    await expect.element(page.getByRole('checkbox', { name: model.display_name || model.model_name, exact: true })).toBeChecked();
    expect(document.querySelectorAll('.flower-provider-models input[type="checkbox"]').length).toBe(6);
    const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(key.value).toBe('');
    expect(key.placeholder).toMatch(/•/);
    expect(document.querySelector('input[placeholder="model-name"]')).toBeNull();
    await userEvent.selectOptions(page.getByRole('combobox', { name: copy.baseURL, exact: true }), 'https://api.kimi.ai/coding/v1');
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    const saved = confirm.mock.calls[0][0] as FlowerProviderDraft;
    expect(saved.type).toBe('kimi_code');
    expect(saved.base_url).toBe('https://api.kimi.ai/coding/v1');
    expect(saved.provider_api_key).toBeUndefined();
    expect(saved.models.map(item => item.model_name)).toEqual(['k3.1-pro']);
    expect(saved.models[0].context_window).toBe(262144);
  });
}

it('ships explicit subscription guidance in every supported language', () => {
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) {
    const localized = kimiCodeCopy(locale);
    expect(Object.values(localized).every(value => value.trim().length > 0)).toBe(true);
    if (locale !== 'en-US') expect(localized.notice).not.toBe(kimiCodeCopy('en-US').notice);
  }
  expect(kimiCodeCopy('zh-TW').notice).not.toBe(kimiCodeCopy('zh-CN').notice);
});

for (const surface of ['env', 'desktop'] as const) for (const [locale, width, dark] of [['en-US', 1280, false], ['zh-CN', 390, true], ['de-DE', 320, false]] as const) {
  it('creates independent Kimi access methods in ' + surface + ' ' + locale + ' at ' + width, async () => {
    await page.viewport(width, 900); styles(surface);
    const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
    const localized = createLocalizedFlowerSurfaceCopy({ locale,
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    }).settings.dialog;
    host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
    const [open, setOpen] = createSignal(true);
    const confirm = vi.fn();
    function Theme() { const theme = useTheme(); onMount(() => theme.setTheme(dark ? 'dark' : 'light')); return null; }
    dispose = render(() => <FloeProvider><Theme /><FlowerProviderDialog open={open()} mode="create" copy={localized} providerDefaults={providerDefaultsFixture}
      provider={{ id: 'new-kimi', type: 'openai', models: [] }} keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
    const brand = page.getByRole('button', { name: 'Kimi', exact: true });
    await expect.element(brand).toBeVisible();
    expect(document.querySelectorAll('.flower-provider-choice[aria-label="Kimi"]').length).toBe(1);
    for (const choice of document.querySelectorAll<HTMLElement>('.flower-provider-choice')) {
      const label = choice.querySelector<HTMLElement>('.flower-provider-choice-label')!;
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
      expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(choice.getBoundingClientRect().right);
    }
    await userEvent.click(brand);
    await expect.element(page.getByRole('heading', { name: 'Kimi', exact: true })).toBeVisible();
    const platform = page.getByRole('button', { name: localized.kimiCode.platform, exact: true });
    const subscription = page.getByRole('button', { name: localized.kimiCode.code, exact: true });
    // Password inputs are intentionally addressed by label, not textbox role.
    const secret = () => document.querySelector<HTMLInputElement>('input[type=password]')!;
    await userEvent.fill(secret(), 'platform-fixture');
    const platformModel = backendModelsForProviderType('moonshot').find(model => model.model_name === 'kimi-k3.1-pro')!;
    await userEvent.click(page.getByRole('checkbox', { name: platformModel.display_name!, exact: true }).element().closest('label')!);
    subscription.element().focus();
    await userEvent.keyboard('{Enter}');
    expect(secret().value).toBe('');
    await expect.element(page.getByRole('button', { name: localized.saveProvider, exact: true })).toBeDisabled();
    await expect.element(subscription).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(subscription.element());
    expect(document.getElementById(brand.element().getAttribute('aria-controls')!)).not.toBeNull();
    expect(document.querySelector('[role=note]')).toBeNull();
    expect(document.querySelector('.flower-provider-kimi-access p')).toBeNull();
    const accessInfo = page.getByRole('button', { name: localized.kimiCode.access, exact: true });
    accessInfo.element().focus();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(localized.kimiCode.separate);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(localized.kimiCode.notice);
    const tooltip = page.getByRole('tooltip').element().getBoundingClientRect();
    expect(tooltip.left).toBeGreaterThanOrEqual(0); expect(tooltip.right).toBeLessThanOrEqual(width);
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.fill(secret(), 'subscription-fixture');
    await userEvent.selectOptions(page.getByRole('combobox', { name: localized.baseURL, exact: true }), 'https://api.kimi.ai/coding/v1');
    const model = backendModelsForProviderType('kimi_code').find(model => model.model_name === 'k3.1-pro')!;
    await userEvent.click(page.getByRole('checkbox', { name: model.display_name!, exact: true }).element().closest('label')!);
    await userEvent.click(platform);
    expect(secret().value).toBe('platform-fixture');
    await expect.element(page.getByRole('checkbox', { name: platformModel.display_name!, exact: true })).toBeChecked();
    await userEvent.click(subscription);
    await userEvent.click(brand);
    expect(secret().value).toBe('subscription-fixture');
    await expect.element(page.getByRole('combobox', { name: localized.baseURL, exact: true })).toHaveValue('https://api.kimi.ai/coding/v1');
    await expect.element(page.getByRole('checkbox', { name: model.display_name!, exact: true })).toBeChecked();
    const modelsInfo = page.getByRole('button', { name: localized.recommendedModelsTitle, exact: true });
    await userEvent.click(modelsInfo);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(localized.kimiCode.context);
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
    await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
    for (const element of [dialog, document.querySelector<HTMLElement>('.flower-provider-kimi-access')!]) expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: '__screenshots__/kimi-unified-' + surface + '-' + locale + '.png' });
    await userEvent.click(page.getByRole('button', { name: localized.saveProvider, exact: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ id: 'new-kimi', type: 'kimi_code', provider_api_key: 'subscription-fixture', base_url: 'https://api.kimi.ai/coding/v1', model_selection: { selected_models: ['k3.1-pro'] } });
    await userEvent.click(page.getByRole('button', { name: localized.discard, exact: true }));
    setOpen(true); await userEvent.click(brand); await userEvent.click(subscription);
    expect(secret().value).toBe('');
  });
}

it('labels both saved Kimi connections by access method without changing their aliases', async () => {
  styles('env'); host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><FlowerModelSettings copy={DEFAULT_FLOWER_SURFACE_COPY.settings}
    providers={[{ id: 'platform', type: 'moonshot', name: 'Work', models: [] }, { id: 'subscription', type: 'kimi_code', name: 'Personal', models: [] }]}
    currentModelID="" providerReady={() => true} onChooseModel={vi.fn()} onChangeReasoning={vi.fn()} onAddProvider={vi.fn()} onEditProvider={vi.fn()} onRemoveProvider={vi.fn()} onToggleProvider={vi.fn()} /></FloeProvider>, host);
  const cards = [...document.querySelectorAll('.flower-settings-provider-card')];
  expect(cards[0].textContent).toContain('Work'); expect(cards[1].textContent).toContain('Personal');
  expect(cards.map(card => card.querySelector('[data-flower-kimi-access]')?.textContent)).toEqual([copy.kimiCode.platform, copy.kimiCode.code]);
});
