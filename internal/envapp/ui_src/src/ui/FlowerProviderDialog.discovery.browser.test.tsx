import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import type { FlowerProviderDraft, FlowerModelCatalogDiscovery } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); });

for (const surface of ['desktop', 'env'] as const) {
  for (const [width, locale] of [[1280, 'en-US'], [390, 'zh-CN']] as const) {
    for (const type of ['openrouter', 'ollama'] as const) {
      it(`discovers ${type} during setup and discloses requests in ${surface} at ${width}px (${locale})`, async () => {
        await page.viewport(width, 900);
        const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
        const copy = createLocalizedFlowerSurfaceCopy({ locale,
          t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
          tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
        }).settings.dialog;
        style = document.createElement('style');
        style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
        document.head.append(style);
        host = document.createElement('div'); document.body.append(host);
        let complete!: (result: { models: FlowerProviderDraft['models'] }) => void;
        const discover = vi.fn<FlowerModelCatalogDiscovery>(() => new Promise(resolve => { complete = resolve; }));
        const [open, setOpen] = createSignal(true);
        const confirm = vi.fn();
        dispose = render(() => <FloeProvider><FlowerProviderDialog open={open()} mode="create"
          provider={{ id: 'new-provider', type: 'openai', models: [] }} copy={copy} onDiscoverModels={discover}
          keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
        await expect.element(page.getByRole('dialog')).toBeVisible();
        await userEvent.click(document.querySelector<HTMLButtonElement>(`[aria-controls=flower-provider-type-${type}]`)!);
        const notice = type === 'openrouter' ? copy.openRouterDiscovery : copy.ollamaDiscovery;
        await expect.element(page.getByText(notice, { exact: true })).toBeVisible();
        if (type === 'openrouter') {
          expect(discover).not.toHaveBeenCalled();
          await userEvent.fill(document.querySelector<HTMLInputElement>('input[type=password]')!, 'new-api-key');
          expect(discover).not.toHaveBeenCalled();
          await userEvent.click(page.getByText(notice, { exact: true }));
        }
        await expect.poll(() => discover.mock.calls.length).toBe(1);
        expect(discover.mock.calls[0][0].type).toBe(type);
        expect((page.getByRole('button', { name: copy.catalog.refresh, exact: true }).element() as HTMLButtonElement).disabled).toBe(true);
        complete({ models: [{ model_name: 'discovered-agent', context_window: 8192, max_output_tokens: 1024, supports_tools: true }] });
        await expect.element(page.getByRole('checkbox', { name: 'discovered-agent', exact: true })).toBeVisible();
        expect((page.getByRole('checkbox', { name: 'discovered-agent', exact: true }).element() as HTMLInputElement).checked).toBe(false);
        await userEvent.click((page.getByRole('checkbox', { name: 'discovered-agent', exact: true }).element() as HTMLInputElement).closest('label')!);
        const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
        const paragraph = page.getByText(notice, { exact: true }).element() as HTMLElement;
        expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.clientWidth + 1);
        if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
          await page.screenshot({ element: dialog, path: `__screenshots__/flower-discovery-${surface}-${type}-${width}-${locale}.png` });
        }
        await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
        expect(confirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type, models: [expect.objectContaining({ model_name: 'discovered-agent' })] }));
        expect(discover).toHaveBeenCalledTimes(1);
      });
    }
  }

  it.each(['discard', 'close', 'switch'] as const)(`skips outgoing OpenRouter discovery on %s in ${surface}`, async action => {
    await page.viewport(1280, 900);
    style = document.createElement('style'); style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS; document.head.append(style);
    host = document.createElement('div'); document.body.append(host);
    const discover = vi.fn(async () => ({ models: [] }));
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <FloeProvider><FlowerProviderDialog open={open()} mode="create"
      provider={{ id: 'draft', type: 'openrouter', models: [] }} onDiscoverModels={discover}
      keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={vi.fn()} /></FloeProvider>, host);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openrouter]')!);
    await userEvent.fill(document.querySelector<HTMLInputElement>('input[type=password]')!, 'key');
    if (action === 'discard') await userEvent.click(page.getByRole('button', { name: 'Discard', exact: true }));
    else if (action === 'close') await userEvent.click(document.querySelector<HTMLButtonElement>('[data-floe-dialog-header] button')!);
    else await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-anthropic]')!);
    expect(discover).not.toHaveBeenCalled();
    expect(open()).toBe(action === 'switch');
  });
}
