import { describe, expect, it, vi } from 'vitest';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';
import { openFileBrowserSurface } from './openFileBrowserSurface';

describe('openFileBrowserSurface', () => {
  it('keeps the browser on the shared floating surface for desktop-managed runtime', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });
    const openDetachedWindow = vi.fn(() => true);
    const resolveLocalRuntime = vi.fn(async () => null);

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace',
        homePath: '/Users/demo',
      },
      controller,
      localRuntime: () => ({ mode: 'local', env_public_id: 'env-1', desktop_managed: true }),
      resolveLocalRuntime,
      openDetachedWindow,
    });

    expect(opened).toBe(true);
    expect(openDetachedWindow).not.toHaveBeenCalled();
    expect(resolveLocalRuntime).not.toHaveBeenCalled();
    expect(controller.surface()).toMatchObject({
      path: '/workspace',
      homePath: '/Users/demo',
    });
  });

  it('normalizes browser input before opening the shared floating surface', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });
    const openDetachedWindow = vi.fn(() => false);
    const resolveLocalRuntime = vi.fn(async () => null);

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace/project/',
        homePath: '/Users/demo/',
        title: 'Browser',
      },
      controller,
      localRuntime: () => ({ mode: 'local', env_public_id: 'env-1', desktop_managed: true }),
      resolveLocalRuntime,
      openDetachedWindow,
    });

    expect(opened).toBe(true);
    expect(openDetachedWindow).not.toHaveBeenCalled();
    expect(resolveLocalRuntime).not.toHaveBeenCalled();
    expect(controller.surface()).toMatchObject({
      path: '/workspace/project',
      homePath: '/Users/demo',
      title: 'Browser',
    });
  });
});
