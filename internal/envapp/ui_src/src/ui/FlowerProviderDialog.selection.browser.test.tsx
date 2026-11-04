import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';

import { FloeProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import type { FlowerProviderDraft, FlowerModelCatalogDiscovery } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let style: HTMLStyleElement;
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
afterEach(async () => { dispose?.(); host?.remove(); style?.remove(); await media.emulateTouchInput(false); });
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

function createHost(surface: 'env' | 'desktop' = 'env') {
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
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
    const scroller = panel;
    input.closest('label')!.scrollIntoView({ block: 'center' });
    await frame();
    expect(scroller.scrollTop).toBeGreaterThan(0);
    const initialTop = scroller.scrollTop;
    const rect = input.closest('label')!.getBoundingClientRect();
    const modelRows = [...input.closest('label')!.parentElement!.parentElement!.parentElement!.children] as HTMLElement[];
    const rowHeights = modelRows.map(row => row.getBoundingClientRect().height);
    for (let index = 0; index < 4; index++) {
      if (index < 2) await userEvent.click(input.closest('label')!);
      else await userEvent.keyboard(' ');
      await frame();
      expect.soft(scroller.scrollTop, 'selection must not move the scroller').toBeCloseTo(initialTop, 0);
      expect(document.querySelector('input[aria-label="agent-2"]') === input, 'selection must reuse its checkbox').toBe(true);
      expect.soft(document.activeElement === input, 'selection must retain keyboard focus').toBe(true);
      expect.soft(input.closest('label')!.getBoundingClientRect().top, 'selection must retain the clicked row position').toBeCloseTo(rect.top, 0);
      expect(input.checked).toBe(initiallySelected ? index % 2 !== 0 : index % 2 === 0);
      expect(modelRows.map(row => row.getBoundingClientRect().height), 'selection must not reflow any model row').toEqual(rowHeights);
      expect(panel.scrollWidth).toBe(panel.clientWidth);
    }
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
  const input = row.querySelector<HTMLInputElement>('input[type="number"]')!;
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

for (const surface of ['env', 'desktop'] as const) for (const mode of ['light', 'dark'] as const) for (const width of [390, 1440]) it(`selects via the model name once and retains independent actions at ${width}px in ${mode} on ${surface}`, async () => {
  await media.emulateTouchInput(width === 390);
  await page.viewport(width, 900);
  createHost(surface);
  const confirm = vi.fn();
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: {
    defaultTheme: mode, shellPresets: builtInShellThemePresets,
    defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' },
    defaultSurfaceStyle: 'soft-neumorphic',
  } }}><FlowerProviderDialog open mode="edit" provider={provider(4)}
    keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
  await settledDialog();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="agent-2"]')!;
  const name = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!;
  const face = input.closest('label')!.querySelector<HTMLElement>('[data-floe-choice-kind="checkbox"]')!;
  expect(name).not.toBeNull();
  expect(name.getBoundingClientRect().height).toBeGreaterThanOrEqual(width === 390 ? 44 : 24);
  expect(face, 'requires the published checkbox state recipe').not.toBeNull();
  const faceRect = face.getBoundingClientRect();
  const nameRect = name.getBoundingClientRect();
  const choice = input.closest('label')!;
  const diagnostic = [choice, face, name, name.parentElement!].map(element => ({ class: element.className, y: element.getBoundingClientRect().y, height: element.getBoundingClientRect().height, minHeight: getComputedStyle(element).minHeight, lineHeight: getComputedStyle(element).lineHeight }));
  expect(Math.abs(faceRect.y + faceRect.height / 2 - nameRect.y - nameRect.height / 2), 'the face and model name share a center line: ' + JSON.stringify(diagnostic)).toBeLessThanOrEqual(1);
  expect(getComputedStyle(face).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(face.querySelector('svg')).toBeNull();
  await userEvent.click(name);
  expect(input.checked).toBe(true);
  expect(face.querySelector('svg')).not.toBeNull();
  expect(document.querySelector('input[aria-label="agent-2"]')).toBe(input);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await page.screenshot({ element: document.querySelector<HTMLElement>('.flower-provider-dialog')!, path: `__screenshots__/checkbox-models-${surface}-${mode}-${width}.png` });
  }
  const row = input.closest('.flower-provider-model-row')!;
  await userEvent.click(row.querySelector<HTMLButtonElement>(`button[aria-label="${copy.catalog.edit}"]`)!);
  expect(input.checked).toBe(true);
  await userEvent.click(row.querySelector<HTMLButtonElement>(`button[aria-label="${copy.catalog.reset}"]`)!);
  expect(input.checked).toBe(true);
  await userEvent.click(name);
  expect(input.checked).toBe(false);
  expect(face.querySelector('svg')).toBeNull();
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect((confirm.mock.calls[0][0] as FlowerProviderDraft).models.map(model => model.model_name)).toEqual(['agent-0']);
});

for (const surface of ['env', 'desktop'] as const) for (const mode of ['light', 'dark'] as const) for (const width of [390, 1440]) it(`keeps DeepSeek search visually distinct and saves its independent intent at ${width}px in ${mode} on ${surface}`, async () => {
  await media.emulateTouchInput(width === 390);
  await page.viewport(width, 900);
  createHost(surface);
  const confirm = vi.fn();
  const catalog = [
    { model_name: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: 131072 },
    { model_name: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', context_window: 131072 },
  ];
  const draft: FlowerProviderDraft = {
    id: 'deepseek', type: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com',
    models: [catalog[0]], catalog_models: catalog,
    web_search: { enabled: false, source: 'native' }, web_fetch: { source: 'direct' },
  };
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: {
    defaultTheme: mode, shellPresets: builtInShellThemePresets,
    defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' },
    defaultSurfaceStyle: 'soft-neumorphic',
  } }}><FlowerProviderDialog open mode="edit" provider={draft} searchPolicies={{ deepseek: {
    editable: true, enabled: true, default_enabled: true, default_model_enabled: true,
    default_fetch_source: 'deepseek', source: 'native', supported_sources: ['native'],
  } }} keyConfigured webSearchKeyConfigured onOpenChange={vi.fn()} onConfirm={confirm} /></FloeProvider>, host);
  await settledDialog();
  const search = document.querySelector<HTMLInputElement>('[data-flower-provider-search] input')!;
  const label = search.closest('label')!;
  const face = label.querySelector<HTMLElement>('[data-floe-choice-kind="checkbox"]')!;
  const reader = document.querySelector<HTMLElement>('[data-flower-provider-fetch] [data-floe-dropdown-trigger]')!;
  expect(search.checked).toBe(false);
  expect(getComputedStyle(face).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(face.querySelector('svg')).toBeNull();
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await page.screenshot({ element: document.querySelector<HTMLElement>('.flower-provider-dialog')!, path: `__screenshots__/checkbox-deepseek-${surface}-${mode}-${width}.png` });
  }
  await userEvent.click(label);
  expect(search.checked).toBe(true);
  expect(face.querySelector('svg')).not.toBeNull();
  expect(reader.textContent).toContain(copy.catalog.fetchDirect);
  await userEvent.keyboard(' ');
  expect(search.checked).toBe(false);
  expect(document.querySelector('[data-flower-provider-search] input')).toBe(search);
  await userEvent.click(label);
  await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][0]).toMatchObject({ web_search: { enabled: true, source: 'native' }, web_fetch: { source: 'direct' } });
});
