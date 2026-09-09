import type { FlowerProvider, FlowerProviderDraft, FlowerProviderModel, FlowerProviderType, FlowerModelCatalogDiscovery } from '../contracts/flowerSurfaceContracts';
import { recommendedModelsForFlowerProviderType } from './providerCatalog';

export function cloneFlowerModel(model: FlowerProviderModel): FlowerProviderModel {
  const { model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection } = model;
  return JSON.parse(JSON.stringify({ model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection }));
}

export function flowerProviderUsesCatalog(type: FlowerProviderType): boolean {
  return type !== 'openrouter' && type !== 'ollama' && type !== 'openai_compatible';
}

export function defaultFlowerProviderModels(type: FlowerProviderType): FlowerProviderModel[] {
  return flowerProviderUsesCatalog(type) ? recommendedModelsForFlowerProviderType(type).map((model) => cloneFlowerModel(model)) : [];
}

function applyModelOverride(model: FlowerProviderModel, override?: FlowerProviderModel): FlowerProviderModel {
  const merged = { ...model, ...override };
  if (!override?.max_output_tokens && merged.context_window && (merged.max_output_tokens ?? 0) > merged.context_window) merged.max_output_tokens = merged.context_window;
  return merged;
}

export function resolveFlowerProviderModels(provider: FlowerProvider, discovered: readonly FlowerProviderModel[] = []): FlowerProviderModel[] {
  if (!provider.model_selection) return (provider.models ?? []).map((model) => cloneFlowerModel(model));
  const selection = provider.model_selection;
  const disabled = new Set(selection.disabled_models ?? []);
  const overrides = new Map((selection.model_overrides ?? []).map((model) => [model.model_name, model]));
  const catalog = provider.type === 'ollama' ? discovered : recommendedModelsForFlowerProviderType(provider.type);
  const models = new Map(catalog.map((model) => [model.model_name, applyModelOverride(model, overrides.get(model.model_name))]));
  for (const custom of selection.custom_models ?? []) models.set(custom.model_name, applyModelOverride(models.get(custom.model_name) ?? { model_name: custom.model_name }, custom));
  return [...models.values()].filter((model) => !disabled.has(model.model_name)).map(cloneFlowerModel);
}

function equalValue(a: unknown, b: unknown): boolean {
  const encode = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
    : item);
  return encode(a) === encode(b);
}

const overrideKeys = ['wire_model_name', 'context_window', 'max_output_tokens', 'effective_context_window_percent', 'input_modalities', 'reasoning_capability', 'default_reasoning_selection'] as const;

// Serialize only intent. Filtering and collapsing the UI never enter this path.
export function serializeFlowerProvider(provider: FlowerProviderDraft): FlowerProvider {
  const out: FlowerProvider = {
    id: provider.id, name: provider.name, type: provider.type, base_url: provider.base_url,
    web_search: provider.web_search, models: provider.models.map(cloneFlowerModel),
  };
  if (!flowerProviderUsesCatalog(provider.type) && provider.type !== 'ollama') return out;
  const catalog = provider.type === 'ollama' ? (provider.catalog_models ?? []) : recommendedModelsForFlowerProviderType(provider.type);
  const catalogByName = new Map(catalog.map((model) => [model.model_name, model]));
  const selected = new Set(provider.models.map((model) => model.model_name));
  const disabled = new Set((provider.model_selection?.disabled_models ?? []).filter((name) => !catalogByName.has(name)));
  for (const model of catalog) if (!selected.has(model.model_name)) disabled.add(model.model_name);
  const customModels: FlowerProviderModel[] = [];
  const overrides = new Map((provider.model_selection?.model_overrides ?? []).filter((model) => !selected.has(model.model_name)).map((model) => [model.model_name, model]));
  for (const model of provider.models) {
    const preset = catalogByName.get(model.model_name);
    if (!preset) {
      if (provider.type !== 'ollama') customModels.push(cloneFlowerModel(model));
      continue;
    }
    const changes = Object.fromEntries(overrideKeys.flatMap((key) => {
      const value = model[key];
      if (key === 'max_output_tokens' && model.context_window && value === model.context_window && (preset.max_output_tokens ?? 0) > model.context_window) return [];
      if (value == null || equalValue(value, preset[key]) || (key === 'effective_context_window_percent' && value === 95)) return [];
      return [[key, value]];
    }));
    if (Object.keys(changes).length > 0) overrides.set(model.model_name, { model_name: model.model_name, ...changes });
  }
  return {
    ...out, models: [], model_selection: {
      disabled_models: [...disabled].sort(), custom_models: customModels, model_overrides: [...overrides.values()],
    },
  };
}

// Capture edits before disabling a model, so re-enabling restores its parameters.
export function setFlowerModelsEnabled(provider: FlowerProviderDraft, models: readonly FlowerProviderModel[], enabled: boolean): FlowerProviderDraft {
  const preferences = serializeFlowerProvider(provider).model_selection;
  const overrides = new Map((preferences?.model_overrides ?? []).map((model) => [model.model_name, model]));
  const selected = new Map(provider.models.map((model) => [model.model_name, model]));
  for (const model of models) {
    if (enabled) {
      if (!selected.has(model.model_name)) selected.set(model.model_name, cloneFlowerModel(applyModelOverride(model, overrides.get(model.model_name))));
    } else selected.delete(model.model_name);
  }
  return { ...provider, model_selection: preferences, models: [...selected.values()] };
}

export function filterFlowerModels<T extends FlowerProviderModel>(models: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? models.filter((model) => [model.model_name, model.wire_model_name, model.display_name].some((value) => value?.toLocaleLowerCase().includes(needle))) : models;
}

export function applyFlowerModelDiscovery(provider: FlowerProviderDraft, catalog: readonly FlowerProviderModel[]): FlowerProviderDraft {
  if (provider.type !== 'ollama') return { ...provider, catalog_models: catalog };
  const persisted = provider.catalog_models ? serializeFlowerProvider(provider) : { ...provider, model_selection: provider.model_selection ?? {} };
  return { ...provider, model_selection: persisted.model_selection, catalog_models: catalog, models: resolveFlowerProviderModels(persisted, catalog) };
}

export async function hydrateFlowerProviderCatalog(provider: FlowerProvider, discover: FlowerModelCatalogDiscovery): Promise<FlowerProvider> {
  if (provider.type !== 'ollama') return { ...provider, models: resolveFlowerProviderModels(provider) };
  try {
    const result = await discover({ provider_id: provider.id, type: provider.type, base_url: provider.base_url });
    return { ...applyFlowerModelDiscovery(provider, result.models), catalog_error: undefined };
  } catch (error) {
    return { ...provider, models: [], catalog_error: error instanceof Error ? error.message : String(error) };
  }
}
