import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { applyFlowerModelDiscovery, defaultFlowerProviderModels, filterFlowerModels, resolveFlowerProviderModels, serializeFlowerProvider, setFlowerModelsEnabled } from '../../../../../../flower_ui/src/settings/modelSelection';
import * as catalog from '../../../../../../flower_ui/src/settings/providerCatalog';
import type { FlowerProviderDraft, FlowerProviderModel } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const model = (name: string): FlowerProviderModel => ({ model_name: name, context_window: 32000, input_modalities: ['text'] });

describe('model catalog preferences', () => {
  it('selects every native catalog model when creating or switching providers', () => {
    for (const type of ['openai', 'anthropic', 'google', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'xai', 'groq'] as const) {
      const selected = defaultFlowerProviderModels(type);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.map((entry) => entry.model_name)).toEqual(catalog.recommendedModelsForFlowerProviderType(type).map((entry) => entry.model_name));
    }
    expect(defaultFlowerProviderModels('openrouter')).toEqual([]);
    expect(defaultFlowerProviderModels('ollama')).toEqual([]);
    expect(defaultFlowerProviderModels('openai_compatible')).toEqual([]);
  });

  it('saves disabled models and overrides, retaining selection through reopening and future updates', () => {
    const models = defaultFlowerProviderModels('openai');
    const disabled = models[0].model_name;
    const changed = { ...models[1], context_window: 98765 };
    const draft: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [changed, ...models.slice(2), model('custom')] };
    const [store] = createStore(draft);
    const saved = serializeFlowerProvider(store);
    expect(saved.models).toEqual([]);
    expect(saved.model_selection?.disabled_models).toEqual([disabled]);
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: changed.model_name, context_window: 98765 }]);
    expect(saved.model_selection?.custom_models?.[0].model_name).toBe('custom');
    const reopened = resolveFlowerProviderModels(saved);
    expect(reopened.map((entry) => entry.model_name)).toEqual(draft.models.map((entry) => entry.model_name));
    expect(reopened.find((entry) => entry.model_name === changed.model_name)?.context_window).toBe(98765);
    const source = vi.spyOn(catalog, 'recommendedModelsForFlowerProviderType').mockReturnValue([...models, model('new-release')] as ReturnType<typeof catalog.recommendedModelsForFlowerProviderType>);
    try {
      const updated = resolveFlowerProviderModels(saved);
      expect(updated.some((entry) => entry.model_name === 'new-release')).toBe(true);
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
    expect(serializeFlowerProvider(router).model_selection).toBeUndefined();
    const first = applyFlowerModelDiscovery({ id: 'local', type: 'ollama', models: [] }, [model('installed'), model('disabled')]);
    expect(first.models).toHaveLength(2);
    const saved = serializeFlowerProvider({ ...first, models: first.models.slice(0, 1) });
    expect(saved.models).toEqual([]);
    const refreshed = applyFlowerModelDiscovery(saved, [model('disabled'), model('newly-installed')]);
    expect(refreshed.models.map((entry) => entry.model_name)).toEqual(['newly-installed']);
    expect(refreshed.models.some((entry) => entry.model_name === 'installed')).toBe(false);
  });
});


describe('model parameter preservation', () => {
  it('retains edited parameters when disabling, reopening, and selecting again', () => {
    const models = defaultFlowerProviderModels('deepseek');
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
    const models = defaultFlowerProviderModels('openai');
    const custom = { ...models[0], context_window: 87654 };
    const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [], model_selection: { custom_models: [custom] } };
    const resolved = resolveFlowerProviderModels(provider);
    expect(resolved.filter((entry) => entry.model_name === custom.model_name)).toEqual([custom]);
    const saved = serializeFlowerProvider({ ...provider, models: resolved });
    expect(saved.model_selection?.custom_models).toEqual([]);
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: custom.model_name, context_window: 87654 }]);
  });
});


it('bounds inherited output capacity by a smaller user context override', () => {
  const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', models: [], model_selection: { model_overrides: [{ model_name: 'gpt-5.5', context_window: 32000 }] } };
  const models = resolveFlowerProviderModels(provider);
  const model = models.find((entry) => entry.model_name === 'gpt-5.5')!;
  expect(model.context_window).toBe(32000);
  expect(model.max_output_tokens).toBe(32000);
  const saved = serializeFlowerProvider({ ...provider, models });
  expect(saved.model_selection?.model_overrides).toEqual([{ model_name: 'gpt-5.5', context_window: 32000 }]);
});
