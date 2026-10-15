import type { FlowerProviderModel, FlowerWebSearchAvailability } from './contracts/flowerSurfaceContracts';
import type { ModelCatalogCopy } from './settings/modelCatalogCopy';

export function flowerWebSearchLabel(availability: FlowerWebSearchAvailability | undefined, copy: ModelCatalogCopy): string {
  if (availability?.status === 'available') return copy.searchAvailable;
  switch (availability?.reason) {
    case 'unsupported': return copy.searchUnsupported;
    case 'not_integrated': return copy.searchNotIntegrated;
    case 'provider_disabled': return copy.searchProviderOff;
    case 'model_disabled': return copy.searchModelOff;
    case 'needs_credentials': return copy.searchNeedsKey;
    default: return copy.searchPending;
  }
}

export function flowerProviderSearchSummary(models: readonly FlowerProviderModel[], copy: ModelCatalogCopy): Readonly<{ enabled: boolean; label: string }> {
  const available = models.filter((model) => model.web_search?.status === 'available').length;
  if (available > 0) return { enabled: true, label: available === models.length ? copy.searchAvailable : copy.searchPartial };
  const reasons = new Set(models.map((model) => model.web_search?.reason));
  return { enabled: false, label: flowerWebSearchLabel(reasons.size === 1 ? models[0]?.web_search : undefined, copy) };
}
