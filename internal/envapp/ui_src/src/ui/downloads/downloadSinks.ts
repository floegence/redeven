import type { DownloadSink, DownloadTask, PreparedDownloadSink } from './types';
import {
  abortDesktopDownload,
  completeDesktopDownload,
  desktopDownloadsBridge,
  openDesktopDownload,
  prepareDesktopDownload,
  revealDesktopDownload,
  writeDesktopDownload,
  type DesktopDownloadsBridge,
} from './desktopDownloadBridge';

type FileSystemWritableFileStreamLike = Readonly<{
  write: (data: Uint8Array<ArrayBuffer>) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}>;

type FileSystemFileHandleLike = Readonly<{
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
  name?: string;
}>;

type WindowWithFilePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandleLike>;
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function suggestedName(task: DownloadTask): string {
  return compact(task.command.preferredName)
    || compact(task.command.source.name)
    || 'download';
}

function errorFromResponse(message: string | undefined, fallback: string): Error {
  return new Error(compact(message) || fallback);
}

export function createDesktopFileSink(bridge: DesktopDownloadsBridge): DownloadSink {
  return {
    kind: 'desktop_file_system',
    async prepare(task, signal): Promise<PreparedDownloadSink> {
      if (signal.aborted) {
        throw new DOMException('Download canceled.', 'AbortError');
      }

      const prepared = await prepareDesktopDownload(bridge, {
        task_id: task.id,
        suggested_name: suggestedName(task),
        total_bytes: task.totalBytes,
      });
      if (prepared.canceled) {
        throw new DOMException('Download canceled.', 'AbortError');
      }
      if (!prepared.ok || !prepared.destination) {
        throw errorFromResponse(prepared.message, 'Desktop could not prepare the download.');
      }

      const token = prepared.destination.token;
      const destination = {
        label: prepared.destination.file_name,
        detail: prepared.destination.display_path,
        canReveal: true,
        canOpen: true,
        actions: {
          reveal: async () => {
            const out = await revealDesktopDownload(bridge, { token });
            if (!out.ok) throw errorFromResponse(out.message, 'Desktop could not reveal the download.');
          },
          open: async () => {
            const out = await openDesktopDownload(bridge, { token });
            if (!out.ok) throw errorFromResponse(out.message, 'Desktop could not open the download.');
          },
        },
      };

      return {
        destination,
        async write(chunk) {
          const out = await writeDesktopDownload(bridge, { token, chunk });
          if (!out.ok) throw errorFromResponse(out.message, 'Desktop could not write the download.');
        },
        async complete() {
          const out = await completeDesktopDownload(bridge, { token });
          if (!out.ok || !out.destination) {
            throw errorFromResponse(out.message, 'Desktop could not finish the download.');
          }
          return {
            ...destination,
            label: out.destination.file_name,
            detail: out.destination.display_path,
          };
        },
        async abort(reason) {
          await abortDesktopDownload(bridge, { token, reason });
        },
      };
    },
  };
}

export function createWebFileSystemSink(ownerWindow: WindowWithFilePicker): DownloadSink {
  return {
    kind: 'web_file_system',
    async prepare(task, signal): Promise<PreparedDownloadSink> {
      if (signal.aborted) {
        throw new DOMException('Download canceled.', 'AbortError');
      }
      if (typeof ownerWindow.showSaveFilePicker !== 'function') {
        throw new Error('Browser file picker is unavailable.');
      }

      const handle = await ownerWindow.showSaveFilePicker({ suggestedName: suggestedName(task) });
      const writable = await handle.createWritable();
      const destination = {
        label: compact(handle.name) || suggestedName(task),
        detail: 'Browser selected destination',
        canReveal: false,
        canOpen: false,
      };

      return {
        destination,
        write: (chunk) => writable.write(chunk),
        complete: async () => {
          await writable.close();
          return destination;
        },
        abort: async () => {
          if (typeof writable.abort === 'function') {
            await writable.abort();
          }
        },
      };
    },
  };
}

export function createWebBlobSink(ownerDocument: Document): DownloadSink {
  return {
    kind: 'web_blob',
    async prepare(task): Promise<PreparedDownloadSink> {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const name = suggestedName(task);
      const ownerWindow = ownerDocument.defaultView ?? window;
      const destination = {
        label: name,
        detail: 'Preparing browser download',
        canReveal: false,
        canOpen: false,
      };

      return {
        destination,
        async write(chunk) {
          chunks.push(chunk);
        },
        async complete() {
          const blob = new Blob(chunks, {
            type: compact(task.command.source.mime) || 'application/octet-stream',
          });
          const url = ownerWindow.URL.createObjectURL(blob);
          const anchor = ownerDocument.createElement('a');
          anchor.href = url;
          anchor.download = name;
          anchor.rel = 'noopener';
          anchor.click();
          ownerWindow.setTimeout(() => ownerWindow.URL.revokeObjectURL(url), 0);
          return {
            ...destination,
            detail: 'Handed to browser downloads',
          };
        },
        async abort() {
          chunks.splice(0, chunks.length);
        },
      };
    },
  };
}

export function resolveDownloadSink(): DownloadSink {
  const desktopBridge = desktopDownloadsBridge();
  if (desktopBridge) {
    return createDesktopFileSink(desktopBridge);
  }

  const ownerWindow = window as WindowWithFilePicker;
  if (typeof ownerWindow.showSaveFilePicker === 'function') {
    return createWebFileSystemSink(ownerWindow);
  }

  return createWebBlobSink(document);
}
