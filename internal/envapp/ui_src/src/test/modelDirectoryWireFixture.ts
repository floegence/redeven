import { modelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import type { FlowerModelDirectoryModel } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { AgentSettingsResponse } from '../ui/pages/settings/types';

export function modelDirectoryWireFixture(settings: Pick<AgentSettingsResponse, 'ai'> & Partial<AgentSettingsResponse>, response: Record<string, unknown> = {}) {
  if ('directory' in response) return response;
  if ('models' in response && !Array.isArray(response.models)) return response;
  const directory = modelDirectoryFixture({
    defaults: { permission_type: 'approval_required' },
    model_profile: settings.ai?.current_model_id ? { schema_version: 1, current_model_id: settings.ai.current_model_id,
      providers: (settings.ai.providers ?? []).map(provider => ({ ...provider, models: provider.models ?? [], web_search: provider.web_search ? { mode: provider.web_search.mode ?? 'disabled' } : undefined })),
    } : null,
    provider_secrets: (settings.ai?.providers ?? []).map(provider => ({ provider_id: provider.id,
      provider_api_key_configured: settings.ai_secrets?.provider_api_key_set?.[provider.id] === true,
      web_search_api_key_configured: false,
    })),
  });
  const raw = (response.models ?? []) as FlowerModelDirectoryModel[];
  for (const model of raw) {
    const index = directory.models.findIndex(entry => entry.id === model.id);
    const source = model.source || (model.id.startsWith('platform/') ? 'platform' : model.id.startsWith('desktop:') ? 'desktop_model_source' : 'runtime_config');
    const [provider_id, ...parts] = model.id.split('/');
    const entry = { ...(index >= 0 ? directory.models[index] : {}), ...model, source,
      state: 'ready' as const, label: model.label || model.id,
      ...(source === 'runtime_config' ? { provider_id, model_name: parts.join('/') } : {}),
    };
    if (index >= 0) (directory.models as FlowerModelDirectoryModel[])[index] = entry;
    else (directory.models as FlowerModelDirectoryModel[]).push(entry);
  }
  const sources = [...directory.sources];
  const desktop = settings.ai_runtime?.desktop_model_source;
  if (desktop) {
    let reason = desktop.binding_state || 'unbound';
    if (reason === 'bound') reason = desktop.configured === false ? 'not_configured' : (desktop.missing_key_provider_ids?.length ?? 0) > 0 ? 'missing_keys' : desktop.connected ? 'empty' : 'disconnected';
    const ready = directory.models.some(model => model.source === 'desktop_model_source');
    sources.push({ id: 'desktop', kind: 'desktop_model_source', state: ready ? 'ready' : reason === 'connecting' ? 'pending' : 'unavailable', reason, missing_key_provider_ids: desktop.missing_key_provider_ids });
  }
  if (settings.ai_runtime?.platform_available) sources.push({ id: 'platform', kind: 'platform', state: (response.runtime as { platform_error?: string })?.platform_error ? 'unavailable' : 'ready', reason: (response.runtime as { platform_error?: string })?.platform_error ? 'catalog_unavailable' : undefined });
  return { ...response, current_model: response.current_model ?? directory.current_model_id, directory: { models: directory.models, sources } };
}
