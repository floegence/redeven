import type { FlowerProvider, FlowerProviderModel } from './contracts/flowerSurfaceContracts';
import { normalizeFlowerReasoningCapability, normalizeFlowerReasoningSelection } from './reasoning';

// Defaults and account inventory are read-only backend data, never bundled tables.
export function flowerProviderModelCatalog(provider: FlowerProvider): readonly FlowerProviderModel[] {
  return provider.catalog_models ?? (provider.auth_method === 'chatgpt' ? [] : provider.model_defaults ?? []);
}

export function cloneFlowerModel(model: FlowerProviderModel): FlowerProviderModel {
  const { supports_tools, model_digest, quantization, unavailable, web_search, web_search_enabled, model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection } = model;
  return JSON.parse(JSON.stringify({ supports_tools, model_digest, quantization, unavailable, web_search, web_search_enabled, model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection }));
}

export function applyModelOverride(model: FlowerProviderModel, override?: FlowerProviderModel): FlowerProviderModel {
  const merged = { ...model };
  if (override) {
    merged.model_name = override.model_name;
    if (override.wire_model_name) merged.wire_model_name = override.wire_model_name;
    if (override.display_name) merged.display_name = override.display_name;
    if (override.web_search_enabled !== undefined) merged.web_search_enabled = override.web_search_enabled;
    if (override.supports_tools != null) merged.supports_tools = override.supports_tools;
    for (const key of ['context_window', 'max_output_tokens', 'effective_context_window_percent'] as const) {
      if (override[key]) merged[key] = override[key];
    }
    if (override.input_modalities != null) merged.input_modalities = override.input_modalities;
    if (normalizeFlowerReasoningCapability(override.reasoning_capability)) merged.reasoning_capability = override.reasoning_capability;
    if (normalizeFlowerReasoningSelection(override.default_reasoning_selection)) merged.default_reasoning_selection = override.default_reasoning_selection;
  }
  if (model.status === 'unsupported' || model.supports_tools === false) {
    merged.status = 'unsupported'; merged.supports_tools = false;
  }
  if (!override?.max_output_tokens && merged.context_window && (merged.max_output_tokens ?? 0) > merged.context_window) merged.max_output_tokens = merged.context_window;
  if (merged.status === 'needs_configuration' && merged.context_window && merged.max_output_tokens && merged.supports_tools === true) merged.status = undefined;
  return merged;
}

function unavailableModelMetadata(provider: FlowerProvider, name: string, override?: FlowerProviderModel): FlowerProviderModel {
  const wire = override?.wire_model_name || name;
  const matches = (m: FlowerProviderModel) => m.model_name === wire || (m.wire_model_name || m.model_name) === wire;
  const reviewed = provider.model_defaults?.find(matches) ?? provider.models.find(matches);
  return applyModelOverride({ ...reviewed, model_name: name, unavailable: true }, override);
}

export function projectFlowerProviderModels(provider: FlowerProvider, discovered?: readonly FlowerProviderModel[], authoritative = discovered !== undefined): FlowerProviderModel[] {
  if (!provider.model_selection) return (provider.models ?? []).map(model => {
    if (discovered === undefined) return cloneFlowerModel(model);
    const entry = discovered.find(listed => (listed.wire_model_name || listed.model_name) === (model.wire_model_name || model.model_name));
    return cloneFlowerModel(entry ? { ...applyModelOverride(entry, model), model_name: model.model_name } : unavailableModelMetadata(provider, model.model_name, model));
  });
  const selection = provider.model_selection;
  const catalog = discovered ?? [];
  const overrides = new Map((selection.model_overrides ?? []).map((model) => [model.model_name, model]));
  const models = new Map(catalog.map((model) => {
    const override = overrides.get(model.model_name);
    const target = override?.wire_model_name && override.wire_model_name !== (model.wire_model_name || model.model_name)
      ? catalog.find(entry => (entry.wire_model_name || entry.model_name) === override.wire_model_name) : model;
    return [model.model_name, applyModelOverride(target ? { ...target, model_name: model.model_name } : unavailableModelMetadata(provider, model.model_name, override), override)] as const;
  }));
  for (const override of overrides.values()) {
    if (!models.has(override.model_name) && override.wire_model_name) {
      const entry = catalog.find((model) => (model.wire_model_name || model.model_name) === override.wire_model_name);
      if (entry) models.set(override.model_name, applyModelOverride(entry, override));
    }
  }
  for (const custom of selection.custom_models ?? []) {
    const catalogModel = models.get(custom.model_name) ?? catalog.find((entry) => (entry.wire_model_name || entry.model_name) === custom.wire_model_name);
    models.set(custom.model_name, applyModelOverride(catalogModel ?? { ...unavailableModelMetadata(provider, custom.model_name, custom), unavailable: authoritative || undefined }, custom));
  }
  // Legacy profiles must be frozen by the configuration owner, never expanded in chat.
  return (selection.selected_models ?? []).map((name) => cloneFlowerModel(models.get(name) ?? unavailableModelMetadata(provider, name, overrides.get(name))));
}

export function flowerModelNeedsConfiguration(model: FlowerProviderModel): boolean {
  return (model.status === 'needs_configuration' || model.supports_tools !== undefined)
    && (!(model.context_window && model.context_window > 0) || !(model.max_output_tokens && model.max_output_tokens > 0) || model.supports_tools === undefined);
}
