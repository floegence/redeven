import type { FlowerProvider, FlowerProviderModel } from './contracts/flowerSurfaceContracts';

export function cloneFlowerModel(model: FlowerProviderModel): FlowerProviderModel {
  const { supports_tools, model_digest, quantization, unavailable, web_search, model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection } = model;
  return JSON.parse(JSON.stringify({ supports_tools, model_digest, quantization, unavailable, web_search, model_name, display_name, status, wire_model_name, context_window, max_output_tokens, effective_context_window_percent, input_modalities, reasoning_capability, default_reasoning_selection }));
}

export function applyModelOverride(model: FlowerProviderModel, override?: FlowerProviderModel): FlowerProviderModel {
  const merged = { ...model, ...override };
  if (model.status === 'unsupported' || model.supports_tools === false) {
    merged.status = 'unsupported'; merged.supports_tools = false;
  }
  if (!override?.max_output_tokens && merged.context_window && (merged.max_output_tokens ?? 0) > merged.context_window) merged.max_output_tokens = merged.context_window;
  if (merged.status === 'needs_configuration' && merged.context_window && merged.max_output_tokens && merged.supports_tools === true) merged.status = undefined;
  return merged;
}

export function projectFlowerProviderModels(provider: FlowerProvider, discovered?: readonly FlowerProviderModel[], authoritative = discovered !== undefined): FlowerProviderModel[] {
  if (!provider.model_selection) return (provider.models ?? []).map(model => {
    if (discovered === undefined) return cloneFlowerModel(model);
    const entry = discovered.find(listed => (listed.wire_model_name || listed.model_name) === (model.wire_model_name || model.model_name));
    return cloneFlowerModel(entry ? { ...applyModelOverride(entry, model), model_name: model.model_name } : { ...model, unavailable: true });
  });
  const selection = provider.model_selection;
  const catalog = discovered ?? [];
  const overrides = new Map((selection.model_overrides ?? []).map((model) => [model.model_name, model]));
  const models = new Map(catalog.map((model) => [model.model_name, applyModelOverride(model, overrides.get(model.model_name))]));
  for (const override of overrides.values()) {
    if (!models.has(override.model_name) && override.wire_model_name) {
      const entry = catalog.find((model) => (model.wire_model_name || model.model_name) === override.wire_model_name);
      if (entry) models.set(override.model_name, applyModelOverride(entry, override));
    }
  }
  for (const custom of selection.custom_models ?? []) {
    const catalogModel = models.get(custom.model_name) ?? catalog.find((entry) => (entry.wire_model_name || entry.model_name) === custom.wire_model_name);
    models.set(custom.model_name, applyModelOverride(catalogModel ?? { model_name: custom.model_name, ...(authoritative ? { unavailable: true } : {}) }, custom));
  }
  // Legacy profiles must be frozen by the configuration owner, never expanded in chat.
  return (selection.selected_models ?? []).map((name) => cloneFlowerModel(models.get(name) ?? {
    ...overrides.get(name), model_name: name, unavailable: true,
  }));
}

export function flowerModelNeedsConfiguration(model: FlowerProviderModel): boolean {
  return (model.status === 'needs_configuration' || model.supports_tools !== undefined)
    && (!(model.context_window && model.context_window > 0) || !(model.max_output_tokens && model.max_output_tokens > 0) || model.supports_tools === undefined);
}
