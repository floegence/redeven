import { describe, expect, it } from 'vitest';
import { createStore } from 'solid-js/store';
import { cloneFlowerModel, applyFlowerModelDiscovery, defaultFlowerProviderModels, filterFlowerModels, flowerProviderModelChoices, resolveFlowerProviderModels, serializeFlowerProvider, setFlowerModelsEnabled } from '../../../../../../flower_ui/src/settings/modelSelection';
import { backendModelsForProviderType, providerDefaultsFixture } from '../../../../../../flower_ui/testing/providerCatalogFixture';
import type { FlowerProviderDraft, FlowerProviderModel } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyModelOverride } from '../../../../../../flower_ui/src/providerModelProjection';

const model = (name: string): FlowerProviderModel => ({ model_name: name, context_window: 32000, input_modalities: ['text'] });

describe('reviewed defaults across every provider', () => {
  it('retains received metadata for a missing selection and leaves unknown limits unset', () => {
    const received = { model_name: 'server-only-model', context_window: 543210, max_output_tokens: 12345, input_modalities: ['text', 'image'] };
    const provider: FlowerProviderDraft = { id: 'account', type: 'openai', auth_method: 'chatgpt', model_defaults: [], models: [received], model_selection: { selected_models: [received.model_name, 'unknown-model'] } };
    const result = resolveFlowerProviderModels(provider, []);
    expect(result).toEqual([{ ...received, unavailable: true }, { model_name: 'unknown-model', unavailable: true }]);
    expect(result[1].context_window).toBeUndefined();
    expect(result[1].max_output_tokens).toBeUndefined();
  });
  for (const type of ['openai', 'anthropic', 'google', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'xai', 'groq'] as const) {
    it(`preserves every ${type} model through sparse overrides and save/reopen`, () => {
      const models = backendModelsForProviderType(type).map(cloneFlowerModel);
      expect(models.length).toBeGreaterThan(0);
      const provider: FlowerProviderDraft = { id: type, type, model_defaults: models, models: [], model_selection: {
        selected_models: models.map(m => m.model_name),
        // Go serializes zero-valued nested structs even in sparse overrides.
        model_overrides: models.map(m => JSON.parse(JSON.stringify({ model_name: m.model_name, context_window: 0, max_output_tokens: 0, input_modalities: null,
          reasoning_capability: { kind: '', wire_shape: '', source_urls: null, source_checked_at: '', fixture: '' }, default_reasoning_selection: {} }))),
      } };
      const resolved = resolveFlowerProviderModels(provider, models);
      expect(resolved).toEqual(models);
      expect(resolveFlowerProviderModels(serializeFlowerProvider({ ...provider, catalog_models: models, models: resolved }), models)).toEqual(models);
    });
  }
  it('retains OpenAI metadata when the account inventory is absent or empty without enabling models', () => {
    const models = backendModelsForProviderType('openai').map(cloneFlowerModel);
    const provider: FlowerProviderDraft = { id: 'account', type: 'openai', model_defaults: models, auth_method: 'chatgpt', account_id: 'account', models: [],
      model_selection: { selected_models: models.map(m => m.model_name) } };
    for (const inventory of [undefined, []]) {
      const resolved = resolveFlowerProviderModels(provider, inventory);
      expect(resolved).toEqual(models.map(m => ({ ...m, unavailable: true })));
      expect(flowerProviderModelChoices({ ...provider, catalog_models: inventory, models: resolved }).every(m => m.unavailable)).toBe(true);
    }
    const confirmed = applyFlowerModelDiscovery(provider, models.slice(0, 7));
    expect(confirmed.models.slice(0, 7)).toEqual(models.slice(0, 7));
    expect(confirmed.models.slice(7).every(m => m.unavailable)).toBe(true);
  });
  it('cannot override inventory status or persist stale unavailable state after a model returns', () => {
    expect(applyModelOverride({ ...model('agent'), status: 'needs_configuration' }, { ...model('agent'), status: 'beta' }).status).toBe('needs_configuration');
    const saved = { id: 'account', type: 'openai' as const, auth_method: 'chatgpt' as const, models: [], model_selection: { selected_models: ['gpt-6.1-sol'] } };
    const unavailable = applyFlowerModelDiscovery(saved, []);
    const recovered = applyFlowerModelDiscovery(unavailable, backendModelsForProviderType('openai'));
    expect(recovered.models[0].unavailable).not.toBe(true);
  });
});

describe('model catalog preferences', () => {
  it('persists Responses continuation only for an enabled OpenAI API key connection', () => {
    const enabled = serializeFlowerProvider({ id: 'openai', type: 'openai', auth_method: 'api_key', responses_continuation: true, models: [] });
    expect(enabled.responses_continuation).toBe(true);

    for (const provider of [
      { id: 'openai', type: 'openai' as const, auth_method: 'api_key' as const, models: [] },
      { id: 'openai', type: 'openai' as const, auth_method: 'api_key' as const, responses_continuation: false, models: [] },
      { id: 'openai', type: 'openai' as const, auth_method: 'chatgpt' as const, responses_continuation: true, models: [] },
      { id: 'deepseek', type: 'deepseek' as const, responses_continuation: true, models: [] },
    ]) {
      expect(serializeFlowerProvider(provider).responses_continuation).toBeUndefined();
    }
  });

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
    const models = backendModelsForProviderType('openai').map(cloneFlowerModel);
    const disabled = models[0].model_name;
    const changed = { ...models[1], context_window: 98765 };
    const draft: FlowerProviderDraft = { id: 'brand', type: 'openai', model_defaults: backendModelsForProviderType('openai'), models: [changed, ...models.slice(2), model('custom')] };
    const [store] = createStore(draft);
    const saved = serializeFlowerProvider(store);
    expect(saved.models).toEqual([]);
    expect(saved.model_selection?.selected_models).toEqual(draft.models.map((entry) => entry.model_name));
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: changed.model_name, context_window: 98765 }]);
    expect(saved.model_selection?.custom_models?.[0].model_name).toBe('custom');
    const reopened = resolveFlowerProviderModels({ ...saved, model_defaults: providerDefaultsFixture[saved.type] });
    expect(reopened.map((entry) => entry.model_name)).toEqual(draft.models.map((entry) => entry.model_name));
    expect(reopened.find((entry) => entry.model_name === changed.model_name)?.context_window).toBe(98765);
    const updated = resolveFlowerProviderModels({ ...saved, model_defaults: [...models, model('new-release')] });
    expect(updated.some((entry) => entry.model_name === 'new-release')).toBe(false);
    expect(updated.some((entry) => entry.model_name === disabled)).toBe(false);
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
    const reopened = { ...saved, models: resolveFlowerProviderModels({ ...saved, model_defaults: providerDefaultsFixture[saved.type] }) };
    expect(reopened.models).toEqual([]);
    const choices = flowerProviderModelChoices(reopened);
    expect(choices).toContainEqual(custom);
    const enabled = setFlowerModelsEnabled(reopened, choices, true);
    const resaved = serializeFlowerProvider(enabled);
    expect(resaved.model_selection?.selected_models).toContain(custom.model_name);
    expect(resolveFlowerProviderModels(resaved)).toContainEqual(custom);
  });

  it('retains edited parameters when disabling, reopening, and selecting again', () => {
    const models = backendModelsForProviderType('deepseek').map(cloneFlowerModel);
    const edited = { ...models[0], context_window: 81920, max_output_tokens: 4096, input_modalities: ['text', 'image'] };
    const draft: FlowerProviderDraft = { id: 'deepseek', type: 'deepseek', model_defaults: backendModelsForProviderType('deepseek'), models: [edited, ...models.slice(1)] };
    const disabled = setFlowerModelsEnabled(draft, [edited], false);
    const saved = serializeFlowerProvider(disabled);
    const reopened = { ...saved, models: resolveFlowerProviderModels({ ...saved, model_defaults: providerDefaultsFixture[saved.type] }) };
    const enabled = setFlowerModelsEnabled(reopened, [models[0]], true);
    expect(enabled.models.find((entry) => entry.model_name === edited.model_name)).toEqual(edited);
    const cleared = setFlowerModelsEnabled(enabled, enabled.models, false);
    expect(setFlowerModelsEnabled(cleared, models, true).models.find((entry) => entry.model_name === edited.model_name)).toEqual(edited);
  });

  it('retains a custom model override when the upstream catalog gains the same name', () => {
    const models = backendModelsForProviderType('openai').map(cloneFlowerModel);
    const custom = { ...models[0], context_window: 87654, max_output_tokens: 4096 };
    const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', model_defaults: backendModelsForProviderType('openai'), models: [], model_selection: { selected_models: [custom.model_name], custom_models: [custom] } };
    const resolved = resolveFlowerProviderModels(provider);
    expect(resolved.filter((entry) => entry.model_name === custom.model_name)).toEqual([custom]);
    const saved = serializeFlowerProvider({ ...provider, models: resolved });
    expect(saved.model_selection?.custom_models).toEqual([]);
    expect(saved.model_selection?.model_overrides).toEqual([{ model_name: custom.model_name, context_window: 87654, max_output_tokens: 4096 }]);
    const disabled = { ...provider, model_selection: { custom_models: [custom], selected_models: [] } };
    const choice = flowerProviderModelChoices(disabled).find((entry) => entry.model_name === custom.model_name)!;
    expect(choice.context_window).toBe(custom.context_window);
    const enabled = setFlowerModelsEnabled(disabled, [choice], true);
    expect(resolveFlowerProviderModels({ ...serializeFlowerProvider(enabled), model_defaults: models })).toContainEqual(custom);
  });
});


it('bounds inherited output capacity by a smaller user context override', () => {
  const provider: FlowerProviderDraft = { id: 'brand', type: 'openai', model_defaults: backendModelsForProviderType('openai'), models: [], model_selection: { selected_models: ['gpt-5.5'], model_overrides: [{ model_name: 'gpt-5.5', context_window: 32000 }] } };
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
  expect(resolveFlowerProviderModels(saved, [])).toEqual([{ ...manual, unavailable: true }]);
  const cleared = serializeFlowerProvider(setFlowerModelsEnabled({ ...saved, models: [manual] }, [manual], false));
  expect(cleared.model_selection?.custom_models).toEqual([manual]);
  expect(resolveFlowerProviderModels(cleared, [])).toEqual([]);
});

it('reopens configured unknown models without absorbing capabilities into the catalog baseline', () => {
  const raw: FlowerProviderModel = { model_name: 'wire', status: 'needs_configuration' };
  const configured: FlowerProviderModel = { model_name: 'alias', wire_model_name: 'wire', context_window: 8192, max_output_tokens: 1024, supports_tools: true };
  const saved = { id: 'brand', type: 'deepseek' as const, models: [], model_selection: { selected_models: ['alias'], model_overrides: [configured] } };
  const opened = applyFlowerModelDiscovery(saved, [raw]);
  const choices = flowerProviderModelChoices(opened);
  expect(choices.find(model => model.model_name === 'wire')?.status).toBe('needs_configuration');
  expect(choices.find(model => model.model_name === 'alias')).toEqual(expect.objectContaining({ ...configured, status: undefined }));
  expect(serializeFlowerProvider(opened).model_selection?.model_overrides).toEqual([configured]);
  expect(opened.catalog_models).toEqual([raw]);
});

it('uses actual target capabilities when a saved wire override points to an unknown model', () => {
  const inventory: FlowerProviderModel[] = [{ model_name: 'known', context_window: 32768, max_output_tokens: 4096, supports_tools: true }, { model_name: 'target', status: 'needs_configuration' }];
  const provider = { id: 'brand', type: 'deepseek' as const, models: [], model_selection: { selected_models: ['known'], model_overrides: [{ model_name: 'known', wire_model_name: 'target' }] } };
  expect(resolveFlowerProviderModels(provider, inventory)).toEqual([expect.objectContaining({ model_name: 'known', wire_model_name: 'target', status: 'needs_configuration' })]);
});

it('persists explicit search choices through refresh and clears them on reset', () => {
  const catalog = [{ ...model('agent'), max_output_tokens: 4096, web_search: { status: 'available' as const, reason: 'catalog_supported', recommended_enabled: true, model_enabled: true } }];
  for (const enabled of [false, true]) {
    const provider: FlowerProviderDraft = { id: 'proxy', type: 'openai', catalog_models: catalog, models: [{ ...catalog[0], web_search_enabled: enabled }], model_selection: { selected_models: ['agent'] } };
    const saved = serializeFlowerProvider(provider);
    expect(saved.model_selection!.model_overrides![0].web_search_enabled).toBe(enabled);
    const refreshed = applyFlowerModelDiscovery({ ...saved, models: resolveFlowerProviderModels(saved, catalog), catalog_models: catalog }, catalog);
    expect(refreshed.models[0].web_search_enabled).toBe(enabled);
    const reset = serializeFlowerProvider({ ...refreshed, models: [{ ...refreshed.models[0], web_search_enabled: undefined }] });
    expect(reset.model_selection!.model_overrides).toEqual([]);
    expect(resolveFlowerProviderModels({ ...reset, catalog_models: catalog }, catalog)[0].web_search_enabled).toBeUndefined();
  }
});

it('preserves explicit DeepSeek fetch independently of disabled search',()=>{
 const saved=serializeFlowerProvider({id:'ds',type:'deepseek',web_search:{enabled:false,source:'native'},web_fetch:{source:'deepseek'},models:[]});
 expect(saved.web_fetch).toEqual({source:'deepseek'});expect(saved.web_search?.enabled).toBe(false);
 expect(serializeFlowerProvider({...saved,web_fetch:undefined}).web_fetch).toBeUndefined();
});
