import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createFilePreviewController } from './createFilePreviewController';

const openReadFileStreamChannelMock = vi.fn();

vi.mock('../utils/fileStreamReader', () => ({
  openReadFileStreamChannel: (...args: unknown[]) => openReadFileStreamChannelMock(...args),
}));

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
});

describe('createFilePreviewController', () => {
  it('opens HTML in page mode and preserves save, discard, and dirty-close behavior', async () => {
    const file = { id: '/workspace/report.html', name: 'report.html', path: '/workspace/report.html', type: 'file' } satisfies FileItem;
    const original = '<h1>Original report</h1>';
    const saved = '<h1>Saved report</h1>';
    const writeFile = vi.fn(async () => ({ success: true }));
    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel(original));
    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot(disposeRoot => {
      controller = createFilePreviewController({ client: () => ({} as any), rpc: () => ({ fs: { writeFile } } as any), canWrite: () => true });
      return disposeRoot;
    });
    try {
      await controller.openPreview(file);
      expect(controller.descriptor().mode).toBe('html');
      expect(controller.text()).toBe(original);
      expect(controller.editing()).toBe(false);
      expect(controller.canEdit()).toBe(true);
      controller.beginEditing();
      controller.updateDraft(saved);
      expect(controller.dirty()).toBe(true);
      expect(await controller.saveCurrent()).toBe(true);
      expect(writeFile).toHaveBeenCalledWith({ path: file.path, content: saved, encoding: 'utf8', createDirs: false });
      controller.revertCurrent();
      expect(controller.editing()).toBe(false);
      expect(controller.text()).toBe(saved);
      controller.beginEditing();
      controller.updateDraft('<h1>Unsaved report</h1>');
      controller.closePreview();
      expect(controller.closeConfirmOpen()).toBe(true);
      controller.cancelPendingAction();
      controller.revertCurrent();
      expect(controller.draftText()).toBe(saved);
      expect(controller.dirty()).toBe(false);
    } finally { dispose(); }
  });

  it.each([true, false])('rejects incomplete HTML without executing a partial document (known size: %s)', async knownSize => {
    const file = { id: '/report.html', name: 'report.html', path: '/report.html', type: 'file', size: knownSize ? 3 * 1024 * 1024 : undefined } satisfies FileItem;
    const channel = createTextChannel('<script>incomplete', true);
    openReadFileStreamChannelMock.mockResolvedValue(channel);
    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot(disposeRoot => {
      controller = createFilePreviewController({ client: () => ({} as any), rpc: () => undefined, canWrite: () => true });
      return disposeRoot;
    });
    try {
      await controller.openPreview(file);
      expect(controller.descriptor().mode).toBe('unsupported');
      expect(controller.text()).toBe('');
      expect(controller.canEdit()).toBe(false);
      expect(controller.message()).toBe('This file is too large to preview.');
      if (knownSize) expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();
      else expect(channel.channel.close).toHaveBeenCalledOnce();
    } finally { dispose(); }
  });

  it('keeps a PDF draft dirty after a failed binary save and confirms before closing', async () => {
    const file = { id: '/workspace/form.pdf', name: 'form.pdf', path: '/workspace/form.pdf', type: 'file' } satisfies FileItem;
    const writeFile = vi.fn().mockRejectedValueOnce(new Error('Disk is full')).mockResolvedValue({ success: true });
    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('%PDF-1.7 fixture'));
    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot(disposeRoot => {
      controller = createFilePreviewController({ client: () => ({} as any), rpc: () => ({ fs: { writeFile } } as any), canWrite: () => true });
      return disposeRoot;
    });
    try {
      await controller.openPreview(file);
      expect(controller.canEdit()).toBe(true);
      controller.beginEditing();
      const sourceBytes = controller.bytes()!;
      const savedBytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
      const editor = controller.bindPdfEditor({ sourceBytes, save: async () => savedBytes });
      editor.markDirty();
      expect(await controller.saveCurrent()).toBe(false);
      expect(controller.dirty()).toBe(true);
      expect(controller.saveError()).toBe('Disk is full');
      controller.closePreview();
      expect(controller.closeConfirmOpen()).toBe(true);
      controller.cancelPendingAction();
      expect(await controller.saveCurrent()).toBe(true);
      expect(writeFile).toHaveBeenLastCalledWith({ path: file.path, content: 'JVBERgD/', encoding: 'base64', createDirs: false });
      expect(controller.dirty()).toBe(false);
      // A successful save must not replace the active bytes and jump back to page one.
      expect(controller.bytes()).toBe(sourceBytes);
      editor.markDirty();
      controller.revertCurrent();
      expect(controller.bytes()).toEqual(savedBytes);
      expect(controller.editing()).toBe(false);
      editor.markDirty();
      expect(controller.dirty()).toBe(false);
    } finally { dispose(); }
  });

  it('rejects stale PDF editors and rechecks write permission after serialization', async () => {
    const file = { id: '/form.pdf', name: 'form.pdf', path: '/form.pdf', type: 'file' } satisfies FileItem;
    const writeFile = vi.fn();
    const bytes = deferred<Uint8Array<ArrayBuffer>>();
    const [canWrite, setCanWrite] = createSignal(true);
    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('%PDF-1.7 fixture'));
    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot(disposeRoot => {
      controller = createFilePreviewController({ client: () => ({} as any), rpc: () => ({ fs: { writeFile } } as any), canWrite });
      return disposeRoot;
    });
    try {
      await controller.openPreview(file);
      controller.beginEditing();
      const editor = controller.bindPdfEditor({ sourceBytes: controller.bytes()!, save: () => bytes.promise });
      editor.markDirty();
      const saving = controller.saveCurrent();
      setCanWrite(false);
      bytes.resolve(new Uint8Array([37, 80, 68, 70]));
      expect(await saving).toBe(false);
      expect(writeFile).not.toHaveBeenCalled();
      expect(controller.dirty()).toBe(true);
      await controller.confirmDiscardAndContinue();
      controller.revertCurrent();
      editor.markDirty();
      expect(controller.dirty()).toBe(false);
    } finally { dispose(); }
  });

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

  it('exits edit mode when discard is pressed before any changes are made', async () => {
    const file = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;

    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('const value = 1;\n'));

    const [client] = createSignal({} as any);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(file);
      await flushAsync();

      controller.beginEditing();

      expect(controller.editing()).toBe(true);
      expect(controller.dirty()).toBe(false);

      controller.revertCurrent();

      expect(controller.editing()).toBe(false);
      expect(controller.dirty()).toBe(false);
      expect(controller.draftText()).toBe('const value = 1;\n');
    } finally {
      dispose();
    }
  });

  it('shows a clear unsupported preview state for broken symlinks without opening a read stream', async () => {
    const brokenLink = {
      id: '/workspace/broken',
      name: 'broken',
      path: '/workspace/broken',
      type: 'file',
      link: { kind: 'symbolic', targetType: 'broken' },
    } satisfies FileItem;

    const [client] = createSignal({} as any);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(brokenLink);

      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();
      expect(controller.open()).toBe(true);
      expect(controller.item()?.path).toBe('/workspace/broken');
      expect(controller.descriptor()).toEqual({ mode: 'unsupported' });
      expect(controller.error()).toBe('This symbolic link target is unavailable.');
      expect(controller.message()).toBe('This symbolic link target is unavailable.');
    } finally {
      dispose();
    }
  });

  it('waits for the connection and retries the latest preview request', async () => {
    const file = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;

    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('const value = 1;\n'));

    const [client, setClient] = createSignal<any>(null);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(file);
      await flushAsync();

      expect(controller.open()).toBe(true);
      expect(controller.item()?.path).toBe('/workspace/demo.ts');
      expect(controller.loading()).toBe(true);
      expect(controller.error()).toBe(null);
      expect(controller.message()).toBe('Waiting for connection...');
      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();

      setClient({ id: 'client-ready' });
      await flushAsync();

      expect(openReadFileStreamChannelMock).toHaveBeenCalledTimes(1);
      expect(openReadFileStreamChannelMock).toHaveBeenCalledWith({
        client: { id: 'client-ready' },
        path: '/workspace/demo.ts',
        offset: 0,
        maxBytes: expect.any(Number),
      });
      expect(controller.loading()).toBe(false);
      expect(controller.error()).toBe(null);
      expect(controller.message()).toBe('');
      expect(controller.text()).toBe('const value = 1;\n');
    } finally {
      dispose();
    }
  });

  it('cancels a connection retry when the preview is closed before the client is ready', async () => {
    const file = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;

    const [client, setClient] = createSignal<any>(null);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(file);
      await flushAsync();

      controller.closePreview();
      setClient({ id: 'client-ready' });
      await flushAsync();

      expect(controller.open()).toBe(false);
      expect(controller.item()).toBe(null);
      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('settles rejected stream teardown promises when an in-flight preview closes', async () => {
    const file = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;
    const read = deferred<Uint8Array<ArrayBuffer>>();
    const reset = vi.fn(() => Promise.reject(new Error('reset rejected during teardown')));
    const close = vi.fn(() => Promise.reject(new Error('close rejected during teardown')));
    openReadFileStreamChannelMock.mockResolvedValue({
      meta: { content_len: 1, truncated: false },
      channel: {
        reader: { readExactly: vi.fn(() => read.promise) },
        stream: { reset },
        close,
      },
    });
    const [client] = createSignal({ id: 'client-ready' } as any);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);
    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      const opening = controller.openPreview(file);
      await vi.waitFor(() => expect(openReadFileStreamChannelMock).toHaveBeenCalledTimes(1));
      controller.closePreview();
      await flushAsync();

      expect(reset).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(controller.open()).toBe(false);

      read.resolve(new Uint8Array([65]));
      await opening;
      await flushAsync();
      expect(controller.open()).toBe(false);
    } finally {
      dispose();
    }
  });

  it('opens media previews as resource URLs without waiting for a Flowersec file stream', async () => {
    const videoFile = {
      id: '/workspace/demo.mp4',
      name: 'demo.mp4',
      path: '/workspace/demo.mp4',
      type: 'file',
      size: 128 * 1024 * 1024,
    } satisfies FileItem;
    const audioFile = {
      id: '/workspace/audio.mp3',
      name: 'audio.mp3',
      path: '/workspace/audio.mp3',
      type: 'file',
    } satisfies FileItem;

    const [client] = createSignal<any>(null);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(videoFile);
      await flushAsync();

      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();
      expect(controller.open()).toBe(true);
      expect(controller.loading()).toBe(false);
      expect(controller.error()).toBe(null);
      expect(controller.message()).toBe('');
      expect(controller.descriptor().mode).toBe('video');
      expect(controller.resourceUrl()).toBe('/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Fdemo.mp4');
      expect(controller.bytes()).toBe(null);
      expect(controller.objectUrl()).toBe('');

      await controller.openPreview(audioFile);
      await flushAsync();

      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();
      expect(controller.descriptor().mode).toBe('audio');
      expect(controller.resourceUrl()).toBe('/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Faudio.mp3');
    } finally {
      dispose();
    }
  });

  it('clears stale media resource URLs when switching back to a byte-loaded preview', async () => {
    const videoFile = { id: '/workspace/demo.mp4', name: 'demo.mp4', path: '/workspace/demo.mp4', type: 'file' } satisfies FileItem;
    const textFile = { id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' } satisfies FileItem;

    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('const value = 1;\n'));

    const [client] = createSignal({ id: 'client-ready' } as any);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(videoFile);
      await flushAsync();
      expect(controller.resourceUrl()).toBe('/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Fdemo.mp4');

      await controller.openPreview(textFile);
      await flushAsync();

      expect(openReadFileStreamChannelMock).toHaveBeenCalledTimes(1);
      expect(controller.descriptor().mode).toBe('text');
      expect(controller.text()).toBe('const value = 1;\n');
      expect(controller.resourceUrl()).toBe('');
    } finally {
      dispose();
    }
  });

  it('loads only the newest pending preview after the connection becomes ready', async () => {
    const firstFile = { id: '/workspace/first.ts', name: 'first.ts', path: '/workspace/first.ts', type: 'file' } satisfies FileItem;
    const secondFile = { id: '/workspace/second.ts', name: 'second.ts', path: '/workspace/second.ts', type: 'file' } satisfies FileItem;

    openReadFileStreamChannelMock.mockResolvedValue(createTextChannel('const second = true;\n'));

    const [client, setClient] = createSignal<any>(null);
    const [rpc] = createSignal({ fs: { writeFile: vi.fn(async () => ({ success: true })) } } as any);
    const [canWrite] = createSignal(true);

    let controller!: ReturnType<typeof createFilePreviewController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createFilePreviewController({ client, rpc, canWrite });
      return disposeRoot;
    });

    try {
      await controller.openPreview(firstFile);
      await controller.openPreview(secondFile);
      await flushAsync();

      expect(controller.item()?.path).toBe('/workspace/second.ts');
      expect(openReadFileStreamChannelMock).not.toHaveBeenCalled();

      setClient({ id: 'client-ready' });
      await flushAsync();

      expect(openReadFileStreamChannelMock).toHaveBeenCalledTimes(1);
      expect(openReadFileStreamChannelMock).toHaveBeenCalledWith(expect.objectContaining({
        path: '/workspace/second.ts',
      }));
      expect(controller.text()).toBe('const second = true;\n');
    } finally {
      dispose();
    }
  });
});
