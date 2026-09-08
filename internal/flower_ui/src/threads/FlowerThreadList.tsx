import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Copy, GitBranch, MoreHorizontal, Pencil, Pin, Refresh, Search, Trash, XCircle } from '@floegence/floe-webapp-core/icons';
import { Input } from '@floegence/floe-webapp-core/ui';

import { FlowerContextMenu } from '../FlowerContextMenu';
import { FlowerDirectoryMenuItems, type FlowerDirectoryMenuAvailability } from '../FlowerDirectoryMenuItems';

import type { FlowerThreadListCopy, FlowerThreadTimeGroup } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems, type FlowerThreadGroup } from './threadListModel';
import { canForkThreadItem, canPinThreadItem, canRenameThreadItem, canStopThreadItem } from './threadListActions';

type TimeGroup = FlowerThreadTimeGroup;
export type FlowerThreadMenuAction = 'copy_thread_id' | 'fork' | 'copy_workdir' | 'stop' | 'pin' | 'rename' | 'delete' | 'browse_workdir' | 'terminal_workdir';
export type { FlowerThreadGroup };

type FlowerThreadRenderGroup = Readonly<{
  key: string;
  kind: FlowerThreadGroup['kind'];
  group?: TimeGroup;
  threadIDs: readonly string[];
}>;

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
  busy?: boolean;
  busyLabel?: string;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent, item: FlowerThreadListItem) => void;
  onKeyboardMenu?: (event: KeyboardEvent, item: FlowerThreadListItem) => void;
  onRename?: (item: FlowerThreadListItem) => void;
  onPin?: (item: FlowerThreadListItem) => void;
}>;

export const FlowerThreadCard: Component<FlowerThreadCardProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const title = () => props.item.title.trim();
  const indicator = createMemo(() => flowerThreadIndicator(props.item, props.active, copy()));
  const itemCanRename = createMemo(() => canRenameThreadItem(props.item));
  const itemCanPin = createMemo(() => canPinThreadItem(props.item));
  const ariaLabel = () => [
    title(),
    indicator().ariaStatus,
    indicator().attention === 'unread' ? copy().unread : '',
  ].filter(Boolean).join(', ');

  return (
    <div
      data-flower-thread-card
      data-thread-id={props.item.thread_id}
      data-flower-thread-id={props.item.thread_id}
      data-flower-thread-status={props.item.status}
      data-flower-thread-active={props.active ? 'true' : 'false'}
      data-flower-thread-busy={props.busy ? 'true' : 'false'}
      aria-busy={props.busy ? 'true' : undefined}
      data-flower-thread-indicator={indicator().visual}
      data-flower-thread-unread-dot={indicator().attention === 'unread' ? 'true' : 'false'}
      data-flower-thread-action-required={indicator().actionRequired ? 'true' : 'false'}
      onContextMenu={(event) => props.onContextMenu?.(event, props.item)}
      class={cn(
        'flower-thread-card group relative w-full cursor-pointer rounded-lg',
        props.active && 'flower-thread-card-active',
      )}
    >
      <button
        type="button"
        class="flower-thread-card-select-button flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        aria-label={ariaLabel()}
        aria-current={props.active ? 'true' : undefined}
        onClick={props.onSelect}
        onDblClick={(event) => {
          event.preventDefault();
          if (!itemCanRename()) return;
          props.onRename?.(props.item);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            props.onKeyboardMenu?.(event, props.item);
          }
        }}
      >
        <div class="flower-thread-indicator relative mt-1.5 flex h-2 shrink-0 items-center justify-center" aria-hidden="true" title={indicator().title}>
          <Show when={indicator().visual === 'wave'}>
            <div class="flower-thread-wave h-2 items-center gap-0.5">
              <div class="flower-thread-wave-bar" style="animation-delay: 0ms" />
              <div class="flower-thread-wave-bar" style="animation-delay: 180ms" />
              <div class="flower-thread-wave-bar" style="animation-delay: 360ms" />
              <div class="flower-thread-wave-bar" style="animation-delay: 540ms" />
            </div>
          </Show>
          <div class="flower-thread-status-dot h-1.5 w-1.5 rounded-full" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="flower-thread-list-title flex-1 truncate text-xs font-medium">{title()}</span>
          </div>
          <Show when={props.busyLabel}>
            <span class="text-[10px] text-muted-foreground" role="status">{props.busyLabel}</span>
          </Show>
        </div>
      </button>
      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <span class="flower-thread-card-time select-none text-[10px] transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true">
          {fmtFlowerShortTime(props.item.created_at_ms, copy())}
        </span>
      </div>
      <Show when={props.onPin && itemCanPin()}>
        <button
          type="button"
          class="flower-thread-card-pin-button"
          data-pinned={props.item.pinned ? 'true' : 'false'}
          aria-label={props.item.pinned ? copy().unpin : copy().pin}
          title={props.item.pinned ? copy().unpin : copy().pin}
          onClick={(event) => {
            event.stopPropagation();
            props.onPin?.(props.item);
          }}
        >
          <Pin class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />
        </button>
      </Show>
      <button
        type="button"
        class="flower-thread-card-menu-button"
        aria-label={copy().contextMenuLabel(title())}
        title={copy().contextMenuLabel(title())}
        onClick={(event) => {
          event.stopPropagation();
          props.onContextMenu?.(event, props.item);
        }}
      >
        <MoreHorizontal class="h-3.5 w-3.5" />
      </button>
      <Show when={props.item.status === 'waiting_approval'}>
        <div
          class="flower-thread-card-approval-indicator"
          aria-hidden="true"
          title={copy().statuses.waiting_approval}
        >
          <span class="flower-thread-card-approval-badge">{copy().statuses.waiting_approval}</span>
        </div>
      </Show>
    </div>
  );
};

type FlowerThreadContextMenuProps = Readonly<{
  item: FlowerThreadListItem;
  x: number;
  y: number;
  copy: FlowerThreadListCopy;
  canFork: boolean;
  canRename: boolean;
  canPin: boolean;
  showStopAction: boolean;
  showDeleteAction: boolean;
  actionsBusy: boolean;
  busyAction: FlowerThreadMenuAction | null;
  workingDirectory: string;
  directoryActions?: FlowerDirectoryMenuAvailability;
  resolveRestore: () => HTMLElement | undefined;
  onAction: (action: FlowerThreadMenuAction, item: FlowerThreadListItem) => void;
  onClose: () => void;
}>;

const FlowerThreadContextMenu: Component<FlowerThreadContextMenuProps> = (props) => {
  const action = (kind: FlowerThreadMenuAction) => {
    if (kind === 'fork' && !canForkThreadItem(props.item)) return;
    if (kind === 'pin' && !canPinThreadItem(props.item)) return;
    if (kind === 'rename' && !canRenameThreadItem(props.item)) return;
    props.onAction(kind, props.item);
  };
  const itemButton = (
    kind: FlowerThreadMenuAction,
    label: string,
    icon: JSX.Element,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      class={cn('flower-thread-menu-item', kind === 'delete' && 'flower-thread-menu-item-destructive')}
      data-destructive={kind === 'delete' ? 'true' : undefined}
      disabled={disabled || props.actionsBusy}
      aria-busy={props.busyAction === kind ? 'true' : undefined}
      onClick={() => action(kind)}
    >
      {icon}
      <span>{props.busyAction === kind ? props.copy.working : label}</span>
    </button>
  );
  return (
    <FlowerContextMenu
      x={props.x}
      y={props.y}
      label={props.copy.contextMenuLabel(props.item.title.trim())}
      height={340 + (props.showStopAction && canStopThreadItem(props.item) ? 44 : 0) + (props.showDeleteAction ? 44 : 0)}
      resolveRestore={props.resolveRestore}
      onClose={props.onClose}
    >
      {itemButton('copy_thread_id', props.copy.copyThreadID, <Copy class="h-3.5 w-3.5" />)}
      {itemButton('fork', props.copy.fork, <GitBranch class="h-3.5 w-3.5" />, !props.canFork || !canForkThreadItem(props.item))}
      <FlowerDirectoryMenuItems
        path={props.workingDirectory}
        copy={props.copy}
        availability={props.directoryActions}
        onAction={(kind) => props.onAction(kind, { ...props.item, working_dir: props.workingDirectory })}
      />
      <div class="flower-thread-menu-separator" />
      <Show when={props.showStopAction && canStopThreadItem(props.item)}>
        {itemButton('stop', props.copy.stop, <XCircle class="h-3.5 w-3.5" />)}
      </Show>
      {itemButton('pin', props.item.pinned ? props.copy.unpin : props.copy.pin, <Pin class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />, !props.canPin || !canPinThreadItem(props.item))}
      {itemButton('rename', props.copy.rename, <Pencil class="h-3.5 w-3.5" />, !props.canRename || !canRenameThreadItem(props.item))}
      <Show when={props.showDeleteAction}>
        <div class="flower-thread-menu-separator" />
        {itemButton('delete', props.copy.deleteMenuAction, <Trash class="h-3.5 w-3.5" />)}
      </Show>
    </FlowerContextMenu>
  );
};

export type FlowerThreadListProps = Readonly<{
  items: readonly FlowerThreadListItem[];
  activeThreadID?: string;
  query: string;
  refreshing?: boolean;
  loading?: boolean;
  warmup?: boolean;
  copy?: FlowerThreadListCopy;
  onQueryChange: (query: string) => void;
  onSelect: (threadID: string) => void;
  onRefresh: () => void;
  onMenuAction?: (action: FlowerThreadMenuAction, thread: FlowerThreadListItem, restore?: HTMLElement) => void;
  directoryActions?: FlowerDirectoryMenuAvailability;
  visible?: boolean;
  canFork?: boolean;
  canRename?: boolean;
  canPin?: boolean;
  showStopAction?: boolean;
  showDeleteAction?: boolean;
  busyThreadID?: string;
  busyAction?: FlowerThreadMenuAction | null;
  actionsBusy?: boolean;
}>;

export const FlowerThreadList: Component<FlowerThreadListProps> = (props) => {
  let listRef: HTMLDivElement | undefined;
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const filtered = createMemo(() => filterFlowerThreadItems(props.items, props.query));
  const itemByID = createMemo(() => new Map(props.items.map((item) => [item.thread_id, item] as const)));
  const groups = createMemo<readonly FlowerThreadRenderGroup[]>(() => groupFlowerThreadItems(filtered()).map((group) => (
    group.kind === 'pinned'
      ? { key: 'pinned', kind: group.kind, threadIDs: group.threads.map((thread) => thread.thread_id) }
      : { key: `time:${group.group}`, kind: group.kind, group: group.group, threadIDs: group.threads.map((thread) => thread.thread_id) }
  )));
  const groupByKey = createMemo(() => new Map(groups().map((group) => [group.key, group] as const)));
  const groupKeys = createMemo(() => groups().map((group) => group.key));
  // IMPORTANT: An open thread menu is owned by ThreadID and must survive summary
  // refreshes and row replacement; only the explicit lifecycle events below may close it.
  const [menu, setMenu] = createSignal<{
    threadID: string;
    x: number;
    y: number;
    restoreControl: 'menu' | 'select';
    workingDirectory: string;
  } | null>(null);
  const menuPresentation = createMemo(() => {
    const state = menu();
    if (!state) return null;
    const item = itemByID().get(state.threadID);
    return item ? { ...state, item } : null;
  });
  const warmupRows = [0, 1, 2, 3, 4, 5] as const;
  const showLoadingSkeleton = createMemo(() => (props.warmup === true || props.loading === true) && props.items.length === 0);
  const searchDisabled = createMemo(() => showLoadingSkeleton());

  const openMenu = (event: MouseEvent | KeyboardEvent, item: FlowerThreadListItem) => {
    event.preventDefault();
    event.stopPropagation();
    let x = 0;
    let y = 0;
    let restoreControl: 'menu' | 'select' = 'select';
    if (event instanceof MouseEvent && event.type === 'contextmenu') {
      x = event.clientX;
      y = event.clientY;
    } else {
      const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const rect = target?.getBoundingClientRect();
      x = rect ? rect.left : 24;
      y = rect ? rect.bottom + 4 : 24;
    }
    if (event.currentTarget instanceof HTMLButtonElement) {
      restoreControl = event.currentTarget.classList.contains('flower-thread-card-menu-button') ? 'menu' : 'select';
    }
    setMenu({ threadID: item.thread_id, x, y, restoreControl, workingDirectory: item.working_dir });
  };

  const resolveMenuRestore = (state: NonNullable<ReturnType<typeof menu>>): HTMLElement | undefined => {
    const card = Array.from(listRef?.querySelectorAll<HTMLElement>('[data-flower-thread-card]') ?? [])
      .find((candidate) => candidate.getAttribute('data-thread-id') === state.threadID);
    return card?.querySelector<HTMLElement>(state.restoreControl === 'menu'
      ? '.flower-thread-card-menu-button'
      : '.flower-thread-card-select-button') ?? undefined;
  };

  const resolveCurrentMenuRestore = (): HTMLElement | undefined => {
    const state = menu();
    return state ? resolveMenuRestore(state) : undefined;
  };

  const closeMenu = () => {
    const state = menu();
    const restore = state ? resolveMenuRestore(state) : undefined;
    setMenu(null);
    restore?.focus({ preventScroll: true });
  };

  createEffect(on(
    () => [props.query, props.activeThreadID].join('\x00'),
    () => setMenu(null),
    { defer: true },
  ));

  createEffect(() => {
    if (menu() && (!menuPresentation() || props.visible === false)) setMenu(null);
  });

  return (
    <div ref={listRef} class="flower-thread-list flex min-h-0 flex-col gap-3 p-3">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="flower-thread-list-title truncate text-sm font-semibold">{copy().title}</h2>
          <p class="flower-thread-list-description truncate text-xs">
            {props.warmup || props.loading ? copy().warmupDescription : copy().description}
          </p>
        </div>
        <button
          type="button"
          class="flower-thread-refresh-button flex cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={copy().refreshLabel}
          title={copy().refreshLabel}
          disabled={props.refreshing || props.warmup}
          onClick={props.onRefresh}
        >
          <Refresh class={cn('h-3.5 w-3.5', props.refreshing && 'animate-spin')} />
        </button>
      </div>
      <label class="relative block">
        <Search class="flower-thread-list-description pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          class="flower-thread-search-input pl-9"
          value={props.query}
          placeholder={copy().searchPlaceholder}
          disabled={searchDisabled()}
          onInput={(event) => props.onQueryChange(event.currentTarget.value)}
        />
      </label>
      <div
        class="flower-scroll flex-1 space-y-2"
        onScroll={() => {
          if (menu()) closeMenu();
        }}
      >
        <Show when={!showLoadingSkeleton()} fallback={(
          <div class="flower-thread-warmup-list" role="status" aria-live="polite" aria-label={copy().warmupDescription}>
            <For each={warmupRows}>
              {(row) => (
                <div class="flower-thread-warmup-card" data-row={String(row)}>
                  <span class="flower-thread-warmup-dot" />
                  <span class="flower-thread-warmup-lines">
                    <span class="flower-thread-warmup-line flower-thread-warmup-line-title" />
                    <span class="flower-thread-warmup-line flower-thread-warmup-line-meta" />
                  </span>
                </div>
              )}
            </For>
          </div>
        )}>
          <Show
            when={filtered().length > 0}
            fallback={<div class="flower-thread-empty rounded-lg border border-dashed p-6 text-sm">{copy().empty}</div>}
          >
            <For each={groupKeys()}>
              {(groupKey) => {
                const group = () => groupByKey().get(groupKey);
                return (
                  <section class="space-y-1">
                    <h3 class="flower-thread-group-label px-1 text-[10px] font-semibold uppercase tracking-[0.08em]">
                      {group()?.kind === 'pinned' ? copy().pinnedGroup : timeGroupLabel(group()?.group ?? 'older', copy())}
                    </h3>
                    <For each={group()?.threadIDs ?? []}>
                      {(threadID) => {
                        const thread = () => itemByID().get(threadID);
                        return (
                          <Show when={thread()}>
                            {(item) => (
                              <FlowerThreadCard
                                item={item()}
                                active={props.activeThreadID === threadID}
                                copy={copy()}
                                busy={props.busyThreadID === threadID}
                                busyLabel={props.busyThreadID === threadID && props.busyAction === 'fork' ? copy().forkCreating : undefined}
                                onSelect={() => props.onSelect(threadID)}
                                onContextMenu={openMenu}
                                onKeyboardMenu={openMenu}
                                onRename={props.onMenuAction && canRenameThreadItem(item()) ? (value) => props.onMenuAction?.('rename', value) : undefined}
                                onPin={props.canPin && props.onMenuAction && canPinThreadItem(item()) ? (value) => props.onMenuAction?.('pin', value) : undefined}
                              />
                            )}
                          </Show>
                        );
                      }}
                    </For>
                  </section>
                );
              }}
            </For>
          </Show>
        </Show>
      </div>
      <Show when={menuPresentation()}>
        {(state) => (
          <FlowerThreadContextMenu
            item={state().item}
            workingDirectory={state().workingDirectory}
            directoryActions={props.directoryActions}
            x={state().x}
            y={state().y}
            copy={copy()}
            canFork={!!props.canFork}
            canRename={!!props.canRename}
            canPin={!!props.canPin}
            showStopAction={props.showStopAction === true}
            showDeleteAction={props.showDeleteAction === true}
            actionsBusy={!!props.actionsBusy}
            busyAction={props.busyThreadID === state().threadID ? props.busyAction ?? null : null}
            resolveRestore={resolveCurrentMenuRestore}
            onClose={closeMenu}
            onAction={(action, item) => {
              const restore = resolveMenuRestore(state());
              setMenu(null);
              props.onMenuAction?.(action, item, restore);
            }}
          />
        )}
      </Show>
    </div>
  );
};
