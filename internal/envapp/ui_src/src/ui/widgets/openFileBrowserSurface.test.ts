import { describe, expect, it, vi } from 'vitest';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';
import { openFileBrowserSurface } from './openFileBrowserSurface';

describe('openFileBrowserSurface', () => {
  it('promotes the browser to a detached window for desktop-managed runtime', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });
    const openDetachedWindow = vi.fn(() => true);

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace',
        homePath: '/Users/demo',
      },
      controller,
      localRuntime: () => ({ mode: 'local', env_public_id: 'env-1', desktop_managed: true }),
      resolveLocalRuntime: async () => null,
      openDetachedWindow,
    });

    expect(opened).toBe(true);
    expect(openDetachedWindow).toHaveBeenCalledWith({
      path: '/workspace',
      homePath: '/Users/demo',
    });
    expect(controller.open()).toBe(false);
  });

  it('falls back to the in-app browser surface when detached promotion is unavailable', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });
    const openDetachedWindow = vi.fn(() => false);

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace/project/',
        homePath: '/Users/demo/',
        title: 'Browser',
      },
      controller,
      localRuntime: () => ({ mode: 'local', env_public_id: 'env-1', desktop_managed: true }),
      resolveLocalRuntime: async () => null,
      openDetachedWindow,
    });

    expect(opened).toBe(true);
    expect(openDetachedWindow).toHaveBeenCalledWith({
      path: '/workspace/project',
      homePath: '/Users/demo',
    });
    expect(controller.surface()).toMatchObject({
      path: '/workspace/project',
      homePath: '/Users/demo',
      title: 'Browser',
    });
  });
});
