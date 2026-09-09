import type { FlowerModelProfile } from './contracts/flowerSurfaceContracts';

export function flowerModelSupportsImage(raw: readonly string[] | string | undefined): boolean {
  const source = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return source.some((item) => String(item ?? '').trim().toLowerCase() === 'image');
}

export function formatFlowerTokenCount(value: number | undefined): string {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 'N/A';
  return new Intl.NumberFormat(undefined).format(Math.trunc(Number(value)));
}

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
