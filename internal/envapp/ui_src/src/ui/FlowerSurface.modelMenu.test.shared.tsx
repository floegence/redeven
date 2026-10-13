import { expect, it, vi } from 'vitest';
import type { FlowerModelDirectory, FlowerSettingsDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, renderSurfaceWithAdapter, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

it.each(['ready', 'unavailable'] as const)('preserves the selected model and menu focus when background metadata becomes %s', async state => {
  const directory: FlowerModelDirectory = { current_model_id: 'static/agent',
    models: [{ id: 'static/agent', label: 'Current provider / Agent', source: 'runtime_config', state: 'ready', provider_id: 'static', model_name: 'agent' }],
    sources: [{ id: 'static', kind: 'runtime_config', state: 'ready' }],
  };
  let publish!: (value: FlowerModelDirectory) => void;
  const surface = renderSurfaceWithAdapter({ ...adapter(),
    loadSettings: async () => ({ ...settingsSnapshot(), model_profile: null, model_directory: directory }),
    loadModelDirectory: async () => directory,
    subscribeModelDirectory: listener => { publish = listener; return () => undefined; },
    listThreads: async () => [],
  });
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('Agent') === true);
  const trigger = surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!;
  expect(trigger.querySelector('[class*="animate-spin"]')).toBeNull();
  expect(trigger.hasAttribute('aria-busy')).toBe(false);
  expect(trigger.getAttribute('aria-label')).toContain('Current provider / Agent');
  trigger.click();
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  const search = document.querySelector<HTMLInputElement>('.flower-model-menu input')!;
  search.value = 'Agent'; search.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(document.querySelector('.flower-model-menu-status')).toBeNull();
  publish({ ...directory,
    models: directory.models.map(model => ({ ...model, state })),
  });
  expect(document.querySelector('.flower-model-menu-status')?.textContent ?? '').not.toMatch(/checking|seconds|failed/iu);
  expect(search.value).toBe('Agent');
  expect(document.activeElement).toBe(search);
  expect(trigger.textContent).toContain('Current provider / Agent');
  expect(trigger.querySelector('[class*="animate-spin"]')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('.flower-model-menu-item')?.disabled).toBe(state === 'unavailable');
});

it('searches a bounded menu, preserves a selected alias, and opens model management', async () => {
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { schema_version: 1 as const, current_model_id: 'local/agent-q8', providers: [{
    id: 'local', name: 'Local models', type: 'ollama' as const, models: [
      { model_name: 'agent', model_digest: 'same', quantization: 'Q8_0', context_window: 32768 },
      { model_name: 'agent-q8', model_digest: 'same', quantization: 'Q8_0', context_window: 32768 },
      ...Array.from({ length: 30 }, (_, i) => ({ model_name: `model-${i}`, context_window: 32768 })),
      { model_name: 'removed', unavailable: true },
    ],
  }] } };
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, listThreads: async () => [] });
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('agent-q8') === true);
  surface.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  expect(menu.querySelectorAll('.flower-model-menu-item')).toHaveLength(8);
  expect(menu.querySelector('.flower-model-menu-item')?.textContent).toContain('agent-q8');
  expect(menu.textContent).toContain('Q8_0');
  expect(menu.textContent).toContain('Aliases:');
  expect(menu.textContent).toContain('Local models');
  const input = menu.querySelector<HTMLInputElement>('input')!;
  expect(document.activeElement).toBe(input);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe([...menu.querySelectorAll('.flower-model-menu-item')].at(-1));
  input.value = 'model-29'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(menu.querySelectorAll('.flower-model-menu-item')).toHaveLength(1);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement?.textContent).toContain('model-29');
  input.value = 'removed'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(menu.querySelector<HTMLButtonElement>('.flower-model-menu-item')?.disabled).toBe(true);
  input.value = 'nonexistent'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(menu.textContent).toContain('No matching models');
  input.value = ''; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  [...menu.querySelectorAll('button')].find((button) => button.textContent?.includes('Show all selected models'))!.click();
  expect(menu.querySelectorAll('.flower-model-menu-item')).toHaveLength(32);
  [...menu.querySelectorAll('button')].find((button) => button.textContent?.includes('Manage models'))!.click();
  await waitFor(() => Boolean(surface.querySelector('.flower-settings-surface')));
  expect(document.querySelector('.flower-model-menu')).toBeNull();
  expect(snapshot.model_profile.current_model_id).toBe('local/agent-q8');
});


it('saves a missing selected model without inventing capacity or losing its identity', async () => {
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { schema_version: 1 as const, current_model_id: 'local/removed', providers: [{
    id: 'local', name: 'Local models', type: 'ollama' as const, base_url: 'http://localhost:11434/v1',
    model_selection: { selected_models: ['removed'] }, catalog_models: [], models: [{ model_name: 'removed', unavailable: true }],
  }] } };
  const saveModelProfile = vi.fn(async (draft: FlowerSettingsDraft) => {
    expect(draft.model_profile.current_model_id).toBe('local/removed');
    expect(draft.model_profile.providers[0].models[0].unavailable).toBe(true);
    expect(draft.model_profile.providers[0].model_selection?.selected_models).toEqual(['removed']);
    return snapshot;
  });
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, saveModelProfile, listThreads: async () => [] });
  await waitFor(() => Boolean(surface.querySelector('button[aria-label="Flower settings"]')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Flower settings"]')!.click();
  await waitFor(() => Boolean(surface.querySelector('button[aria-label="Edit provider"]')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Edit provider"]')!.click();
  await waitFor(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Save provider'));
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Save provider')!.click();
  await waitFor(() => saveModelProfile.mock.calls.length === 1);
  expect(surface.textContent).not.toContain('requires a context window');
});
