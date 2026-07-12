import { describe, expect, it, vi } from 'vitest';

import { createFlowerLinkedContextNavigation } from './linkedContextNavigation';

const request = {
  path: '/workspace/src/app.ts',
  thread_id: 'thread_1',
  message_id: 'message_1',
  context_index: 0,
  source_surface: 'file_preview' as const,
  target: 'current',
};

describe('Flower linked-context Env navigation', () => {
  it('opens files and directories through the existing layout-aware host controllers', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview,
      openFileBrowserAtPath,
      notifyInvalidFilePath: vi.fn(),
      notifyInvalidDirectoryPath: vi.fn(),
    });

    await navigation.openLinkedFilePreview(request);
    await navigation.openLinkedDirectoryBrowser({ ...request, path: '/workspace/src' });

    expect(openFilePreview).toHaveBeenCalledWith({
      id: '/workspace/src/app.ts',
      type: 'file',
      path: '/workspace/src/app.ts',
      name: 'app.ts',
    }, {
      focus: true,
      reusePolicy: 'same_file_or_create',
    });
    expect(openFileBrowserAtPath).toHaveBeenCalledWith('/workspace/src', {
      title: 'src',
      openStrategy: 'focus_latest_or_create',
    });
  });

  it('rejects invalid paths before invoking file hosts', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const notifyInvalidFilePath = vi.fn();
    const notifyInvalidDirectoryPath = vi.fn();
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview,
      openFileBrowserAtPath,
      notifyInvalidFilePath,
      notifyInvalidDirectoryPath,
    });

    await navigation.openLinkedFilePreview({ ...request, path: 'relative/app.ts' });
    await navigation.openLinkedDirectoryBrowser({ ...request, path: '' });

    expect(notifyInvalidFilePath).toHaveBeenCalledTimes(1);
    expect(notifyInvalidDirectoryPath).toHaveBeenCalledTimes(1);
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(openFileBrowserAtPath).not.toHaveBeenCalled();
  });
});
