// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTask } from './types';
import { createWebBlobSink, createWebFileSystemSink } from './downloadSinks';

function task(): DownloadTask {
  return {
    id: 'download-1',
    command: {
      entryKind: 'file',
      origin: 'file_preview',
      preferredName: 'report.txt',
      source: {
        kind: 'runtime_file',
        path: '/workspace/report.txt',
        name: 'report.txt',
        mime: 'text/plain',
      },
    },
    platform: 'web_blob',
    status: 'queued',
    createdAt: 1,
    bytesRead: 0,
    cancelable: true,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('download sinks', () => {
  it('writes Web File System Access downloads in stream order', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const ownerWindow = {
      showSaveFilePicker: vi.fn(async () => ({
        name: 'report.txt',
        createWritable: vi.fn(async () => ({ write, close, abort })),
      })),
    } as any;

    const prepared = await createWebFileSystemSink(ownerWindow).prepare(task(), new AbortController().signal);
    await prepared.write(new Uint8Array([1, 2]));
    await prepared.write(new Uint8Array([3]));
    const destination = await prepared.complete();

    expect(ownerWindow.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'report.txt' });
    expect(write).toHaveBeenNthCalledWith(1, new Uint8Array([1, 2]));
    expect(write).toHaveBeenNthCalledWith(2, new Uint8Array([3]));
    expect(close).toHaveBeenCalledTimes(1);
    expect(destination).toMatchObject({
      label: 'report.txt',
      canReveal: false,
      canOpen: false,
    });
  });

  it('hands Web Blob downloads to the browser and revokes the URL', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:download');
    const revokeObjectURL = vi.fn(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const prepared = await createWebBlobSink(document).prepare(task(), new AbortController().signal);
    await prepared.write(new Uint8Array([65]));
    await prepared.write(new Uint8Array([66]));
    const destination = await prepared.complete();

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(destination.detail).toBe('Handed to browser downloads');
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });
});
