import { For, Show, createMemo } from 'solid-js';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  XCircle,
} from '@floegence/floe-webapp-core/icons';

import type { DownloadManager, DownloadTask, DownloadTaskStatus } from './types';

const ACTIVE_STATUSES = new Set<DownloadTaskStatus>([
  'queued',
  'choosing_destination',
  'streaming',
  'finalizing',
]);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function formatDownloadBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let amount = Math.max(0, value);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || amount >= 10 || Number.isInteger(amount) ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function taskName(task: DownloadTask): string {
  return compact(task.command.preferredName)
    || compact(task.command.source.name)
    || 'download';
}

function statusLabel(task: DownloadTask): string {
  switch (task.status) {
    case 'queued':
      return 'Queued';
    case 'choosing_destination':
      return 'Choosing destination';
    case 'streaming':
      return typeof task.progressRatio === 'number'
        ? `${Math.round(task.progressRatio * 100)}%`
        : 'Downloading';
    case 'finalizing':
      return 'Finishing';
    case 'completed':
      return task.platform === 'web_blob' ? 'Handed to browser' : 'Completed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
  }
}

function taskMeta(task: DownloadTask): string {
  if (task.status === 'failed') {
    return task.error?.detail || task.error?.title || 'Download failed.';
  }
  if (task.destination?.detail) {
    return task.destination.detail;
  }
  const path = compact(task.command.source.path);
  return path || task.destination?.label || 'Preparing destination';
}

function progressWidth(task: DownloadTask): string {
  if (typeof task.progressRatio !== 'number') {
    return task.status === 'completed' ? '100%' : '0%';
  }
  return `${Math.round(Math.min(1, Math.max(0, task.progressRatio)) * 100)}%`;
}

function speedLabel(task: DownloadTask): string {
  if (task.status !== 'streaming' || typeof task.bytesPerSecond !== 'number' || task.bytesPerSecond <= 0) {
    return '';
  }
  return `${formatDownloadBytes(task.bytesPerSecond)}/s`;
}

function DownloadTaskAction(props: {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      class={`inline-flex h-7 cursor-pointer items-center justify-center rounded-md border px-2.5 text-[11px] font-medium transition-all duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        props.tone === 'danger'
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10 active:bg-destructive/15'
          : 'border-border/70 text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/80'
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function DownloadTaskPanel(props: { manager: DownloadManager }) {
  const tasks = () => props.manager.tasks();
  const hasFinished = createMemo(() => tasks().some((task) => !ACTIVE_STATUSES.has(task.status)));

  return (
    <section
      role="dialog"
      aria-label="Downloads"
      class="w-[min(25rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div class="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold leading-5">Downloads</h2>
          <p class="text-[11px] text-muted-foreground">
            <Show when={props.manager.activeCount() > 0} fallback="No active downloads">
              {props.manager.activeCount()} active
            </Show>
          </p>
        </div>
        <Show when={hasFinished()}>
          <button
            type="button"
            class="cursor-pointer rounded-md border border-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70 transition-all duration-100 hover:border-border/70 hover:bg-accent hover:text-foreground active:scale-[0.97]"
            onClick={() => props.manager.clearFinished()}
          >
            Clear finished
          </button>
        </Show>
      </div>

      <Show
        when={tasks().length > 0}
        fallback={(
          <div class="flex min-h-[10rem] flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
            <div class="flex size-10 items-center justify-center rounded-full bg-muted">
              <Download class="size-5 text-muted-foreground/60" />
            </div>
            <div class="text-sm font-semibold">No downloads yet</div>
            <div class="max-w-[18rem] text-xs leading-5 text-muted-foreground">
              Downloads from Files and Preview will appear here.
            </div>
          </div>
        )}
      >
        <div class="max-h-[min(30rem,calc(100vh-8rem))] space-y-1.5 overflow-y-auto p-2">
          <For each={tasks()}>
            {(task) => (
              <article
                data-download-task-id={task.id}
                data-download-task-status={task.status}
                class="rounded-lg border border-border/60 bg-background p-3 transition-opacity duration-150 animate-in fade-in"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-semibold leading-5" title={taskName(task)}>{taskName(task)}</div>
                    <div class="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground/80" title={taskMeta(task)}>
                      {taskMeta(task)}
                    </div>
                  </div>
                  <div class={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${
                    task.status === 'failed'
                      ? 'bg-destructive/10 text-destructive'
                      : task.status === 'completed'
                        ? 'bg-success/10 text-success'
                        : task.status === 'canceled'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary/10 text-primary'
                  }`}>
                    <Show when={task.status === 'queued' || task.status === 'choosing_destination'}>
                      <span class="animate-pulse"><Clock class="size-3" /></span>
                    </Show>
                    <Show when={task.status === 'streaming' || task.status === 'finalizing'}>
                      <Clock class="size-3" />
                    </Show>
                    <Show when={task.status === 'completed'}>
                      <CheckCircle class="size-3" />
                    </Show>
                    <Show when={task.status === 'failed'}>
                      <AlertCircle class="size-3" />
                    </Show>
                    <Show when={task.status === 'canceled'}>
                      <XCircle class="size-3" />
                    </Show>
                    {statusLabel(task)}
                  </div>
                </div>

                <Show when={task.status === 'streaming' || task.status === 'finalizing' || task.status === 'completed'}>
                  <div class="mt-2.5">
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        class={`h-full rounded-full transition-all duration-150 ${
                          task.status === 'completed'
                            ? 'bg-success'
                            : task.status === 'streaming'
                              ? 'bg-primary'
                              : 'bg-primary/80'
                        }`}
                        style={{ width: progressWidth(task) }}
                      />
                    </div>
                    <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span class="tabular-nums">
                        {formatDownloadBytes(task.bytesRead)}
                        <Show when={typeof task.totalBytes === 'number'}>
                          <span class="text-muted-foreground/60"> / {formatDownloadBytes(task.totalBytes)}</span>
                        </Show>
                      </span>
                      <Show when={task.status === 'streaming' && speedLabel(task)}>
                        <span class="tabular-nums">{speedLabel(task)}</span>
                      </Show>
                    </div>
                  </div>
                </Show>

                <div class="mt-2.5 flex flex-wrap justify-end gap-1.5">
                  <Show when={task.cancelable && ACTIVE_STATUSES.has(task.status)}>
                    <DownloadTaskAction
                      label="Cancel"
                      tone="danger"
                      onClick={() => props.manager.cancel(task.id)}
                    />
                  </Show>
                  <Show when={task.status === 'failed' || task.status === 'canceled'}>
                    <DownloadTaskAction
                      label="Retry"
                      onClick={() => props.manager.retry(task.id)}
                    />
                  </Show>
                  <Show when={task.status === 'completed' && task.destination?.canReveal}>
                    <DownloadTaskAction
                      label="Reveal"
                      onClick={() => {
                        void props.manager.reveal(task.id);
                      }}
                    />
                  </Show>
                  <Show when={task.status === 'completed' && task.destination?.canOpen}>
                    <DownloadTaskAction
                      label="Open"
                      onClick={() => {
                        void props.manager.open(task.id);
                      }}
                    />
                  </Show>
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.manager.activeCount() === 0 && tasks().some((task) => task.status === 'completed')}>
        <div class="flex items-center gap-2 border-t border-border/70 px-3 py-2.5 text-[11px] text-muted-foreground">
          <CheckCircle class="size-3.5 text-success" />
          <span>All downloads are finished.</span>
        </div>
      </Show>
    </section>
  );
}
