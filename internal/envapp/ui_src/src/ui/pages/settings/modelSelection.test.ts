import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { cloneFlowerModel, applyFlowerModelDiscovery, defaultFlowerProviderModels, filterFlowerModels, flowerProviderModelChoices, resolveFlowerProviderModels, serializeFlowerProvider, setFlowerModelsEnabled } from '../../../../../../flower_ui/src/settings/modelSelection';
import * as catalog from '../../../../../../flower_ui/src/settings/providerCatalog';
import type { FlowerProviderDraft, FlowerProviderModel } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const model = (name: string): FlowerProviderModel => ({ model_name: name, context_window: 32000, input_modalities: ['text'] });

describe('model catalog preferences', () => {
  it('starts new providers with no selected models', () => {
    for (const type of ['openai', 'anthropic', 'google', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'xai', 'groq'] as const) {
      const selected = defaultFlowerProviderModels(type);
      expect(selected).toEqual([]);
    }
    expect(defaultFlowerProviderModels('openrouter')).toEqual([]);
    expect(defaultFlowerProviderModels('ollama')).toEqual([]);
    expect(defaultFlowerProviderModels('openai_compatible')).toEqual([]);
  });

  it('saves disabled models and overrides, retaining selection through reopening and future updates', () => {
    const models = catalog.recommendedModelsForFlowerProviderType('openai').map(cloneFlowerModel);
    const disabled = models[0].model_name;
    const changed = { ...models[1], context_window: 98765 };
    const draft: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [changed, ...models.slice(2), model('custom')] };
    const [store] = createStore(draft);
    const saved = serializeFlowerProvider(store);
    expect(saved.models).toEqual([]);
    expect(saved.model_selection?.selected_models).toEqual(draft.models.map((entry) => entry.model_name));
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: changed.model_name, context_window: 98765 }]);
    expect(saved.model_selection?.custom_models?.[0].model_name).toBe('custom');
    const reopened = resolveFlowerProviderModels(saved);
    expect(reopened.map((entry) => entry.model_name)).toEqual(draft.models.map((entry) => entry.model_name));
    expect(reopened.find((entry) => entry.model_name === changed.model_name)?.context_window).toBe(98765);
    const source = vi.spyOn(catalog, 'recommendedModelsForFlowerProviderType').mockReturnValue([...models, model('new-release')] as ReturnType<typeof catalog.recommendedModelsForFlowerProviderType>);
    try {
      const updated = resolveFlowerProviderModels(saved);
      expect(updated.some((entry) => entry.model_name === 'new-release')).toBe(false);
      expect(updated.some((entry) => entry.model_name === disabled)).toBe(false);
    } finally { source.mockRestore(); }
  });

  it('searches display and wire names without changing selected models', () => {
    const selected = [model('one'), { ...model('vendor%2Ftwo'), wire_model_name: 'vendor/two', display_name: 'Friendly model' }];
    expect(filterFlowerModels(selected, 'friendly')).toEqual([selected[1]]);
    expect(filterFlowerModels(selected, 'vendor/two')).toEqual([selected[1]]);
    expect(filterFlowerModels(selected, '')).toHaveLength(2);
    expect(selected).toHaveLength(2);
  });

  it('keeps OpenRouter explicit and Ollama limited to the current installed inventory', () => {
    const router = applyFlowerModelDiscovery({ id: 'router', type: 'openrouter', models: [] }, [model('remote')]);
    expect(router.models).toEqual([]);
    expect(serializeFlowerProvider(router).model_selection?.selected_models).toEqual([]);
    const first = applyFlowerModelDiscovery({ id: 'local', type: 'ollama', models: [] }, [model('installed'), model('disabled')]);
    expect(first.models).toHaveLength(0);
    const chosen = setFlowerModelsEnabled(first, [model('installed')], true);
    const saved = serializeFlowerProvider({ ...chosen });
    expect(saved.models).toEqual([]);
    const refreshed = applyFlowerModelDiscovery(saved, [model('disabled'), model('newly-installed')]);
    expect(refreshed.models.map((entry) => entry.model_name)).toEqual(['installed']);
    expect(refreshed.models[0].unavailable).toBe(true);
    expect(refreshed.models.some((entry) => entry.model_name === 'newly-installed')).toBe(false);

  });
});


describe('model parameter preservation', () => {
  it('keeps custom model definitions when clearing selection and reopening', () => {
    const custom = { ...model('custom-vision'), input_modalities: ['text', 'image'] };
    const draft: FlowerProviderDraft = { id: 'brand', type: 'deepseek', models: [...defaultFlowerProviderModels('deepseek'), custom] };
    const cleared = setFlowerModelsEnabled(draft, draft.models, false);
    const saved = serializeFlowerProvider(cleared);
    expect(saved.model_selection?.custom_models).toEqual([custom]);
    expect(saved.model_selection?.selected_models).toEqual([]);
    const reopened = { ...saved, models: resolveFlowerProviderModels(saved) };
    expect(reopened.models).toEqual([]);
    const choices = flowerProviderModelChoices(reopened);
    expect(choices).toContainEqual(custom);
    const enabled = setFlowerModelsEnabled(reopened, choices, true);
    const resaved = serializeFlowerProvider(enabled);
    expect(resaved.model_selection?.selected_models).toContain(custom.model_name);
    expect(resolveFlowerProviderModels(resaved)).toContainEqual(custom);
  });

  it('retains edited parameters when disabling, reopening, and selecting again', () => {
    const models = catalog.recommendedModelsForFlowerProviderType('deepseek').map(cloneFlowerModel);
    const edited = { ...models[0], context_window: 81920, max_output_tokens: 4096, input_modalities: ['text', 'image'] };
    const draft: FlowerProviderDraft = { id: 'deepseek', type: 'deepseek', models: [edited, ...models.slice(1)] };
    const disabled = setFlowerModelsEnabled(draft, [edited], false);
    const saved = serializeFlowerProvider(disabled);
    const reopened = { ...saved, models: resolveFlowerProviderModels(saved) };
    const enabled = setFlowerModelsEnabled(reopened, [models[0]], true);
    expect(enabled.models.find((entry) => entry.model_name === edited.model_name)).toEqual(edited);
    const cleared = setFlowerModelsEnabled(enabled, enabled.models, false);
    expect(setFlowerModelsEnabled(cleared, models, true).models.find((entry) => entry.model_name === edited.model_name)).toEqual(edited);
  });

  it('retains a custom model override when the upstream catalog gains the same name', () => {
    const models = catalog.recommendedModelsForFlowerProviderType('openai').map(cloneFlowerModel);
    const custom = { ...models[0], context_window: 87654, max_output_tokens: 4096 };
    const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [], model_selection: { selected_models: [custom.model_name], custom_models: [custom] } };
    const resolved = resolveFlowerProviderModels(provider);
    expect(resolved.filter((entry) => entry.model_name === custom.model_name)).toEqual([custom]);
    const saved = serializeFlowerProvider({ ...provider, models: resolved });
    expect(saved.model_selection?.custom_models).toEqual([]);
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: custom.model_name, context_window: 87654, max_output_tokens: 4096 }]);
    const disabled = { ...provider, model_selection: { custom_models: [custom], selected_models: [] } };
    const choice = flowerProviderModelChoices(disabled).find((entry) => entry.model_name === custom.model_name)!;
    expect(choice.context_window).toBe(custom.context_window);
    const enabled = setFlowerModelsEnabled(disabled, [choice], true);
    expect(resolveFlowerProviderModels(serializeFlowerProvider(enabled))).toContainEqual(custom);
  });
});


it('bounds inherited output capacity by a smaller user context override', () => {
  const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [], model_selection: { selected_models: ['gpt-5.5'], model_overrides: [{ model_name: 'gpt-5.5', context_window: 32000 }] } };
  const models = resolveFlowerProviderModels(provider);
  const model = models.find((entry) => entry.model_name === 'gpt-5.5')!;
  expect(model.context_window).toBe(32000);
  expect(model.max_output_tokens).toBe(32000);
  const saved = serializeFlowerProvider({ ...provider, models });
  expect(saved.model_selection?.model_overrides).toEqual([{ model_name: 'gpt-5.5', context_window: 32000 }]);
});


it('refreshes OpenRouter metadata without enabling additions or discarding missing selections', () => {
  const initial = applyFlowerModelDiscovery({ id: 'router', type: 'openrouter', models: [] }, [model('one'), model('two')]);
  const selected = setFlowerModelsEnabled(initial, initial.catalog_models!, true);
  const saved = serializeFlowerProvider({ ...selected, models: selected.models.map((m) => m.model_name === 'one' ? { ...m, max_output_tokens: 2048 } : m) });
  const refreshed = applyFlowerModelDiscovery(saved, [{ ...model('one'), context_window: 64000 }, model('new')]);
  expect(refreshed.models.map((m) => m.model_name)).toEqual(['one', 'two']);
  expect(refreshed.models[0]).toEqual(expect.objectContaining({ context_window: 64000, max_output_tokens: 2048 }));
  expect(refreshed.models[1].unavailable).toBe(true);
  const persisted = serializeFlowerProvider(refreshed);
  expect(persisted.model_selection?.selected_models).toEqual(['one', 'two']);
  const recovered = applyFlowerModelDiscovery(persisted, [model('one'), model('two'), model('new')]);
  expect(recovered.models.some((m) => m.unavailable)).toBe(false);
  const cleared = serializeFlowerProvider(setFlowerModelsEnabled(recovered, recovered.models, false));
  expect(applyFlowerModelDiscovery(cleared, [model('new')]).models).toEqual([]);
});


it('keeps an offline legacy selection pending until the user reviews it', () => {
  const legacy: FlowerProviderDraft = { id: 'local', type: 'ollama', models: [], model_selection: { disabled_models: ['hidden'], model_overrides: [{ model_name: 'agent', context_window: 8192 }] } };
  const refreshed = applyFlowerModelDiscovery(legacy, [model('agent'), model('hidden')]);
  expect(refreshed.models).toEqual([]);
  expect(serializeFlowerProvider(refreshed).model_selection).toEqual(legacy.model_selection);
  const reviewed = setFlowerModelsEnabled(refreshed, [model('agent')], true);
  expect(serializeFlowerProvider(reviewed).model_selection).toEqual(expect.objectContaining({ selected_models: ['agent'] }));
  expect(reviewed.models[0].context_window).toBe(8192);
});

it('preserves a legacy local alias and never admits it from stale override metadata', () => {
  const provider: FlowerProviderDraft = { id: 'router', type: 'openrouter', models: [], model_selection: {
    selected_models: ['my-agent'], model_overrides: [{ model_name: 'my-agent', wire_model_name: 'vendor/agent', max_output_tokens: 2048 }],
  } };
  const inventory = [{ ...model('vendor%2Fagent'), wire_model_name: 'vendor/agent', display_name: 'Agent' }];
  const available = applyFlowerModelDiscovery(provider, inventory);
  expect(available.models[0]).toEqual(expect.objectContaining({ model_name: 'my-agent', wire_model_name: 'vendor/agent', max_output_tokens: 2048, context_window: 32000 }));
  const removed = applyFlowerModelDiscovery(available, []);
  expect(removed.models[0].unavailable).toBe(true);
  const restored = applyFlowerModelDiscovery(serializeFlowerProvider(removed), inventory);
  expect(restored.models[0].unavailable).not.toBe(true);
  expect(restored.models[0].model_name).toBe('my-agent');
});


it('keeps explicitly entered OpenRouter models distinct from discovered inventory', () => {
  const manual = { ...model('private-agent'), wire_model_name: 'vendor/private-agent' };
  const saved = serializeFlowerProvider({ id: 'router', type: 'openrouter', models: [manual], catalog_models: [] });
  expect(saved.model_selection?.custom_models).toEqual([manual]);
  expect(resolveFlowerProviderModels(saved, [])).toEqual([manual]);
  const cleared = serializeFlowerProvider(setFlowerModelsEnabled({ ...saved, models: [manual] }, [manual], false));
  expect(cleared.model_selection?.custom_models).toEqual([manual]);
  expect(resolveFlowerProviderModels(cleared, [])).toEqual([]);
});
