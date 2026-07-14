import { For, Show, createMemo, type Component } from 'solid-js';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  Refresh,
  X,
  XCircle,
} from '@floegence/floe-webapp-core/icons';

import type { DownloadManager, DownloadTask, DownloadTaskStatus } from './types';
import { useI18n, type I18nHelpers } from '../i18n';

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

function statusLabel(task: DownloadTask, i18n: I18nHelpers): string {
  switch (task.status) {
    case 'queued':
      return i18n.t('uiCopy.downloads.queued');
    case 'choosing_destination':
      return i18n.t('uiCopy.downloads.choosingDestination');
    case 'streaming':
      return typeof task.progressRatio === 'number'
        ? `${Math.round(task.progressRatio * 100)}%`
        : i18n.t('uiCopy.downloads.downloading');
    case 'finalizing':
      return i18n.t('uiCopy.downloads.finishing');
    case 'completed':
      return task.platform === 'web_blob'
        ? i18n.t('uiCopy.downloads.handedToBrowser')
        : i18n.t('uiCopy.downloads.completed');
    case 'failed':
      return i18n.t('common.status.failed');
    case 'canceled':
      return i18n.t('uiCopy.downloads.canceled');
  }
}

function taskMeta(task: DownloadTask, i18n: I18nHelpers): string {
  if (task.status === 'failed') {
    return task.error?.detail || task.error?.title || i18n.t('uiCopy.downloads.failedMessage');
  }
  if (task.destination?.detail) {
    return task.destination.detail;
  }
  const path = compact(task.command.source.path);
  return path || task.destination?.label || i18n.t('uiCopy.downloads.preparingDestination');
}

function progressWidth(task: DownloadTask): string {
  if (typeof task.progressRatio !== 'number') {
    return '0%';
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
  icon: Component<{ class?: string }>;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      title={props.label}
      class={`inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition-all duration-100 active:scale-[0.97] ${
        props.tone === 'danger'
          ? 'text-destructive/70 hover:text-destructive hover:bg-destructive/10 active:bg-destructive/15'
          : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent active:bg-accent/80'
      }`}
      onClick={props.onClick}
    >
      <props.icon class="size-3.5" />
    </button>
  );
}

export function DownloadTaskPanel(props: { manager: DownloadManager }) {
  const i18n = useI18n();
  const tasks = () => props.manager.tasks();
  const hasFinished = createMemo(() => tasks().some((task) => !ACTIVE_STATUSES.has(task.status)));

  return (
    <section
      role="dialog"
      aria-label={i18n.t('uiCopy.downloads.title')}
      class="w-[min(25rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div class="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold leading-5">{i18n.t('uiCopy.downloads.title')}</h2>
          <p class="text-[11px] text-muted-foreground">
            <Show when={props.manager.activeCount() > 0} fallback={i18n.t('uiCopy.downloads.noActive')}>
              {i18n.tn('uiCopy.downloads.activeCount', props.manager.activeCount())}
            </Show>
          </p>
        </div>
        <Show when={hasFinished()}>
          <button
            type="button"
            class="cursor-pointer rounded-md border border-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70 transition-all duration-100 hover:border-border/70 hover:bg-accent hover:text-foreground active:scale-[0.97]"
            onClick={() => props.manager.clearFinished()}
          >
            {i18n.t('uiCopy.downloads.clearFinished')}
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
            <div class="text-sm font-semibold">{i18n.t('uiCopy.downloads.emptyTitle')}</div>
            <div class="max-w-[18rem] text-xs leading-5 text-muted-foreground">
              {i18n.t('uiCopy.downloads.emptyDescription')}
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
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1" title={taskName(task)}>
                    <div class="truncate text-sm font-semibold leading-5">{taskName(task)}</div>
                  </div>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <Show when={task.status === 'completed' && task.destination?.canReveal}>
                      <DownloadTaskAction
                        icon={FolderOpen}
                        label={i18n.t('uiCopy.downloads.reveal')}
                        onClick={() => {
                          void props.manager.reveal(task.id);
                        }}
                      />
                    </Show>
                    <Show when={task.status === 'completed' && task.destination?.canOpen}>
                      <DownloadTaskAction
                        icon={ExternalLink}
                        label={i18n.t('common.actions.open')}
                        onClick={() => {
                          void props.manager.open(task.id);
                        }}
                      />
                    </Show>
                    <Show when={task.cancelable && ACTIVE_STATUSES.has(task.status)}>
                      <DownloadTaskAction
                        icon={X}
                        label={i18n.t('common.actions.cancel')}
                        tone="danger"
                        onClick={() => props.manager.cancel(task.id)}
                      />
                    </Show>
                    <Show when={task.status === 'failed' || task.status === 'canceled'}>
                      <DownloadTaskAction
                        icon={Refresh}
                        label={i18n.t('common.actions.retry')}
                        onClick={() => props.manager.retry(task.id)}
                      />
                    </Show>
                    <div class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${
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
                      {statusLabel(task, i18n)}
                    </div>
                  </div>
                </div>

                <div class="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground/80" title={taskMeta(task, i18n)}>
                  {taskMeta(task, i18n)}
                </div>

                <Show when={task.status === 'streaming' || task.status === 'finalizing'}>
                  <div class="mt-2.5">
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        class="h-full rounded-full bg-primary transition-all duration-150"
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

                <Show when={task.status === 'completed'}>
                  <div class="mt-2 text-[11px] tabular-nums text-muted-foreground">
                    {formatDownloadBytes(task.bytesRead)}
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.manager.activeCount() === 0 && tasks().some((task) => task.status === 'completed')}>
        <div class="flex items-center gap-2 border-t border-border/70 px-3 py-2.5 text-[11px] text-muted-foreground">
          <CheckCircle class="size-3.5 text-success" />
          <span>{i18n.t('uiCopy.downloads.allFinished')}</span>
        </div>
      </Show>
    </section>
  );
}
