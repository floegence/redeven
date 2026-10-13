import { cloneFlowerModel, applyModelOverride, projectFlowerProviderModels } from '../providerModelProjection';
export { cloneFlowerModel } from '../providerModelProjection';
import type { FlowerProvider, FlowerProviderDraft, FlowerProviderModel, FlowerProviderType } from '../contracts/flowerSurfaceContracts';
import { recommendedModelsForFlowerProviderType } from './providerCatalog';

export function flowerProviderUsesCatalog(type: FlowerProviderType): boolean {
  return type !== 'openrouter' && type !== 'ollama' && type !== 'openai_compatible';
}

export function defaultFlowerProviderModels(_type: FlowerProviderType): FlowerProviderModel[] {
  return [];
}

export function flowerProviderModelChoices(provider: FlowerProviderDraft): FlowerProviderModel[] {
  const catalog = provider.catalog_models ?? (provider.auth_method === 'chatgpt' ? [] : recommendedModelsForFlowerProviderType(provider.type));
  const choices = new Map(catalog.map((model) => [model.model_name, model]));
  for (const model of [...provider.model_selection?.model_overrides ?? [], ...provider.model_selection?.custom_models ?? [], ...provider.models]) {
    const entry = catalog.find(listed => (listed.wire_model_name || listed.model_name) === (model.wire_model_name || model.model_name));
    choices.set(model.model_name, applyModelOverride(entry ?? { model_name: model.model_name, status: model.status, unavailable: model.unavailable ?? (provider.catalog_models ? true : undefined) }, model));
  }
  return [...choices.values()].map((model) => ({ ...model, web_search: provider.models.find((selected) => selected.model_name === model.model_name)?.web_search ?? model.web_search }));
}

export function resolveFlowerProviderModels(provider: FlowerProvider, discovered?: readonly FlowerProviderModel[]): FlowerProviderModel[] {
  if (!provider.model_selection && discovered === undefined) return projectFlowerProviderModels(provider);
  const catalog = discovered ?? (provider.auth_method !== 'chatgpt' && flowerProviderUsesCatalog(provider.type) ? recommendedModelsForFlowerProviderType(provider.type) : undefined);
  return projectFlowerProviderModels(provider, catalog, discovered !== undefined).map(model => ({ ...model,
    web_search: model.web_search ?? provider.models.find(selected => selected.model_name === model.model_name && (selected.wire_model_name || selected.model_name) === (model.wire_model_name || model.model_name))?.web_search,
  }));
}

function equalValue(a: unknown, b: unknown): boolean {
  const encode = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
    : item);
  return encode(a) === encode(b);
}

const overrideKeys = ['supports_tools', 'wire_model_name', 'context_window', 'max_output_tokens', 'effective_context_window_percent', 'input_modalities', 'reasoning_capability', 'default_reasoning_selection'] as const;

function serializeFlowerModel(model: FlowerProviderModel): FlowerProviderModel {
  const { model_digest: _digest, quantization: _quantization, status: _status, unavailable: _unavailable, web_search: _search, ...intent } = cloneFlowerModel(model);
  return intent;
}

// Serialize only intent. Filtering and collapsing the UI never enter this path.
export function serializeFlowerProvider(provider: FlowerProviderDraft): FlowerProvider {
  const out: FlowerProvider = {
    enabled: provider.enabled,
    id: provider.id, name: provider.name, type: provider.type, base_url: provider.base_url,
    auth_method: provider.auth_method, account_id: provider.account_id,
    web_search: provider.web_search, models: provider.models.map(serializeFlowerModel),
  };
  if (provider.type === 'openai_compatible') return out;
  // Offline legacy preferences require an explicit selection action before saving.
  if (provider.model_selection && provider.model_selection.selected_models == null) return { ...out, models: [], model_selection: provider.model_selection };
  const catalog = provider.catalog_models ?? (provider.auth_method !== 'chatgpt' && flowerProviderUsesCatalog(provider.type) ? recommendedModelsForFlowerProviderType(provider.type) : []);
  const catalogByName = new Map(catalog.map((model) => [model.model_name, model]));
  const selected = provider.models.map((model) => model.model_name);
  const customModels = new Map((provider.model_selection?.custom_models ?? []).map((model) => [model.model_name, serializeFlowerModel(model)]));
  const overrides = new Map((provider.model_selection?.model_overrides ?? []).map((model) => [model.model_name, serializeFlowerModel(model)]));
  for (const model of provider.models) {
    const preset = catalogByName.get(model.model_name) ?? (overrides.has(model.model_name) && model.wire_model_name
      ? catalog.find((entry) => (entry.wire_model_name || entry.model_name) === model.wire_model_name) : undefined);
    if (!preset) {
      if (provider.type !== 'ollama' && provider.auth_method !== 'chatgpt' && !model.unavailable) customModels.set(model.model_name, serializeFlowerModel(model));
      else if (!model.unavailable) overrides.set(model.model_name, serializeFlowerModel(model));
      continue;
    }
    customModels.delete(model.model_name);
    const changes = Object.fromEntries(overrideKeys.flatMap((key) => {
      const value = model[key];
      if (key === 'wire_model_name' && value && model.model_name !== preset.model_name) return [[key, value]];
      if (key === 'max_output_tokens' && model.context_window && value === model.context_window && (preset.max_output_tokens ?? 0) > model.context_window) return [];
      if (value == null || equalValue(value, preset[key]) || (key === 'effective_context_window_percent' && value === 95)) return [];
      return [[key, value]];
    }));
    overrides.delete(model.model_name);
    if (Object.keys(changes).length > 0) overrides.set(model.model_name, { model_name: model.model_name, ...changes });
  }
  return { ...out, models: [], model_selection: {
    selected_models: selected, custom_models: [...customModels.values()], model_overrides: [...overrides.values()],
  } };
}

// Capture edits before disabling a model, so re-enabling restores its parameters.
export function setFlowerModelsEnabled(provider: FlowerProviderDraft, models: readonly FlowerProviderModel[], enabled: boolean): FlowerProviderDraft {
  const preferences = serializeFlowerProvider(provider).model_selection;
  const overrides = new Map((preferences?.model_overrides ?? []).map((model) => [model.model_name, model]));
  const selected = new Map(provider.models.map((model) => [model.model_name, model]));
  for (const model of models) {
    if (enabled) {
      if (!selected.has(model.model_name) && !model.unavailable) selected.set(model.model_name, cloneFlowerModel(applyModelOverride(model, overrides.get(model.model_name))));
    } else selected.delete(model.model_name);
  }
  return { ...provider, model_selection: preferences ? { ...preferences, disabled_models: undefined, selected_models: [...selected.keys()] } : undefined, models: [...selected.values()] };
}

export function filterFlowerModels<T extends FlowerProviderModel>(models: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? models.filter((model) => [model.model_name, model.wire_model_name, model.display_name].some((value) => value?.toLocaleLowerCase().includes(needle))) : models;
}

export function applyFlowerModelDiscovery(provider: FlowerProviderDraft, catalog: readonly FlowerProviderModel[]): FlowerProviderDraft {
  const persisted = !provider.catalog_models && provider.model_selection ? provider : serializeFlowerProvider(provider);
  return { ...provider, model_selection: persisted.model_selection, catalog_models: catalog,
    models: resolveFlowerProviderModels(persisted, catalog), catalog_error: undefined };
}
