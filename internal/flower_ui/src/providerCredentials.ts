import type { FlowerProvider, FlowerProviderDraft, FlowerProviderType } from './contracts/flowerSurfaceContracts';

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
  provider: Pick<FlowerProviderDraft, 'id' | 'enabled' | 'type' | 'base_url' | 'auth_method' | 'account_id' | 'chatgpt_account' | 'provider_api_key' | 'web_search_api_key'> & {
    web_search?: { enabled: boolean; source: string };
  },
  storedKey: boolean,
  storedWebSearchKey: boolean,
  previous?: FlowerProvider,
): 'provider' | 'web_search' | null {
  if (provider.enabled === false) return null;
  // Bundle saves can preserve an existing connection whose runtime readiness changed.
  // Direct provider editors omit the baseline and always validate the edited connection.
  const credentialConfigurationChanged = !previous || previous.id !== provider.id || previous.enabled === false
    || previous.type !== provider.type || (previous.auth_method ?? 'api_key') !== (provider.auth_method ?? 'api_key')
    || (previous.account_id ?? '') !== (provider.account_id ?? '') || (previous.base_url?.trim() ?? '') !== (provider.base_url?.trim() ?? '');
  const hasPatch = (patch: string | null | undefined) => patch === null || Boolean(patch?.trim());
  if ((credentialConfigurationChanged || hasPatch(provider.provider_api_key))
    && (provider.auth_method === 'chatgpt' ? !provider.account_id || provider.chatgpt_account?.state !== 'ready' : !flowerProviderCredentialsReady(provider.type, hasCredential(provider.provider_api_key, storedKey)))) return 'provider';
  if (provider.web_search?.enabled && provider.web_search.source === 'brave'
    && (credentialConfigurationChanged || !previous?.web_search?.enabled || previous.web_search.source !== 'brave' || hasPatch(provider.web_search_api_key))
    && !hasCredential(provider.web_search_api_key, storedWebSearchKey)) return 'web_search';
  return null;
}
