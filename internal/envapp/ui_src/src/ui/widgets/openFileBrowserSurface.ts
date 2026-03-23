import type { LocalRuntimeInfo } from '../services/controlplaneApi';
import {
  buildDetachedFileBrowserSurface,
  isDesktopManagedRuntime,
  openDetachedSurfaceWindow,
} from '../services/detachedSurface';
import type { FileBrowserSurfaceController, FileBrowserSurfaceOpenParams } from './createFileBrowserSurfaceController';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAbsolutePath(value: unknown): string {
  const raw = compact(value);
  if (!raw || !raw.startsWith('/')) return '';
  if (raw === '/') return '/';
  return raw.replace(/\/+$/, '') || '/';
}

function openDetachedFileBrowser(params: Readonly<{ path: string; homePath?: string }>): boolean {
  const surface = buildDetachedFileBrowserSurface(params);
  if (!surface) return false;
  openDetachedSurfaceWindow(surface);
  return true;
}

export async function openFileBrowserSurface(params: Readonly<{
  input: FileBrowserSurfaceOpenParams;
  controller: FileBrowserSurfaceController;
  localRuntime: () => LocalRuntimeInfo | null;
  resolveLocalRuntime: () => Promise<LocalRuntimeInfo | null>;
  openDetachedWindow?: (params: Readonly<{ path: string; homePath?: string }>) => boolean;
}>): Promise<boolean> {
  const path = normalizeAbsolutePath(params.input.path);
  if (!path) return false;

  const homePath = normalizeAbsolutePath(params.input.homePath);
  const normalizedInput: FileBrowserSurfaceOpenParams = {
    ...params.input,
    path,
    homePath: homePath || undefined,
  };

  try {
    const runtime = params.localRuntime() ?? await params.resolveLocalRuntime();
    if (isDesktopManagedRuntime(runtime)) {
      const openDetachedWindow = params.openDetachedWindow ?? openDetachedFileBrowser;
      if (openDetachedWindow({ path, homePath: homePath || undefined })) {
        return true;
      }
    }
  } catch {
    // Fall back to the in-app browser surface when local runtime inspection fails.
  }

  return params.controller.openSurface(normalizedInput) !== null;
}
