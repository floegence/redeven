import catalog from '../../config/model_catalog.generated.json';
import type { FlowerProviderModel, FlowerProviderType } from '../src/contracts/flowerSurfaceContracts';

// Simulate backend response data in tests without shipping a frontend catalog.
export const providerDefaultsFixture = catalog.providers as Partial<Record<FlowerProviderType, readonly FlowerProviderModel[]>>;

export function backendModelsForProviderType(type: FlowerProviderType): FlowerProviderModel[] {
  return structuredClone(providerDefaultsFixture[type] ?? []) as FlowerProviderModel[];
}
