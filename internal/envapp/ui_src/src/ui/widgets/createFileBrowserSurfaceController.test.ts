import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY,
  DEFAULT_FILE_BROWSER_SURFACE_STATE_SCOPE,
  DEFAULT_FILE_BROWSER_SURFACE_TITLE,
  createFileBrowserSurfaceController,
} from './createFileBrowserSurfaceController';

describe('createFileBrowserSurfaceController', () => {
  it('opens a normalized browser surface with defaults', () => {
    let requestSeq = 0;
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => `req-${++requestSeq}`,
    });

    const surface = controller.openSurface({
      path: '/workspace/project/',
      homePath: '/Users/demo/',
    });

    expect(surface).toEqual({
      requestId: 'req-1',
      path: '/workspace/project',
      homePath: '/Users/demo',
      title: DEFAULT_FILE_BROWSER_SURFACE_TITLE,
      persistenceKey: DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY,
      stateScope: DEFAULT_FILE_BROWSER_SURFACE_STATE_SCOPE,
    });
    expect(controller.open()).toBe(true);
    expect(controller.surface()).toEqual(surface);
  });

  it('generates a fresh request id on repeated opens so callers can force a browser reseed', () => {
    let requestSeq = 0;
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => `req-${++requestSeq}`,
    });

    const firstSurface = controller.openSurface({ path: '/workspace/project' });
    const secondSurface = controller.openSurface({ path: '/workspace/project' });

    expect(firstSurface?.requestId).toBe('req-1');
    expect(secondSurface?.requestId).toBe('req-2');
  });

  it('rejects invalid non-absolute paths', () => {
    const controller = createFileBrowserSurfaceController();

    expect(controller.openSurface({ path: 'workspace/project' })).toBeNull();
    expect(controller.open()).toBe(false);
  });
});
