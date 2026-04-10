import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { LocalRuntimeInfo } from './controlplaneApi';

export const DETACHED_SURFACE_QUERY_KEY = 'redeven_detached_surface';
export const DETACHED_SURFACE_PATH_QUERY_KEY = 'path';
export const DETACHED_SURFACE_HOME_PATH_QUERY_KEY = 'home_path';

export type DetachedSurfaceKind = 'file_preview' | 'file_browser' | 'debug_console';
export type DesktopSurfacePresentation = 'floating' | 'detached';

export type DetachedSurface =
  | Readonly<{
      kind: 'file_preview';
      path: string;
    }>
  | Readonly<{
      kind: 'file_browser';
      path: string;
      homePath?: string;
    }>
  | Readonly<{
      kind: 'debug_console';
    }>;

const DESKTOP_SURFACE_PRESENTATION_POLICY: Readonly<Record<DetachedSurfaceKind, DesktopSurfacePresentation>> = {
  file_preview: 'detached',
  file_browser: 'floating',
  debug_console: 'detached',
};

function normalizeAbsolutePath(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  if (raw === '/') return '/';
  return raw.replace(/\/+$/, '') || '/';
}

function currentEnvAppURL(win: Window): URL {
  return new URL(win.location.href);
}

function buildDetachedSurfaceURL(surface: DetachedSurface, win: Window): string {
  const url = currentEnvAppURL(win);
  url.search = '';
  url.hash = '';
  url.searchParams.set(DETACHED_SURFACE_QUERY_KEY, surface.kind);
  if (surface.kind !== 'debug_console') {
    url.searchParams.set(DETACHED_SURFACE_PATH_QUERY_KEY, surface.path);
    if (surface.kind === 'file_browser' && surface.homePath) {
      url.searchParams.set(DETACHED_SURFACE_HOME_PATH_QUERY_KEY, surface.homePath);
    }
  }
  return url.toString();
}

function detachedWindowTarget(surface: DetachedSurface): string {
  if (surface.kind === 'file_preview') return 'redeven_detached_file_preview';
  if (surface.kind === 'debug_console') return 'redeven_detached_debug_console';
  return 'redeven_detached_file_browser';
}

export function parseDetachedSurfaceFromURL(input: string | URL | Location): DetachedSurface | null {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.href);
  const kind = String(url.searchParams.get(DETACHED_SURFACE_QUERY_KEY) ?? '').trim();
  if (!kind) return null;

  if (kind === 'debug_console') {
    return { kind };
  }

  const path = normalizeAbsolutePath(url.searchParams.get(DETACHED_SURFACE_PATH_QUERY_KEY));
  if (!path) return null;

  if (kind === 'file_preview') {
    return { kind, path };
  }
  if (kind === 'file_browser') {
    const homePath = normalizeAbsolutePath(url.searchParams.get(DETACHED_SURFACE_HOME_PATH_QUERY_KEY));
    return homePath ? { kind, path, homePath } : { kind, path };
  }
  return null;
}

export function basenameFromAbsolutePath(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized || normalized === '/') return 'File';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'File';
}

export function buildDetachedFilePreviewSurface(item: Pick<FileItem, 'path'>): DetachedSurface | null {
  const path = normalizeAbsolutePath(item.path);
  if (!path) return null;
  return { kind: 'file_preview', path };
}

export function buildDetachedFileBrowserSurface(params: Readonly<{ path: string; homePath?: string }>): DetachedSurface | null {
  const path = normalizeAbsolutePath(params.path);
  if (!path) return null;
  const homePath = normalizeAbsolutePath(params.homePath);
  return homePath ? { kind: 'file_browser', path, homePath } : { kind: 'file_browser', path };
}

export function buildDetachedDebugConsoleSurface(): DetachedSurface {
  return { kind: 'debug_console' };
}

export function resolveDesktopSurfacePresentation(kind: DetachedSurfaceKind): DesktopSurfacePresentation {
  return DESKTOP_SURFACE_PRESENTATION_POLICY[kind];
}

export function shouldOpenDetachedSurface(args: Readonly<{
  runtime: LocalRuntimeInfo | null | undefined;
  kind: DetachedSurfaceKind;
}>): boolean {
  return isDesktopManagedRuntime(args.runtime) && resolveDesktopSurfacePresentation(args.kind) === 'detached';
}

export function openDetachedSurfaceWindow(surface: DetachedSurface, win: Window = window): Window | null {
  return win.open(buildDetachedSurfaceURL(surface, win), detachedWindowTarget(surface), 'noopener,noreferrer');
}

export function isDesktopManagedRuntime(runtime: LocalRuntimeInfo | null | undefined): boolean {
  return Boolean(runtime?.desktop_managed);
}
