import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { modelCatalogCopy } from '../../../../flower_ui/src/settings/modelCatalogCopy';
import type { FlowerProviderDraft, FlowerWebSearchPolicy } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
const policy: FlowerWebSearchPolicy = { editable: true, enabled: true, default_enabled: true, default_model_enabled: true, source: 'native', supported_sources: ['native'] };
let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
afterEach(async () => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); await media.emulateTouchInput(false); });

async function mount(surface: 'desktop' | 'env', width: number, locale: string, compatible = false, deepseek = false) {
 await page.viewport(width, 900);
 style = document.createElement('style'); style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS; document.head.append(style);
 host = document.createElement('div'); document.body.append(host);
 const localized = { ...copy, catalog: modelCatalogCopy(locale) };
 const type = deepseek ? 'deepseek' : compatible ? 'openai_compatible' : 'openai';
 const search = compatible ? { ...policy, enabled: false, default_enabled: false, supported_sources: ['native', 'brave'] as const } : policy;
 const provider: FlowerProviderDraft = { id: 'proxy', type, base_url: 'https://flow-node.com/v1', search_policy: search,
  web_search: { enabled: false, source: compatible ? 'brave' : 'native' }, models: [{ model_name: 'agent', context_window: 32768, max_output_tokens: 4096, web_search: { status: 'unavailable', reason: 'provider_disabled', recommended_enabled: true, model_enabled: true } }] };
 const confirm = vi.fn<(draft: FlowerProviderDraft) => void>();
 const [open, setOpen] = createSignal(true);
 dispose = render(() => <FloeProvider><FlowerProviderDialog open={open()} mode="edit" provider={provider} searchPolicies={{ [type]: search }} initialModelName="agent" copy={localized}
  keyConfigured webSearchKeyConfigured={compatible} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
 await expect.element(page.getByRole('dialog')).toBeVisible();
 return { confirm, localized };
}

for (const surface of ['desktop', 'env'] as const) for (const width of [1280, 390]) {
 it('preserves model intent with provider off and supports search help in ' + surface + ' at ' + width + 'px', async () => {
  const { confirm, localized } = await mount(surface, width, width === 390 ? 'zh-CN' : 'en-US');
  const provider = document.querySelector('[data-flower-provider-search]')!;
  const model = document.querySelector('[data-flower-model-search]')!;
  const providerToggle = provider.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const modelToggle = model.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(providerToggle.checked).toBe(false); expect(modelToggle.checked).toBe(true); expect(modelToggle.disabled).toBe(false);
  expect(model.textContent).toContain(localized.catalog.searchProviderOff);
  await userEvent.click(modelToggle.closest('label')!);
  expect(modelToggle.checked).toBe(false);
  const info = model.querySelector<HTMLButtonElement>('button')!;
  info.focus();
  await expect.element(page.getByRole('tooltip')).toBeVisible();
  expect(page.getByRole('tooltip').element().textContent).toContain(localized.catalog.searchModelHint);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await userEvent.click(providerToggle.closest('label')!);
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0]).toMatchObject({ web_search: { enabled: true, source: 'native' }, models: [{ model_name: 'agent', web_search_enabled: false }] });
  expect(document.querySelector<HTMLElement>('[role=dialog]')!.scrollWidth).toBe(document.querySelector<HTMLElement>('[role=dialog]')!.clientWidth);
 });
}

it('keeps a stored Brave key when changing source or disabling search', async () => {
 const { confirm } = await mount('env', 390, 'en-US', true);
 await userEvent.click(document.querySelector('[data-flower-provider-search] [data-floe-dropdown-trigger]')!);
 await userEvent.click(page.getByRole('menuitem', { name: copy.openAIBuiltIn, exact: true }));
 await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
 expect(confirm.mock.calls[0][0].web_search).toEqual({ enabled: false, source: 'native' });
 expect(confirm.mock.calls[0][0].web_search_api_key).toBeUndefined();
});

it('clears an explicit model override when restoring defaults', async () => {
 const { confirm } = await mount('env', 1280, 'en-US');
 await userEvent.click(document.querySelector('[data-flower-model-search] input')!.closest('label')!);
 await userEvent.click(page.getByRole('button', { name: copy.catalog.reset, exact: true }));
 await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
 expect(confirm.mock.calls[0][0].models[0].web_search_enabled).toBeUndefined();
});

it.each(['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'])('renders search information in %s without overflowing the narrow dialog', async locale => {
 const { localized } = await mount('env', 390, locale);
 const info = document.querySelector<HTMLButtonElement>('[data-flower-provider-search] button')!;
 await userEvent.click(info);
 await expect.element(page.getByRole('tooltip')).toBeVisible();
 const tooltip = page.getByRole('tooltip').element().getBoundingClientRect();
 expect(page.getByRole('tooltip').element().textContent).toContain(localized.catalog.searchProviderHint);
 expect(tooltip.left).toBeGreaterThanOrEqual(0);
 expect(tooltip.right).toBeLessThanOrEqual(390);
 await userEvent.keyboard('{Escape}');
 await expect.element(page.getByRole('dialog')).toBeVisible();
});

it('opens search help using touch and leaves the dialog recoverable', async () => {
 await media.emulateTouchInput(true);
 await mount('env', 390, 'zh-CN');
 await userEvent.click(document.querySelector('[data-flower-model-search] button')!);
 await expect.element(page.getByRole('tooltip')).toBeVisible();
 await userEvent.click(page.getByRole('button', { name: copy.discard, exact: true }));
 await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

it.each(['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','it-IT','es-ES','pt-BR','ru-RU'])('configures DeepSeek page reading independently from search in %s',async locale=>{
 const {confirm,localized}=await mount('env',390,locale,false,true);
 const section=document.querySelector('[data-flower-provider-fetch]')!;
 expect(section.textContent).toContain(localized.catalog.deepSeekSearchHint);
 expect(section.textContent).toContain(localized.catalog.deepSeekCostHint);
 expect(document.querySelector('[data-flower-provider-search] [data-floe-dropdown-trigger]')).toBeNull();
 await userEvent.click(section.querySelector('[data-floe-dropdown-trigger]')!);
 await userEvent.click(page.getByRole('menuitem',{name:localized.catalog.fetchDeepSeek,exact:true}));
 await userEvent.click(page.getByRole('button',{name:copy.saveProvider,exact:true}));
 expect(confirm.mock.calls[0][0]).toMatchObject({web_search:{enabled:false,source:'native'},web_fetch:{source:'deepseek'}});
 expect(document.querySelector<HTMLElement>('[role=dialog]')!.scrollWidth).toBe(document.querySelector<HTMLElement>('[role=dialog]')!.clientWidth);
});
