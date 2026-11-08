/** File identity only. Authentication and file access remain owned by the session. */
export const FILE_PREVIEW_WINDOW = 'file-preview';
export const OPEN_FILE_PREVIEW_WINDOW_CHANNEL = 'redeven-desktop:shell-open-file-preview-window';
export type FilePreviewWindowRequest = Readonly<{ path: string }>;
export type FilePreviewWindowResponse = Readonly<{ ok: boolean }>;

export function parseFilePreviewWindowRequest(value: unknown): FilePreviewWindowRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'path') || typeof input.path !== 'string') return null;
  const path = input.path;
  if (!path.startsWith('/') || path === '/' || path.length > 4096 || [...path].some(char => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || path.split('/').slice(1).some(part => !part || part === '.' || part === '..')) return null;
  return { path };
}

export function filePreviewWindowURL(entryURL: string, request: FilePreviewWindowRequest): string {
  if (!parseFilePreviewWindowRequest(request)) throw new Error('Invalid file preview path');
  const url = new URL(entryURL);
  url.search = '';
  url.hash = '';
  url.searchParams.set('window', FILE_PREVIEW_WINDOW);
  url.searchParams.set('path', request.path);
  return url.toString();
}

export function readFilePreviewWindowRequest(search: string): FilePreviewWindowRequest | null {
  const params = new URLSearchParams(search);
  if (params.getAll('window').length !== 1 || params.get('window') !== FILE_PREVIEW_WINDOW || params.getAll('path').length !== 1) return null;
  return parseFilePreviewWindowRequest({ path: params.get('path') });
}
