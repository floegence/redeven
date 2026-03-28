import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

export function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').trim().replace(/\\/g, '/');
  if (!normalized) return 'File';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized || 'File';
}

export function fileItemFromPath(path: string, name?: string): FileItem {
  const normalizedPath = String(path ?? '').trim() || String(name ?? '').trim() || 'File';
  return {
    id: normalizedPath,
    name: String(name ?? '').trim() || basenameFromPath(normalizedPath),
    path: normalizedPath,
    type: 'file',
  };
}
