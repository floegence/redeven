import { describe, expect, it } from 'vitest';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';
import { openFileBrowserSurface } from './openFileBrowserSurface';

describe('openFileBrowserSurface', () => {
  it('opens the shared floating browser surface for an absolute path', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace',
        homePath: '/Users/demo',
      },
      controller,
    });

    expect(opened).toBe(true);
    expect(controller.surface()).toMatchObject({
      path: '/workspace',
      homePath: '/Users/demo',
    });
  });

  it('normalizes browser input before opening the shared floating surface', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });

    const opened = await openFileBrowserSurface({
      input: {
        path: '/workspace/project/',
        homePath: '/Users/demo/',
        title: 'Browser',
      },
      controller,
    });

    expect(opened).toBe(true);
    expect(controller.surface()).toMatchObject({
      path: '/workspace/project',
      homePath: '/Users/demo',
      title: 'Browser',
    });
  });

  it('rejects non-absolute paths instead of opening a browser surface', async () => {
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => 'req-1',
    });

    const opened = await openFileBrowserSurface({
      input: {
        path: 'workspace/project',
        homePath: '/Users/demo/',
      },
      controller,
    });

    expect(opened).toBe(false);
    expect(controller.surface()).toBeNull();
  });
});
