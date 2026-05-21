import type { Accessor } from 'solid-js';

export type DownloadEntryKind = 'file';

export type RuntimeFileDownloadSourceSpec = Readonly<{
  kind: 'runtime_file';
  path: string;
  name: string;
  size?: number;
  modifiedAt?: number;
  mime?: string;
}>;

export type DraftTextDownloadSourceSpec = Readonly<{
  kind: 'draft_text';
  path: string;
  name: string;
  text: string;
  mime?: string;
}>;

export type DownloadSourceSpec = RuntimeFileDownloadSourceSpec | DraftTextDownloadSourceSpec;

export type DownloadCommandOrigin =
  | 'file_browser_context_menu'
  | 'file_browser_toolbar'
  | 'file_preview'
  | 'workbench_preview';

export type DownloadCommand = Readonly<{
  source: DownloadSourceSpec;
  entryKind: DownloadEntryKind;
  origin: DownloadCommandOrigin;
  preferredName?: string;
}>;

export type DownloadTaskStatus =
  | 'queued'
  | 'choosing_destination'
  | 'streaming'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type DownloadPlatformKind =
  | 'desktop_file_system'
  | 'web_file_system'
  | 'web_blob';

export type DownloadErrorCode =
  | 'permission_denied'
  | 'source_unavailable'
  | 'destination_unavailable'
  | 'write_failed'
  | 'canceled'
  | 'unknown';

export type DownloadErrorPresentation = Readonly<{
  code: DownloadErrorCode;
  title: string;
  detail?: string;
  retryable: boolean;
}>;

export type DownloadDestinationPresentation = Readonly<{
  label: string;
  detail?: string;
  canReveal: boolean;
  canOpen: boolean;
  actions?: Readonly<{
    reveal?: () => Promise<void>;
    open?: () => Promise<void>;
  }>;
}>;

export type DownloadTask = Readonly<{
  id: string;
  command: DownloadCommand;
  platform: DownloadPlatformKind;
  status: DownloadTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  bytesRead: number;
  totalBytes?: number;
  progressRatio?: number;
  bytesPerSecond?: number;
  destination?: DownloadDestinationPresentation;
  error?: DownloadErrorPresentation;
  cancelable: boolean;
}>;

export interface RuntimeDownloadSource {
  open(command: DownloadCommand, signal: AbortSignal): Promise<{
    totalBytes?: number;
    chunks: AsyncIterable<Uint8Array<ArrayBuffer>>;
  }>;
}

export interface DownloadSink {
  readonly kind: DownloadPlatformKind;
  prepare(task: DownloadTask, signal: AbortSignal): Promise<PreparedDownloadSink>;
}

export interface PreparedDownloadSink {
  destination: DownloadDestinationPresentation;
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void>;
  complete(): Promise<DownloadDestinationPresentation>;
  abort(reason: 'canceled' | 'failed'): Promise<void>;
}

export type DownloadTaskPatch = Partial<Omit<DownloadTask, 'id' | 'command' | 'platform' | 'createdAt'>>;

export interface DownloadTaskStore {
  readonly tasks: Accessor<readonly DownloadTask[]>;
  readonly activeCount: Accessor<number>;
  readonly latestTask: Accessor<DownloadTask | null>;
  getTask(id: string): DownloadTask | undefined;
  addTask(task: DownloadTask): void;
  patchTask(id: string, patch: DownloadTaskPatch): void;
  clearFinished(): void;
}

export interface DownloadManager extends Pick<DownloadTaskStore, 'tasks' | 'activeCount' | 'latestTask' | 'getTask' | 'clearFinished'> {
  enqueue(command: DownloadCommand): string;
  cancel(taskId: string): void;
  retry(taskId: string): string | null;
  reveal(taskId: string): Promise<void>;
  open(taskId: string): Promise<void>;
}
