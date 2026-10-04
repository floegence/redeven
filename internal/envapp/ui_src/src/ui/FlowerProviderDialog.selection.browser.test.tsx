import '../index.css';
import './flower-feature.css';

import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { flowerProviderModelChoices, setFlowerModelsEnabled } from '../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProviderDraft, FlowerModelCatalogDiscovery } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { AIProviderDialog } from './pages/settings/AIProviderDialog';
import type { AIProviderRow, AIProviderModelPreset } from './pages/settings/types';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function settledDialog() {
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAttribute('data-floating-presence')).toBe('open');
  await frame();
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
}

function provider(count: number, selectedIndex = 0): FlowerProviderDraft {
  const catalog = Array.from({ length: count }, (_, index) => ({
    model_name: `agent-${index}`, context_window: 131072, quantization: 'Q8_0', input_modalities: index % 2 === 0 ? ['text'] : ['text', 'image'],
  }));
  return { id: 'local', type: 'ollama', name: 'Local models', base_url: 'http://localhost:11434/v1',
    models: [{ ...catalog[selectedIndex] }], catalog_models: catalog, model_selection: { selected_models: [catalog[selectedIndex].model_name] } };
}

function createHost() {
  host = document.createElement('div');
  host.className = 'flower-surface';
  document.body.append(host);
}

for (const [count, width, initiallySelected] of [[4, 1280, false], [40, 1280, false], [4, 390, false], [40, 390, false], [4, 1280, true], [4, 390, true]] as const) {
  it(`preserves the shared dialog scroll and focused checkbox through repeated toggles in ${count} rows at ${width}px (selected=${initiallySelected})`, async () => {
    await page.viewport(width, 900);
    createHost();
    const draft = provider(count, initiallySelected ? 2 : 0);
    dispose = render(() => <FloeProvider><FlowerProviderDialog open mode="edit" provider={draft}
      keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} /></FloeProvider>, host);
    await expect.element(page.getByRole('checkbox', { name: 'agent-2', exact: true })).toBeVisible();
    await settledDialog();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="agent-2"]')!;
    const panel = document.getElementById('flower-provider-type-ollama')!;
    input.closest('label')!.scrollIntoView({ block: 'center' });
    await frame();
    expect(panel.scrollTop).toBeGreaterThan(0);
    const initialTop = panel.scrollTop;
    const rect = input.closest('label')!.getBoundingClientRect();
    const modelRows = [...input.closest('label')!.parentElement!.parentElement!.parentElement!.children] as HTMLElement[];
    const rowHeights = modelRows.map(row => row.getBoundingClientRect().height);
    for (let index = 0; index < 4; index++) {
      if (index < 2) await userEvent.click(input.closest('label')!);
      else await userEvent.keyboard(' ');
      await frame();
      expect.soft(panel.scrollTop, 'selection must not move the scroller').toBeCloseTo(initialTop, 0);
      expect(document.querySelector('input[aria-label="agent-2"]') === input, 'selection must reuse its checkbox').toBe(true);
      expect.soft(document.activeElement === input, 'selection must retain keyboard focus').toBe(true);
      expect.soft(input.closest('label')!.getBoundingClientRect().top, 'selection must retain the clicked row position').toBeCloseTo(rect.top, 0);
      expect(input.checked).toBe(initiallySelected ? index % 2 !== 0 : index % 2 === 0);
      expect(modelRows.map(row => row.getBoundingClientRect().height), 'selection must not reflow any model row').toEqual(rowHeights);
      expect(panel.scrollWidth).toBe(panel.clientWidth);
    }
  });
}

for (const width of [1280, 390]) {
  it(`preserves environment dialog scroll and focus through draft replacement at ${width}px`, async () => {
    await page.viewport(width, 900);
    createHost();
    const [draft, setDraft] = createSignal(provider(40));
    const change = (name: string, enabled: boolean) => setDraft((current) => setFlowerModelsEnabled(current,
      flowerProviderModelChoices(current).filter((model) => model.model_name === name), enabled));
    dispose = render(() => <FloeProvider><AIProviderDialog open mode="edit" title="Edit provider" provider={draft() as AIProviderRow}
      canInteract canAdmin aiSaving={false} keySet={false} keyDraft="" keySaving={false} webSearchKeySet={false} webSearchKeyDraft="" webSearchKeySaving={false}
      recommendedModels={flowerProviderModelChoices(draft()) as readonly AIProviderModelPreset[]} onOpenChange={vi.fn()} onConfirm={vi.fn()} onClearModels={vi.fn()}
      onChangeName={vi.fn()} onChangeType={vi.fn()} onChangeBaseURL={vi.fn()} onChangeKeyDraft={vi.fn()} onChangeWebSearchMode={vi.fn()}
      onChangeWebSearchKeyDraft={vi.fn()} onApplyAllPresets={vi.fn()} onAddSelectedPreset={(name) => change(name!, true)}
      onRemoveRecommendedPreset={(name) => change(name, false)} onAddCustomModel={vi.fn()} onChangeModelName={vi.fn()}
      onChangeModelNumber={vi.fn()} onChangeModelImageInput={vi.fn()} onRemoveModel={vi.fn()} /></FloeProvider>, host);
    await settledDialog();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-provider-dialog-step="models"]')!);
    await settledDialog();
    await frame();
    const row = [...document.querySelectorAll<HTMLElement>('.redeven-settings-choice')].find((node) => node.textContent?.startsWith('agent-12'))!;
    const button = row.querySelector<HTMLButtonElement>('button')!;
    button.scrollIntoView({ block: 'center' });
    await frame();
    let scroller = row.parentElement!;
    while (scroller.scrollHeight <= scroller.clientHeight || !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement!;
    const initialTop = scroller.scrollTop;
    const rowHeight = row.getBoundingClientRect().height;
    const buttonWidth = button.getBoundingClientRect().width;
    expect(initialTop).toBeGreaterThan(0);
    for (let index = 0; index < 4; index++) {
      if (index < 2) await userEvent.click(button);
      else await userEvent.keyboard(' ');
      await frame();
      expect.soft(scroller.scrollTop).toBeCloseTo(initialTop, 0);
      expect.soft(row.getBoundingClientRect().height).toBe(rowHeight);
      expect.soft(button.getBoundingClientRect().width).toBe(buttonWidth);
      expect(button.isConnected).toBe(true);
      expect.soft(document.activeElement === button).toBe(true);
      expect(draft().models.some((model) => model.model_name === 'agent-12')).toBe(index % 2 === 0);
    }
    setDraft(current => ({ ...current, catalog_models: current.catalog_models!.filter(model => model.model_name !== 'agent-1')
      .map(model => model.model_name === 'agent-12' ? { ...model, display_name: 'Updated model', quantization: 'Q4_K_M', unavailable: true } : { ...model }) }));
    await frame();
    expect(button.isConnected).toBe(true);
    expect(row.textContent).toContain('Updated model');
    expect(row.textContent).toContain('Q4_K_M');
    expect(row.textContent).not.toContain('Q8_0');
    expect(button.disabled).toBe(true);
  });
}

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;

it('refreshes shared catalog metadata and membership without replacing surviving controls or selecting additions', async () => {
  await page.viewport(1280, 900);
  createHost();
  const draft = provider(4);
  let finishDiscovery!: (value: Awaited<ReturnType<FlowerModelCatalogDiscovery>>) => void;
  const discover = vi.fn<FlowerModelCatalogDiscovery>(() => new Promise(resolve => { finishDiscovery = resolve; }));
  const confirm = vi.fn();
  dispose = render(() => <FloeProvider><FlowerProviderDialog open mode="edit" provider={draft}
    onDiscoverModels={discover} keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
  await settledDialog();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="agent-2"]')!;
  const row = input.closest('label')!.parentElement!.parentElement!;
  await userEvent.click(page.getByRole('button', { name: copy.catalog.refresh, exact: true }));
  input.focus();
  finishDiscovery({ models: [
    { ...draft.catalog_models![0] },
    { ...draft.catalog_models![2], display_name: 'Refreshed model', quantization: 'Q4_K_M', context_window: 65536 },
    { model_name: 'new-model', context_window: 131072 },
  ] });
  await frame();
  expect(input.isConnected).toBe(true);
  expect(document.activeElement === input).toBe(true);
  expect(input.getAttribute('aria-label')).toBe('Refreshed model');
  expect(row.textContent).toContain('Q4_K_M');
  expect(row.textContent).not.toContain('Q8_0');
  expect(document.querySelector('input[aria-label="agent-1"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[aria-label="new-model"]')!.checked).toBe(false);
  await userEvent.keyboard(' ');
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  const saved = confirm.mock.calls[0][0] as FlowerProviderDraft;
  expect(saved.models.map(model => model.model_name).sort()).toEqual(['agent-0', 'agent-2']);
  expect(saved.models.find(model => model.model_name === 'agent-2')?.context_window).toBe(65536);
});

it('keeps the shared parameter editor focused through consecutive edits and reads current preset metadata on reset', async () => {
  await page.viewport(1280, 900);
  createHost();
  const confirm = vi.fn();
  dispose = render(() => <FloeProvider><FlowerProviderDialog open mode="edit" provider={provider(4)}
    keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
  await settledDialog();
  const row = document.querySelector('input[aria-label="agent-0"]')!.closest('label')!.parentElement!.parentElement!;
  await userEvent.click(row.querySelector<HTMLButtonElement>(`button[aria-label="${copy.catalog.edit}"]`)!);
  const input = row.querySelector<HTMLInputElement>('input[type="number"][placeholder="128000"]')!;
  await userEvent.fill(input, '8192');
  expect(input.isConnected).toBe(true);
  expect(document.activeElement === input).toBe(true);
  await userEvent.keyboard('0');
  expect(input.value).toBe('81920');
  expect(document.activeElement === input).toBe(true);
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect((confirm.mock.calls[0][0] as FlowerProviderDraft).models[0].context_window).toBe(81920);
  await userEvent.click(row.querySelector<HTMLButtonElement>(`button[aria-label="${copy.catalog.reset}"]`)!);
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe('131072');
});
