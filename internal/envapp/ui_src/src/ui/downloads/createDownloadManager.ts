import type {
  DownloadCommand,
  DownloadErrorCode,
  DownloadErrorPresentation,
  DownloadManager,
  DownloadSink,
  DownloadTaskPatch,
  DownloadTaskStore,
  PreparedDownloadSink,
  RuntimeDownloadSource,
} from './types';
import { createDownloadTaskStore } from './downloadTaskStore';
import { resolveDownloadPlatformSink } from './downloadPlatformResolver';

type DownloadOperationStage =
  | 'destination'
  | 'source'
  | 'write'
  | 'finalize';

type DownloadOperation = {
  controller: AbortController;
  prepared: PreparedDownloadSink | null;
  sink: DownloadSink;
};

export type DownloadManagerOptions = Readonly<{
  source: RuntimeDownloadSource;
  sink?: DownloadSink;
  sinkResolver?: () => DownloadSink;
  store?: DownloadTaskStore;
  now?: () => number;
  createId?: () => string;
}>;

let downloadTaskIdSeq = 0;

function defaultCreateId(): string {
  downloadTaskIdSeq += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `download-${crypto.randomUUID()}`;
  }
  return `download-${Date.now()}-${downloadTaskIdSeq}`;
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function commandInitialTotalBytes(command: DownloadCommand): number | undefined {
  if (command.source.kind === 'draft_text') {
    return new TextEncoder().encode(command.source.text).byteLength;
  }
  return positiveInteger(command.source.size);
}

function progressRatio(bytesRead: number, totalBytes?: number): number | undefined {
  if (typeof totalBytes !== 'number' || totalBytes <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, bytesRead / totalBytes));
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return String(error.message || '').trim();
  }
  return String(error ?? '').trim();
}

function errorCodeForStage(stage: DownloadOperationStage): DownloadErrorCode {
  switch (stage) {
    case 'destination':
      return 'destination_unavailable';
    case 'source':
      return 'source_unavailable';
    case 'write':
    case 'finalize':
      return 'write_failed';
  }
}

function errorPresentation(stage: DownloadOperationStage, error: unknown): DownloadErrorPresentation {
  const message = errorMessage(error);
  const code = errorCodeForStage(stage);
  const title = code === 'source_unavailable'
    ? 'Source unavailable'
    : code === 'destination_unavailable'
      ? 'Destination unavailable'
      : 'Download failed';
  return {
    code,
    title,
    detail: message || undefined,
    retryable: true,
  };
}

function patchProgress(bytesRead: number, totalBytes: number | undefined, now: number, startedAt: number): DownloadTaskPatch {
  const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
  return {
    bytesRead,
    totalBytes,
    progressRatio: progressRatio(bytesRead, totalBytes),
    bytesPerSecond: bytesRead / elapsedSeconds,
  };
}

export function createDownloadManager(options: DownloadManagerOptions): DownloadManager {
  const store = options.store ?? createDownloadTaskStore();
  const now = options.now ?? (() => Date.now());
  const createId = options.createId ?? defaultCreateId;
  const resolveSink = options.sinkResolver ?? (() => options.sink ?? resolveDownloadPlatformSink());
  const operations = new Map<string, DownloadOperation>();

  const runTask = async (taskId: string) => {
    const operation = operations.get(taskId);
    const task = store.getTask(taskId);
    if (!operation || !task) return;

    let stage: DownloadOperationStage = 'destination';
    let totalBytes = task.totalBytes;
    let bytesRead = 0;
    let startedAt = task.startedAt ?? now();

    try {
      store.patchTask(taskId, {
        status: 'choosing_destination',
        cancelable: true,
      });

      operation.prepared = await operation.sink.prepare({
        ...task,
        totalBytes,
        status: 'choosing_destination',
        cancelable: true,
      }, operation.controller.signal);

      store.patchTask(taskId, {
        destination: operation.prepared.destination,
        status: 'streaming',
        startedAt,
        cancelable: true,
      });

      stage = 'source';
      const source = await options.source.open(task.command, operation.controller.signal);
      totalBytes = positiveInteger(source.totalBytes) ?? totalBytes;
      if (typeof totalBytes === 'number') {
        store.patchTask(taskId, {
          totalBytes,
          progressRatio: progressRatio(bytesRead, totalBytes),
        });
      }

      stage = 'write';
      for await (const chunk of source.chunks) {
        if (operation.controller.signal.aborted) {
          throw new DOMException('Download canceled.', 'AbortError');
        }
        await operation.prepared.write(chunk);
        bytesRead += chunk.byteLength;
        store.patchTask(taskId, patchProgress(bytesRead, totalBytes, now(), startedAt));
      }

      stage = 'finalize';
      store.patchTask(taskId, {
        status: 'finalizing',
        bytesRead,
        totalBytes: totalBytes ?? bytesRead,
        progressRatio: progressRatio(bytesRead, totalBytes ?? bytesRead),
        cancelable: false,
      });
      const destination = await operation.prepared.complete();
      const completedAt = now();
      store.patchTask(taskId, {
        status: 'completed',
        completedAt,
        bytesRead,
        totalBytes: totalBytes ?? bytesRead,
        progressRatio: 1,
        destination,
        cancelable: false,
      });
    } catch (error) {
      if (operation.prepared) {
        await operation.prepared.abort(isAbortError(error) ? 'canceled' : 'failed').catch(() => undefined);
      }
      const completedAt = now();
      if (isAbortError(error)) {
        store.patchTask(taskId, {
          status: 'canceled',
          completedAt,
          cancelable: false,
          error: undefined,
        });
      } else {
        store.patchTask(taskId, {
          status: 'failed',
          completedAt,
          cancelable: false,
          error: errorPresentation(stage, error),
        });
      }
    } finally {
      operations.delete(taskId);
    }
  };

  const manager: DownloadManager = {
    tasks: store.tasks,
    activeCount: store.activeCount,
    latestTask: store.latestTask,
    getTask: store.getTask,
    clearFinished: store.clearFinished,
    enqueue(command) {
      const sink = resolveSink();
      const taskId = createId();
      const createdAt = now();
      const totalBytes = commandInitialTotalBytes(command);
      store.addTask({
        id: taskId,
        command,
        platform: sink.kind,
        status: 'queued',
        createdAt,
        bytesRead: 0,
        totalBytes,
        progressRatio: progressRatio(0, totalBytes),
        cancelable: true,
      });
      operations.set(taskId, {
        controller: new AbortController(),
        prepared: null,
        sink,
      });
      void runTask(taskId);
      return taskId;
    },
    cancel(taskId) {
      const operation = operations.get(taskId);
      if (operation) {
        operation.controller.abort();
        const prepared = operation.prepared;
        operation.prepared = null;
        if (prepared) {
          void prepared.abort('canceled').catch(() => undefined);
        }
        store.patchTask(taskId, {
          status: 'canceled',
          completedAt: now(),
          cancelable: false,
        });
        return;
      }
      const task = store.getTask(taskId);
      if (task?.cancelable) {
        store.patchTask(taskId, {
          status: 'canceled',
          completedAt: now(),
          cancelable: false,
        });
      }
    },
    retry(taskId) {
      const task = store.getTask(taskId);
      if (!task || (task.status !== 'failed' && task.status !== 'canceled')) {
        return null;
      }
      return manager.enqueue(task.command);
    },
    async reveal(taskId) {
      const task = store.getTask(taskId);
      if (!task?.destination?.actions?.reveal) return;
      await task.destination.actions.reveal();
    },
    async open(taskId) {
      const task = store.getTask(taskId);
      if (!task?.destination?.actions?.open) return;
      await task.destination.actions.open();
    },
  };

  return manager;
}
