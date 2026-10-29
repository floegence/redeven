import { createComputed, createRoot } from 'solid-js';
import type { FlowerSurfaceAdapter } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { DownloadManager, FlowerFileDownloadSourceSpec } from './types';
import { openFlowerTaskFile, type FlowerTaskFileChunk } from './flowerTaskFileDownload';

type FlowerDownloadReaders = {
  readTaskFile: (threadID: string, path: string, working: boolean, offset: number, signal: AbortSignal) => Promise<FlowerTaskFileChunk>;
  loadAttachment: (url: string, signal: AbortSignal) => Promise<Blob>;
};

/** The manager owns transfer lifetime; the dialog only observes completion feedback. */
function enqueue(manager: DownloadManager, source: FlowerFileDownloadSourceSpec): Promise<void> {
  const id = manager.enqueue({ source, entryKind: 'file', origin: 'flower_task_files' });
  return new Promise((resolve, reject) => createRoot(dispose => {
    createComputed(() => {
      const task = manager.tasks().find(item => item.id === id);
      if (!task || task.status === 'completed' || task.status === 'canceled') { dispose(); resolve(); }
      else if (task.status === 'failed') { dispose(); reject(new Error(task.error?.detail || task.error?.title)); }
    });
  }));
}

export function createFlowerDownloads(manager: DownloadManager, readers: FlowerDownloadReaders): Required<Pick<FlowerSurfaceAdapter,
  'downloadTaskFile' | 'downloadTaskMaterial' | 'hasActiveTaskFileDownloads'>> {
  return {
    hasActiveTaskFileDownloads: threadID => manager.tasks().some(task => task.command.source.kind === 'flower_file'
      && task.command.source.threadID === threadID && !['completed', 'failed', 'canceled'].includes(task.status)),
    downloadTaskFile: (threadID, path, working) => enqueue(manager, {
      kind: 'flower_file', threadID, path, name: path.split(/[\\/]/).pop() || 'download',
      open: signal => openFlowerTaskFile(offset => readers.readTaskFile(threadID, path, working, offset, signal), signal),
    }),
    downloadTaskMaterial: (threadID, item) => enqueue(manager, {
      kind: 'flower_file', threadID, path: '', name: item.name, size: item.size, mime: item.mime,
      open: async signal => {
        signal.throwIfAborted();
        const blob = await readers.loadAttachment(item.url, signal);
        signal.throwIfAborted();
        return { totalBytes: blob.size, chunks: (async function* () {
          const reader = blob.stream().getReader();
          try {
            for (;;) {
              signal.throwIfAborted();
              const next = await reader.read();
              signal.throwIfAborted();
              if (next.done) break;
              yield new Uint8Array(next.value);
            }
          } finally { await reader.cancel(); reader.releaseLock(); }
        })() };
      },
    }),
  };
}
