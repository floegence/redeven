import type { Component } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh, Search, X } from '@floegence/floe-webapp-core/icons';
import { Input, ProcessingIndicator, Tag } from '@floegence/floe-webapp-core/ui';

import type { FlowerThreadListCopy, FlowerThreadTimeGroup } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerThreadListItem, FlowerThreadStatus } from '../contracts/flowerSurfaceContracts';

type TimeGroup = FlowerThreadTimeGroup;

function threadGroupTime(thread: FlowerThreadListItem): number {
  return Number(thread.updated_at_ms || 0);
}

export function groupFlowerThreadsByDate(threads: readonly FlowerThreadListItem[]): { group: TimeGroup; threads: FlowerThreadListItem[] }[] {
  if (threads.length < 5) {
    return [{ group: 'today', threads: [...threads] }];
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86_400_000);
  const groups: Record<TimeGroup, FlowerThreadListItem[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    older: [],
  };
  for (const thread of threads) {
    const ts = threadGroupTime(thread);
    if (ts >= todayStart) {
      groups.today.push(thread);
    } else if (ts >= yesterdayStart) {
      groups.yesterday.push(thread);
    } else if (ts >= weekStart) {
      groups.this_week.push(thread);
    } else {
      groups.older.push(thread);
    }
  }
  return (['today', 'yesterday', 'this_week', 'older'] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, threads: groups[group] }));
}

export function filterFlowerThreadItems(threads: readonly FlowerThreadListItem[], query: string): FlowerThreadListItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...threads];
  return threads.filter((thread) => [
    thread.title,
    thread.preview,
    thread.model_id,
    thread.source_label,
    thread.read_only_reason,
    ...(thread.target_labels ?? []),
  ].join(' ').toLowerCase().includes(needle));
}

function statusDotClass(status: FlowerThreadStatus): string {
  switch (status) {
    case 'running':
      return 'bg-primary';
    case 'waiting_approval':
    case 'waiting_user':
      return 'bg-amber-500';
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-error';
    case 'read_only':
      return 'bg-muted-foreground/50';
    default:
      return 'bg-muted-foreground/30';
  }
}

function statusLabel(status: FlowerThreadStatus, copy: FlowerThreadListCopy): string {
  return copy.statuses[status] ?? copy.statuses.idle;
}

function timeGroupLabel(group: TimeGroup, copy: FlowerThreadListCopy): string {
  return copy.groups[group] ?? copy.groups.older;
}

export function fmtFlowerShortTime(
  ms: number,
  copy: FlowerThreadListCopy = DEFAULT_FLOWER_SURFACE_COPY.threadList,
): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 7) {
    return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(new Date(ms));
  }
  if (days > 0) return copy.days(days);
  if (hours > 0) return copy.hours(hours);
  if (minutes > 0) return copy.minutes(minutes);
  return copy.now;
}

export type FlowerThreadCardProps = Readonly<{
  item: FlowerThreadListItem;
  active: boolean;
  copy?: FlowerThreadListCopy;
  canDelete?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}>;

export const FlowerThreadCard: Component<FlowerThreadCardProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const title = () => props.item.title.trim() || copy().untitled;
  const meta = () => props.item.read_only_reason || props.item.source_label || props.item.model_id;
  const running = () => props.item.status === 'running';

  return (
    <div
      data-flower-thread-card
      data-thread-id={props.item.thread_id}
      class={cn(
        'flower-host-thread-card group relative w-full cursor-pointer rounded-lg border transition-all duration-150',
        props.active && 'flower-host-thread-card-active',
      )}
    >
      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        onClick={props.onSelect}
      >
        <div class="relative mt-1.5 h-2 w-2 shrink-0">
          <div class={cn('h-2 w-2 rounded-full', statusDotClass(props.item.status))} title={statusLabel(props.item.status, copy())} />
          <Show when={running()}>
            <div class="absolute inset-0 h-2 w-2 animate-pulse rounded-full bg-primary/50" />
          </Show>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="flower-host-thread-list-title flex-1 truncate text-xs font-medium">{title()}</span>
          </div>
          <Show when={running()} fallback={<Show when={props.item.preview}><p class="flower-host-thread-card-preview truncate text-[11px] leading-tight">{props.item.preview}</p></Show>}>
            <ProcessingIndicator variant="minimal" status={copy().working} class="h-3.5" />
          </Show>
          <Show when={meta()}>
            <p class="flower-host-thread-card-meta truncate text-[10px] leading-tight">{meta()}</p>
          </Show>
          <Show when={(props.item.target_labels?.length ?? 0) > 0}>
            <div class="mt-1 flex min-w-0 flex-wrap gap-1">
              <For each={props.item.target_labels ?? []}>
                {(label) => <Tag variant="neutral" class="max-w-[9rem] truncate px-1.5 py-0 text-[10px]">{label}</Tag>}
              </For>
            </div>
          </Show>
        </div>
      </button>
      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <Show
          when={props.canDelete && props.onDelete}
          fallback={<span class="flower-host-thread-card-time select-none text-[10px]" aria-hidden="true">{fmtFlowerShortTime(props.item.updated_at_ms, copy())}</span>}
        >
          <span class="flower-host-thread-card-time select-none text-[10px] transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true">
            {fmtFlowerShortTime(props.item.updated_at_ms, copy())}
          </span>
          <button
            type="button"
            class="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all duration-150 hover:bg-error/10 hover:text-error focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={copy().deleteLabel(title())}
            onClick={(event) => {
              event.stopPropagation();
              props.onDelete?.();
            }}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </Show>
      </div>
    </div>
  );
};

export type FlowerThreadListProps = Readonly<{
  items: readonly FlowerThreadListItem[];
  activeThreadID?: string;
  query: string;
  refreshing?: boolean;
  copy?: FlowerThreadListCopy;
  onQueryChange: (query: string) => void;
  onSelect: (threadID: string) => void;
  onRefresh: () => void;
  onDelete?: (threadID: string) => void;
}>;

export const FlowerThreadList: Component<FlowerThreadListProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const filtered = createMemo(() => filterFlowerThreadItems(props.items, props.query));
  const groups = createMemo(() => groupFlowerThreadsByDate(filtered()));

  return (
    <div class="flower-host-thread-list flex min-h-0 flex-col gap-3 p-3">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="flower-host-thread-list-title truncate text-sm font-semibold">{copy().title}</h2>
          <p class="flower-host-thread-list-description truncate text-xs">{copy().description}</p>
        </div>
        <button
          type="button"
          class="flower-host-thread-refresh-button flex cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={copy().refreshLabel}
          title={copy().refreshLabel}
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          <Refresh class={cn('h-3.5 w-3.5', props.refreshing && 'animate-spin')} />
        </button>
      </div>
      <label class="relative block">
        <Search class="flower-host-thread-list-description pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input class="flower-host-thread-search-input pl-9" value={props.query} placeholder={copy().searchPlaceholder} onInput={(event) => props.onQueryChange(event.currentTarget.value)} />
      </label>
      <div class="flower-host-scroll flex-1 space-y-3">
        <Show
          when={filtered().length > 0}
          fallback={<div class="flower-host-thread-empty rounded-lg border border-dashed p-6 text-sm">{copy().empty}</div>}
        >
          <For each={groups()}>
            {(group) => (
              <section class="space-y-1.5">
                <h3 class="flower-host-thread-group-label px-1 text-[10px] font-semibold uppercase tracking-[0.08em]">{timeGroupLabel(group.group, copy())}</h3>
                <For each={group.threads}>
                  {(thread) => (
                    <FlowerThreadCard
                      item={thread}
                      active={props.activeThreadID === thread.thread_id}
                      copy={copy()}
                      canDelete={!!props.onDelete}
                      onSelect={() => props.onSelect(thread.thread_id)}
                      onDelete={props.onDelete ? () => props.onDelete?.(thread.thread_id) : undefined}
                    />
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
