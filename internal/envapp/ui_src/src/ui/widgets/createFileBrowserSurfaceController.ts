import { createSignal } from 'solid-js';
import { createClientId } from '../utils/clientId';

export const DEFAULT_FILE_BROWSER_SURFACE_TITLE = 'Browser';
export const DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY = 'file-browser-surface';
export const DEFAULT_FILE_BROWSER_SURFACE_STATE_SCOPE = 'floating-surface';

export type FileBrowserSurfaceOpenParams = Readonly<{
  path: string;
  homePath?: string;
  title?: string;
  persistenceKey?: string;
  stateScope?: string;
}>;

export type FileBrowserSurfaceState = Readonly<{
  requestId: string;
  path: string;
  homePath?: string;
  title: string;
  persistenceKey: string;
  stateScope: string;
}>;

export type FileBrowserSurfaceController = ReturnType<typeof createFileBrowserSurfaceController>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAbsolutePath(value: unknown): string {
  const raw = compact(value);
  if (!raw || !raw.startsWith('/')) return '';
  if (raw === '/') return '/';
  return raw.replace(/\/+$/, '') || '/';
}

export function createFileBrowserSurfaceController(params: Readonly<{
  createRequestId?: () => string;
}> = {}) {
  const createRequestId = params.createRequestId ?? (() => createClientId('file-browser-surface'));
  const [surface, setSurface] = createSignal<FileBrowserSurfaceState | null>(null);

  const openSurface = (input: FileBrowserSurfaceOpenParams): FileBrowserSurfaceState | null => {
    const path = normalizeAbsolutePath(input.path);
    if (!path) return null;

    const homePath = normalizeAbsolutePath(input.homePath);
    const nextSurface: FileBrowserSurfaceState = {
      requestId: createRequestId(),
      path,
      homePath: homePath || undefined,
      title: compact(input.title) || DEFAULT_FILE_BROWSER_SURFACE_TITLE,
      persistenceKey: compact(input.persistenceKey) || DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY,
      stateScope: compact(input.stateScope) || DEFAULT_FILE_BROWSER_SURFACE_STATE_SCOPE,
    };

    setSurface(nextSurface);
    return nextSurface;
  };

  const closeSurface = () => {
    setSurface(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeSurface();
    }
  };

  return {
    surface,
    open: () => surface() !== null,
    openSurface,
    closeSurface,
    handleOpenChange,
  };
}
