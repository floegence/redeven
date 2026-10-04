import type { FlowerProviderDraft, FlowerProviderType } from './contracts/flowerSurfaceContracts';

// Product credential policy shared by the composer and both provider editors.
export function flowerProviderAPIKeyOptional(type: FlowerProviderType): boolean {
  return type === 'ollama' || type === 'openai_compatible';
}

export function flowerProviderCredentialsReady(type: FlowerProviderType, keyConfigured: boolean): boolean {
  return flowerProviderAPIKeyOptional(type) || keyConfigured;
}

function hasCredential(patch: string | null | undefined, stored: boolean): boolean {
  if (patch === null) return false;
  return Boolean(patch?.trim()) || stored;
}

export function missingFlowerProviderCredential(
  provider: Pick<FlowerProviderDraft, 'type' | 'provider_api_key' | 'web_search_api_key'> & {
    web_search?: { mode?: string };
  },
  storedKey: boolean,
  storedWebSearchKey: boolean,
): 'provider' | 'web_search' | null {
  if (!flowerProviderCredentialsReady(provider.type, hasCredential(provider.provider_api_key, storedKey))) return 'provider';
  if (provider.web_search?.mode === 'brave' && !hasCredential(provider.web_search_api_key, storedWebSearchKey)) return 'web_search';
  return null;
}
