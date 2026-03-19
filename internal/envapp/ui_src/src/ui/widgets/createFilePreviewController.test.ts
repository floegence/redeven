import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createFilePreviewController } from './createFilePreviewController';

const openReadFileStreamChannelMock = vi.fn();
const readFileBytesOnceMock = vi.fn();

vi.mock('../utils/fileStreamReader', () => ({
  openReadFileStreamChannel: (...args: unknown[]) => openReadFileStreamChannelMock(...args),
  readFileBytesOnce: (...args: unknown[]) => readFileBytesOnceMock(...args),
}));

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function createTextChannel(text: string, truncated = false) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return {
    meta: {
      content_len: bytes.length,
      truncated,
    },
    channel: {
      reader: {
        readExactly: vi.fn(async (size: number) => {
          const next = bytes.slice(offset, offset + size);
          offset += next.length;
          return next;
        }),
      },
      close: vi.fn(async () => undefined),
      stream: {
        reset: vi.fn(),
      },
    },
  };
}

afterEach(() => {
  openReadFileStreamChannelMock.mockReset();
  readFileBytesOnceMock.mockReset();
});

describe('createFilePreviewController', () => {
  it('loads a text preview, tracks dirty state, and saves edits through rpc.fs.writeFile', async () => {
    const file = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;
    const writeFile = vi.fn(async () => ({ success: true }));
    const onSaved = vi.fn();

    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('const value = 1;\n'));

    const [client] = createSignal({} as any);
    const [rpc] = createSignal({ fs: { writeFile } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite, onSaved });
      return disposeRoot;
    });

    try {
      await controller.openPreview(file);
      await flushAsync();

      expect(controller.text()).toBe('const value = 1;\n');
      expect(controller.draftText()).toBe('const value = 1;\n');
      expect(controller.canEdit()).toBe(true);

      controller.beginEditing();
      controller.updateDraft('const value = 2;\n');

      expect(controller.editing()).toBe(true);
      expect(controller.dirty()).toBe(true);

      await controller.saveCurrent();

      expect(writeFile).toHaveBeenCalledWith({
        path: '/workspace/demo.ts',
        content: 'const value = 2;\n',
        encoding: 'utf8',
        createDirs: false,
      });
      expect(controller.text()).toBe('const value = 2;\n');
      expect(controller.draftText()).toBe('const value = 2;\n');
      expect(controller.dirty()).toBe(false);
      expect(onSaved).toHaveBeenCalledWith('/workspace/demo.ts');
    } finally {
      dispose();
    }
  });

  it('requires confirmation before discarding dirty changes when opening another file or closing', async () => {
    const firstFile = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;
    const secondFile = { id: '/workspace/demo.toml', name: 'demo.toml', path: '/workspace/demo.toml', type: 'file' } satisfies FileItem;

    openReadFileStreamChannelMock
      .mockResolvedValueOnce(createTextChannel('const value = 1;\n'))
      .mockResolvedValueOnce(createTextChannel('title = "redeven"\n'));

    const [client] = createSignal({} as any);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(firstFile);
      await flushAsync();

      controller.beginEditing();
      controller.updateDraft('const value = 2;\n');
      await controller.openPreview(secondFile);

      expect(controller.closeConfirmOpen()).toBe(true);
      expect(controller.closeConfirmMessage()).toContain('demo.ts');
      expect(controller.closeConfirmMessage()).toContain('demo.toml');
      expect(controller.item()?.path).toBe('/workspace/demo.ts');

      await controller.confirmDiscardAndContinue();
      await flushAsync();

      expect(controller.closeConfirmOpen()).toBe(false);
      expect(controller.item()?.path).toBe('/workspace/demo.toml');
      expect(controller.text()).toBe('title = "redeven"\n');
      expect(controller.dirty()).toBe(false);

      controller.beginEditing();
      controller.updateDraft('title = "changed"\n');
      controller.closePreview();

      expect(controller.closeConfirmOpen()).toBe(true);
      expect(controller.closeConfirmMessage()).toContain('close the preview');

      await controller.confirmDiscardAndContinue();

      expect(controller.open()).toBe(false);
      expect(controller.item()).toBe(null);
    } finally {
      dispose();
    }
  });
});
