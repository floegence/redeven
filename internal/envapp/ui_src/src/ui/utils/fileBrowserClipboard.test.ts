// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import {
  copyFileBrowserItemNames,
  copyFileBrowserItemPaths,
  describeCopiedFileBrowserItemNames,
  describeCopiedFileBrowserItemPaths,
} from './fileBrowserClipboard';

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

function stubClipboardUnavailable() {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {},
  });
}

function stubLegacyClipboard(execCommand: ReturnType<typeof vi.fn>) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommand,
  });
}

describe('fileBrowserClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { navigator?: Navigator }).navigator;
    delete (document as Partial<Document> & { execCommand?: (commandId: string) => boolean }).execCommand;
    document.body.innerHTML = '';
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

  it('copies a single absolute path and returns the single-path message payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const result = await copyFileBrowserItemPaths([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ]);

    expect(writeText).toHaveBeenCalledWith('/workspace/.env');
    expect(result).toEqual({ count: 1, firstPath: '/workspace/.env' });
    expect(describeCopiedFileBrowserItemPaths(result)).toBe('"/workspace/.env" copied to clipboard.');
  });

  it('copies multiple absolute paths as newline-separated text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const result = await copyFileBrowserItemPaths([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
      { id: '2', name: 'src', type: 'folder', path: '/workspace/src' } satisfies FileItem,
    ]);

    expect(writeText).toHaveBeenCalledWith('/workspace/.env\n/workspace/src');
    expect(result).toEqual({ count: 2, firstPath: '/workspace/.env' });
    expect(describeCopiedFileBrowserItemPaths(result)).toBe('2 paths copied to clipboard.');
  });

  it('fails when there is no copyable name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyFileBrowserItemNames([
      { id: '1', name: '   ', type: 'file', path: '/workspace/blank' } satisfies FileItem,
    ])).rejects.toThrow('No file or folder name available to copy.');

    expect(writeText).not.toHaveBeenCalled();
  });

  it('fails when there is no copyable absolute path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyFileBrowserItemPaths([
      { id: '1', name: 'blank', type: 'file', path: '   ' } satisfies FileItem,
    ])).rejects.toThrow('No absolute file or folder path available to copy.');

    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the legacy clipboard path when the async clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    stubClipboardUnavailable();
    stubLegacyClipboard(execCommand);

    const result = await copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ]);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(result).toEqual({ count: 1, firstName: '.env' });
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('falls back to the legacy clipboard path when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    const execCommand = vi.fn().mockReturnValue(true);
    stubClipboard(writeText);
    stubLegacyClipboard(execCommand);

    const result = await copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ]);

    expect(writeText).toHaveBeenCalledWith('.env');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(result).toEqual({ count: 1, firstName: '.env' });
  });

  it('fails when no clipboard implementation is available', async () => {
    stubClipboardUnavailable();

    await expect(copyFileBrowserItemNames([
      { id: '1', name: '.env', type: 'file', path: '/workspace/.env' } satisfies FileItem,
    ])).rejects.toThrow('Clipboard is not available.');
  });
});
