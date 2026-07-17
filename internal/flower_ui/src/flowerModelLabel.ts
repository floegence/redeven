import type { FlowerModelProfile } from './contracts/flowerSurfaceContracts';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

export function formatFlowerCurrentModelLabel(config: FlowerModelProfile, noModelSelected: string): string {
  const current = cleanText(config.current_model_id);
  if (!current) return noModelSelected;
  const [providerID, ...modelParts] = current.split('/');
  const modelName = cleanText(modelParts.join('/')) || current;
  const provider = config.providers.find((item) => item.id === providerID);
  const providerName = cleanText(provider?.name) || cleanText(provider?.id);
  return providerName && modelName !== current ? `${providerName} / ${modelName}` : modelName;
}
