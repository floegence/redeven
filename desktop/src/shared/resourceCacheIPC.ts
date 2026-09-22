export const DESKTOP_RESOURCE_CACHE_CHANNEL = 'redeven-desktop:resource-cache';

export interface DesktopResourceCacheBridge {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<readonly { key: string; bytes: number; lastAccessedAt: number }[]>;
}

export type DesktopResourceCacheRequest =
  | { action: 'get'; key: string }
  | { action: 'remove'; key: string }
  | { action: 'set'; key: string; value: string }
  | { action: 'list' };

export function normalizeResourceCacheRequest(value: unknown): DesktopResourceCacheRequest | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as Partial<{ action: string; key: string; value: string }>;
  if (request.action === 'list') return { action: 'list' };
  if (typeof request.key !== 'string' || !request.key || request.key.length > 8192) return null;
  if (request.action === 'get' || request.action === 'remove') return { action: request.action, key: request.key };
  if (request.action === 'set' && typeof request.value === 'string' && Buffer.byteLength(request.value, 'utf8') <= 32 * 1024 * 1024) {
    return { action: 'set', key: request.key, value: request.value };
  }
  return null;
}
