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
  it('keeps the source preview until linked-file reads succeed and the frame remains active', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const checkFileReadable = vi.fn<(path: string, signal: AbortSignal) => Promise<void>>();
    const navigation = createFlowerLinkedContextNavigation({ openFilePreview, checkFileReadable,
      openFileBrowserAtPath: vi.fn(), notifyInvalidFilePath: vi.fn(), notifyInvalidDirectoryPath: vi.fn() });
    for (const message of ['Permission denied', 'File not found']) {
      checkFileReadable.mockRejectedValueOnce(new Error(message));
      await expect(navigation.openMessageFile({ path: '/workspace/linked.pdf', action: 'preview', signal: new AbortController().signal })).rejects.toThrow(message);
    }
    expect(openFilePreview).not.toHaveBeenCalled();
    let finish!: () => void;
    checkFileReadable.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = navigation.openMessageFile({ path: '/workspace/linked.pdf', action: 'preview', signal: controller.signal });
    controller.abort();
    finish();
    await expect(pending).rejects.toThrow();
    expect(openFilePreview).not.toHaveBeenCalled();
    checkFileReadable.mockResolvedValueOnce();
    await navigation.openMessageFile({ path: '/workspace/linked.pdf', action: 'preview', signal: new AbortController().signal });
    expect(openFilePreview).toHaveBeenCalledOnce();
  });

  it.each([404, 403, 409, 503])('rejects unavailable Activity targets before opening a preview (%s)', async code => {
    const error = Object.assign(new Error('Specific file error'), { code });
    const openFilePreview = vi.fn(async () => undefined);
    const checkFileReadable = vi.fn(async () => { throw error; });
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview, checkFileReadable, openFileBrowserAtPath: vi.fn(),
      notifyInvalidFilePath: vi.fn(), notifyInvalidDirectoryPath: vi.fn(),
    });
    await expect(navigation.openMessageFile({ path: '/workspace/gone.txt', action: 'preview' })).rejects.toBe(error);
    await expect(navigation.openLinkedFilePreview({ ...request, path: '/workspace/gone.txt' })).rejects.toBe(error);
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it('opens reauthorized canonical targets through the existing host controllers', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview,
      openFileBrowserAtPath,
      notifyInvalidFilePath: vi.fn(),
      notifyInvalidDirectoryPath: vi.fn(),
    });

    await navigation.openCanonicalReferenceTarget({
      kind: 'file',
      label: 'app.ts',
      path: '/workspace/src/app.ts',
    });
    await navigation.openCanonicalReferenceTarget({
      kind: 'directory',
      label: 'Source files',
      path: '/workspace/src',
    });

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
      title: 'Source files',
      openStrategy: 'focus_latest_or_create',
    });
  });

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

  it('routes message images to the reusable preview and their parent directory', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const navigation = createFlowerLinkedContextNavigation({ openFilePreview, openFileBrowserAtPath, notifyInvalidFilePath: vi.fn(), notifyInvalidDirectoryPath: vi.fn() });
    await navigation.openMessageFile({ path: '/workspace/images/chart.png', action: 'preview' });
    expect(openFilePreview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/workspace/images/chart.png', type: 'file' }), { focus: true, reusePolicy: 'same_file_or_create' });
    expect(openFileBrowserAtPath).not.toHaveBeenCalled();
    await navigation.openMessageFile({ path: '/workspace/images/chart.png', action: 'reveal' });
    expect(openFileBrowserAtPath).toHaveBeenCalledExactlyOnceWith('/workspace/images', expect.objectContaining({ openStrategy: 'focus_latest_or_create' }));
    expect(openFilePreview).toHaveBeenCalledTimes(1);
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
    await navigation.openCanonicalReferenceTarget({ kind: 'file', label: 'app.ts', path: 'relative/app.ts' });
    await navigation.openCanonicalReferenceTarget({ kind: 'directory', label: 'src', path: '' });

    expect(notifyInvalidFilePath).toHaveBeenCalledTimes(2);
    expect(notifyInvalidDirectoryPath).toHaveBeenCalledTimes(2);
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(openFileBrowserAtPath).not.toHaveBeenCalled();
  });
});
