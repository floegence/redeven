import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProviderDraft, FlowerProviderModel } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
const catalog: FlowerProviderModel[] = [{ capability_source: 'openai_models', model_name: 'auto%2Fagent', wire_model_name: 'auto/agent', display_name: 'Gateway Agent', context_window: 922000, max_output_tokens: 128000, input_modalities: ['text', 'image'], supports_tools: true, reasoning_capability: { kind: 'effort', wire_shape: 'openai_responses_reasoning_effort', supported_levels: ['low', 'xhigh', 'max', 'ultra'] } }, { model_name: 'unknown', status: 'needs_configuration' }];
let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); });

for (const surface of ['desktop', 'env'] as const) for (const width of [1280, 390]) {
  it(`retains discovered gateway capabilities, warns on overrides and restores endpoint values in ${surface} at ${width}px`, async () => {
    await page.viewport(width, 900);
    style = document.createElement('style'); style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS; document.head.append(style);
    host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
    const [open, setOpen] = createSignal(true);
    const [provider, setProvider] = createSignal<FlowerProviderDraft>({ id: 'gateway', type: 'openai', base_url: 'http://127.0.0.1:3425/v1', models: [], model_selection: { selected_models: [] } });
    const confirm = vi.fn((draft: FlowerProviderDraft) => {
      const saved = serializeFlowerProvider(draft);
      setProvider({ ...saved, catalog_models: catalog, models: resolveFlowerProviderModels(saved, catalog) });
      setOpen(false);
    });
    dispose = render(() => <FloeProvider><FlowerProviderDialog open={open()} mode="edit" provider={provider()} onDiscoverModels={async () => ({ models: catalog })} keyConfigured webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
    await userEvent.click(page.getByRole('button', { name: copy.catalog.refresh, exact: true }));
    await expect.element(page.getByText(copy.catalog.inputUnknown, { exact: true })).toBeVisible();
    const selected = page.getByRole('checkbox', { name: 'Gateway Agent', exact: true });
    await userEvent.click(selected.element().closest('label')!);
    const save = () => page.getByRole('button', { name: copy.saveProvider, exact: true });
    await userEvent.click(save());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].models[0]).toMatchObject({ context_window: 922000, max_output_tokens: 128000, input_modalities: ['text', 'image'], reasoning_capability: { supported_levels: ['low', 'xhigh', 'max', 'ultra'] } });
    expect(provider().model_selection?.model_overrides).toEqual([]);
    setOpen(true);
    await expect.element(selected).toBeChecked();
    await userEvent.click(page.getByRole('button', { name: copy.catalog.edit, exact: true }));
    const context = page.getByRole('spinbutton', { name: copy.contextWindow, exact: true });
    await userEvent.fill(context, '102400000');
    await expect.element(page.getByText(/Endpoint reports/)).toBeVisible();
    expect(document.querySelector('[data-flower-input-budget]')?.textContent).toContain('Usable input:');
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    document.querySelector('[data-flower-capacity-warning]')?.scrollIntoView({ block: 'center' });
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-gateway-${surface}-${width}.png` });
    await userEvent.click(page.getByRole('button', { name: copy.catalog.reset, exact: true }));
    await expect.element(context).toHaveValue(922000);
    expect(document.querySelector('[data-flower-capacity-warning]')).toBeNull();
    await userEvent.click(save());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(provider().model_selection?.model_overrides).toEqual([]);
    expect(provider().models[0].reasoning_capability?.supported_levels).toContain('ultra');
  });
}
