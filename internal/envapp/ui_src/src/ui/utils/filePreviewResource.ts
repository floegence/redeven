export const REDEVEN_FS_FILE_RESOURCE_ENDPOINT = '/_redeven_proxy/api/fs/file';

export function buildRedevenFileResourceUrl(path: string): string {
  const normalized = String(path ?? '').trim();
  if (!normalized) return '';
  const params = new URLSearchParams({ path: normalized });
  return `${REDEVEN_FS_FILE_RESOURCE_ENDPOINT}?${params.toString()}`;
}
