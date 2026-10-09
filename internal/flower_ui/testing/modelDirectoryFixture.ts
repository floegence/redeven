import type { FlowerModelDirectory, FlowerModelDirectoryModel, FlowerSettingsSnapshot } from '../src/contracts/flowerSurfaceContracts';
import { flowerProviderCredentialsReady } from '../src/providerCredentials';
import { resolveFlowerProviderModels } from '../src/settings/modelSelection';

// Scripted UI fixtures state their model facts explicitly; production never
// derives a directory from editable settings or an older response shape.
export function modelDirectoryFixture(snapshot: FlowerSettingsSnapshot): FlowerModelDirectory {
  const models: FlowerModelDirectoryModel[] = [];
  const sources: FlowerModelDirectory['sources'][number][] = [];
  for (const provider of snapshot.model_profile?.providers ?? []) {
    const ready = flowerProviderCredentialsReady(provider.type, snapshot.provider_secrets.some(secret => secret.provider_id === provider.id && secret.provider_api_key_configured));
    sources.push({ id: provider.id, kind: 'runtime_config', state: ready ? 'ready' : 'unavailable', reason: ready ? undefined : 'missing_keys' });
    for (const model of resolveFlowerProviderModels(provider, provider.catalog_models)) {
      models.push({ id: `${provider.id}/${model.model_name}`, label: `${provider.name || provider.id} / ${model.display_name || model.model_name}`,
        source: 'runtime_config', state: ready && !model.unavailable ? 'ready' : 'unavailable',
        provider_id: provider.id, provider_name: provider.name || provider.id, provider_type: provider.type, model_name: model.model_name,
        alias_group: model.model_digest ? JSON.stringify([provider.id, model.model_digest, model.context_window, model.max_output_tokens, model.effective_context_window_percent, model.input_modalities, model.reasoning_capability, model.default_reasoning_selection]) : undefined,
        quantization: model.quantization, context_window: model.context_window, max_output_tokens: model.max_output_tokens,
        input_modalities: model.input_modalities, web_search: model.web_search,
        reasoning_capability: model.reasoning_capability, default_reasoning_selection: model.default_reasoning_selection,
      });
    }
  }
  const desktop = snapshot.model_source;
  if (desktop) {
    sources.push({ id: 'desktop', kind: 'desktop_model_source', state: desktop.state === 'ready' ? 'ready' : desktop.state === 'connecting' ? 'pending' : 'unavailable', reason: desktop.state, missing_key_provider_ids: desktop.state === 'missing_keys' ? desktop.missing_key_provider_ids : undefined });
    if (desktop.state === 'ready') for (const model of desktop.models) models.push({ ...model, source: 'desktop_model_source', state: 'ready' });
  }
  const platform = snapshot.platform_model_source;
  if (platform) {
    sources.push({ id: 'platform', kind: 'platform', state: platform.error ? 'unavailable' : 'ready', reason: platform.error ? 'catalog_unavailable' : undefined });
    for (const model of platform.models) models.push({ ...model, source: 'platform', state: 'ready' });
  }
  return { current_model_id: platform?.current_model_id || snapshot.model_profile?.current_model_id || (desktop?.state === 'ready' ? desktop.current_model_id : '') || '', models, sources };
}

export function withModelDirectoryFixture(snapshot: FlowerSettingsSnapshot): FlowerSettingsSnapshot {
  return { ...snapshot, model_directory: snapshot.model_directory ?? modelDirectoryFixture(snapshot) };
}
