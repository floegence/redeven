import '../index.css';
import './flower-feature.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { backendModelsForProviderType } from '../../../../flower_ui/testing/providerCatalogFixture';
import { kimiCodeCopy } from '../../../../flower_ui/src/settings/kimiCodeCopy';
import type { FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });
const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;

for (const width of [390, 1280]) {
  it('saves the subscription region and reviewed model while preserving the stored key at ' + width + 'px', async () => {
    await page.viewport(width, 900);
    host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
    const catalog = backendModelsForProviderType('kimi_code');
    const model = catalog.find(item => item.model_name === 'k3.1-pro')!;
    const confirm = vi.fn();
    const draft: FlowerProviderDraft = { id: 'subscription', type: 'kimi_code', name: 'Kimi Code', base_url: 'https://api.kimi.com/coding/v1/', models: [model], catalog_models: catalog, model_selection: { selected_models: [model.model_name] } };
    dispose = render(() => <FloeProvider><FlowerProviderDialog open mode="edit" provider={draft} keyConfigured webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await expect.element(page.getByRole('note')).toHaveTextContent(copy.kimiCode.notice);
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
