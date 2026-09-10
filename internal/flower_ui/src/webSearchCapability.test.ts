import { describe, expect, it } from 'vitest';
import type { FlowerProvider, FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerProviderSearchSummary, flowerWebSearchLabel, withFlowerWebSearchAvailability } from './webSearchCapability';
import { modelCatalogCopy } from './settings/modelCatalogCopy';
import { applyFlowerModelDiscovery, cloneFlowerModel, serializeFlowerProvider } from './settings/modelSelection';

const available = { status: 'available', reason: 'catalog_supported' } as const;
const missingKey = { status: 'unavailable', reason: 'needs_credentials' } as const;

describe('server-owned search capability', () => {
  const provider: FlowerProvider = { id: 'openai', type: 'openai', models: [{ model_name: 'vision-alias', wire_model_name: 'gpt-5.5' }, { model_name: 'another' }] };
  const snapshot: FlowerSettingsSnapshot = { defaults: { permission_type: 'readonly' }, model_profile: { schema_version: 1, current_model_id: 'openai/vision-alias', providers: [provider] }, provider_secrets: [] };

  it('joins by exact local identity and never treats a provider brand as enabled', () => {
    const next = withFlowerWebSearchAvailability(snapshot, [{ id: 'openai/vision-alias', web_search: available }]);
    const models = next.model_profile!.providers[0].models;
    expect(models[0].web_search).toEqual(available);
    expect(models[1].web_search).toBeUndefined();
    expect(provider.models[0].web_search).toBeUndefined();
    expect(flowerProviderSearchSummary(models, modelCatalogCopy('en-US')).label).toBe('Web search available for some models');
  });

  it('refreshes alias projections by wire identity and keeps them out of saved preferences', () => {
    const next = applyFlowerModelDiscovery(provider, [{ model_name: 'gpt-5.5', web_search: available }]);
    expect(cloneFlowerModel(next.models[0]).web_search).toEqual(available);
    expect(JSON.stringify(serializeFlowerProvider(next))).not.toContain('catalog_supported');
    expect(serializeFlowerProvider(next).model_selection?.custom_models?.[0].wire_model_name).toBe('gpt-5.5');
  });

  it('reports missing credentials separately from unsupported models', () => {
    const copy = modelCatalogCopy('zh-CN');
    expect(flowerWebSearchLabel(missingKey, copy)).toBe('需要搜索 API 密钥');
    expect(flowerWebSearchLabel({ status: 'unavailable', reason: 'not_integrated' }, copy)).toBe('当前未接入联网搜索');
    expect(flowerWebSearchLabel({ status: 'unavailable', reason: 'unsupported' }, copy)).toBe('不支持联网搜索');
  });
});
