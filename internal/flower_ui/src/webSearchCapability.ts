import type { FlowerProvider, FlowerProviderModel, FlowerSettingsSnapshot, FlowerWebSearchAvailability } from './contracts/flowerSurfaceContracts';
import type { ModelCatalogCopy } from './settings/modelCatalogCopy';

export function flowerWebSearchLabel(availability: FlowerWebSearchAvailability | undefined, copy: ModelCatalogCopy): string {
  if (availability?.status === 'available') return copy.searchAvailable;
  switch (availability?.reason) {
    case 'unsupported': return copy.searchUnsupported;
    case 'not_integrated': return copy.searchNotIntegrated;
    case 'not_configured': return copy.searchNotConfigured;
    case 'needs_credentials': return copy.searchNeedsKey;
    case 'endpoint_not_supported': return copy.searchEndpointUnsupported;
    default: return copy.searchPending;
  }
}

export function flowerProviderSearchSummary(models: readonly FlowerProviderModel[], copy: ModelCatalogCopy): Readonly<{ enabled: boolean; label: string }> {
  const available = models.filter((model) => model.web_search?.status === 'available').length;
  if (available > 0) return { enabled: true, label: available === models.length ? copy.searchAvailable : copy.searchPartial };
  const reasons = new Set(models.map((model) => model.web_search?.reason));
  return { enabled: false, label: flowerWebSearchLabel(reasons.size === 1 ? models[0]?.web_search : undefined, copy) };
}

// Join the server's read-only projection by exact model ID. This data is never
// interpreted as a provider setting or inferred from a model/brand name.
export function withFlowerWebSearchAvailability(snapshot: FlowerSettingsSnapshot, models: readonly Readonly<{ id?: string; web_search?: FlowerWebSearchAvailability }>[]): FlowerSettingsSnapshot {
  if (!snapshot.model_profile) return snapshot;
  return { ...snapshot, model_profile: { ...snapshot.model_profile, providers: snapshot.model_profile.providers.map((provider) => withFlowerProviderSearchAvailability(provider, models)) } };
}

export function withFlowerProviderSearchAvailability<T extends FlowerProvider>(provider: T, models: readonly Readonly<{ id?: string; web_search?: FlowerWebSearchAvailability }>[]): T {
  const search = new Map(models.map((model) => [model.id, model.web_search]));
  return { ...provider, models: provider.models.map((model) => ({ ...model, web_search: search.get(`${provider.id}/${model.model_name}`) })) };
}
