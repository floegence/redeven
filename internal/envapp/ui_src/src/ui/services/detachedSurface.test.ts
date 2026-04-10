import { describe, expect, it } from 'vitest';
import {
  basenameFromAbsolutePath,
  buildDetachedDebugConsoleSurface,
  buildDetachedFileBrowserSurface,
  buildDetachedFilePreviewSurface,
  isDesktopManagedRuntime,
  openDetachedSurfaceWindow,
  parseDetachedSurfaceFromURL,
  resolveDesktopSurfacePresentation,
  shouldOpenDetachedSurface,
} from './detachedSurface';

describe('detachedSurface', () => {
  it('parses a file preview surface from query params', () => {
    const surface = parseDetachedSurfaceFromURL('https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=file_preview&path=%2Fworkspace%2Fdemo.txt');
    expect(surface).toEqual({ kind: 'file_preview', path: '/workspace/demo.txt' });
  });

  it('parses a file browser surface with optional home path', () => {
    const surface = parseDetachedSurfaceFromURL('https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=file_browser&path=%2Fworkspace&home_path=%2FUsers%2Fdemo');
    expect(surface).toEqual({ kind: 'file_browser', path: '/workspace', homePath: '/Users/demo' });
  });

  it('parses a debug console surface without requiring a path', () => {
    const surface = parseDetachedSurfaceFromURL('https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=debug_console');
    expect(surface).toEqual({ kind: 'debug_console' });
  });

  it('returns null for invalid detached surface input', () => {
    expect(parseDetachedSurfaceFromURL('https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=file_preview')).toBeNull();
    expect(parseDetachedSurfaceFromURL('https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=unknown&path=%2Fworkspace')).toBeNull();
  });

  it('builds detached surface descriptors from file items and paths', () => {
    expect(buildDetachedFilePreviewSurface({ path: '/workspace/demo.txt' })).toEqual({ kind: 'file_preview', path: '/workspace/demo.txt' });
    expect(buildDetachedFileBrowserSurface({ path: '/workspace', homePath: '/Users/demo' })).toEqual({ kind: 'file_browser', path: '/workspace', homePath: '/Users/demo' });
    expect(buildDetachedDebugConsoleSurface()).toEqual({ kind: 'debug_console' });
    expect(buildDetachedFileBrowserSurface({ path: 'relative/path' })).toBeNull();
  });

  it('opens detached surfaces in stable named windows', () => {
    const calls: Array<{ url: string; target: string; features: string }> = [];
    const fakeWindow = {
      location: { href: 'https://localhost:23998/_redeven_proxy/env/#tab=ai' },
      open: (url: string, target: string, features: string) => {
        calls.push({ url, target, features });
        return null;
      },
    } as unknown as Window;

    openDetachedSurfaceWindow({ kind: 'file_preview', path: '/workspace/demo.txt' }, fakeWindow);
    openDetachedSurfaceWindow({ kind: 'file_browser', path: '/workspace', homePath: '/Users/demo' }, fakeWindow);
    openDetachedSurfaceWindow({ kind: 'debug_console' }, fakeWindow);

    expect(calls).toEqual([
      {
        url: 'https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=file_preview&path=%2Fworkspace%2Fdemo.txt',
        target: 'redeven_detached_file_preview',
        features: 'noopener,noreferrer',
      },
      {
        url: 'https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=file_browser&path=%2Fworkspace&home_path=%2FUsers%2Fdemo',
        target: 'redeven_detached_file_browser',
        features: 'noopener,noreferrer',
      },
      {
        url: 'https://localhost:23998/_redeven_proxy/env/?redeven_detached_surface=debug_console',
        target: 'redeven_detached_debug_console',
        features: 'noopener,noreferrer',
      },
    ]);
  });

  it('derives readable basenames and desktop-managed state', () => {
    expect(basenameFromAbsolutePath('/workspace/demo.txt')).toBe('demo.txt');
    expect(basenameFromAbsolutePath('/')).toBe('File');
    expect(isDesktopManagedRuntime({ mode: 'local', env_public_id: 'env_demo', desktop_managed: true })).toBe(true);
    expect(isDesktopManagedRuntime({ mode: 'local', env_public_id: 'env_demo', desktop_managed: false })).toBe(false);
    expect(isDesktopManagedRuntime(null)).toBe(false);
  });

  it('resolves desktop surface presentation by kind', () => {
    expect(resolveDesktopSurfacePresentation('file_preview')).toBe('detached');
    expect(resolveDesktopSurfacePresentation('file_browser')).toBe('floating');
    expect(resolveDesktopSurfacePresentation('debug_console')).toBe('detached');
  });

  it('opens detached surfaces only for desktop-managed kinds configured as detached', () => {
    const runtime = { mode: 'local', env_public_id: 'env_demo', desktop_managed: true } as const;
    expect(shouldOpenDetachedSurface({ runtime, kind: 'file_preview' })).toBe(true);
    expect(shouldOpenDetachedSurface({ runtime, kind: 'file_browser' })).toBe(false);
    expect(shouldOpenDetachedSurface({ runtime, kind: 'debug_console' })).toBe(true);
    expect(shouldOpenDetachedSurface({ runtime: null, kind: 'file_preview' })).toBe(false);
  });
});
