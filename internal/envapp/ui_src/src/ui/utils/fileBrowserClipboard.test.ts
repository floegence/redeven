import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { copyFileBrowserItemNames, describeCopiedFileBrowserItemNames } from './fileBrowserClipboard';

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText,
      },
    },
  });
}

describe('fileBrowserClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  it('copies a single file name and returns the single-name message payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const result = await copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ]);

    expect(writeText).toHaveBeenCalledWith('.env');
    expect(result).toEqual({ count: 1, firstName: '.env' });
    expect(describeCopiedFileBrowserItemNames(result)).toBe('".env" copied to clipboard.');
  });

  it('copies multiple file names as newline-separated text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const result = await copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
      { id: '2', name: 'src', type: 'folder', path: '/workspace/src' } satisfies FileItem,
    ]);

    expect(writeText).toHaveBeenCalledWith('.env\nsrc');
    expect(result).toEqual({ count: 2, firstName: '.env' });
    expect(describeCopiedFileBrowserItemNames(result)).toBe('2 names copied to clipboard.');
  });

  it('fails when there is no copyable name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyFileBrowserItemNames([
      { id: '1', name: '   ', type: 'file', path: '/workspace/blank' } satisfies FileItem,
    ])).rejects.toThrow('No file or folder name available to copy.');

    expect(writeText).not.toHaveBeenCalled();
  });

  it('fails when the clipboard API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });

    await expect(copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ])).rejects.toThrow('Clipboard is not available.');
  });
});
