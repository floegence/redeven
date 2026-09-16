import { flowerThreadIsStopping } from '../flowerSurfaceModel';
import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ArrowUp, ArrowDown, GripVertical, Copy, GitBranch, MoreHorizontal, Pencil, Pin, Refresh, Search, Trash, XCircle } from '@floegence/floe-webapp-core/icons';
import { Input } from '@floegence/floe-webapp-core/ui';

import { FlowerThreadRows } from './FlowerThreadRows';
import type { FlowerThreadPinPosition } from '../contracts/flowerSurfaceContracts';
import { FlowerContextMenu } from '../FlowerContextMenu';
import { FlowerDirectoryMenuItems, type FlowerDirectoryMenuAvailability } from '../FlowerDirectoryMenuItems';

import type { FlowerThreadListCopy, FlowerThreadTimeGroup } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems, type FlowerThreadGroup } from './threadListModel';
import { canForkThreadItem, canPinThreadItem, canRenameThreadItem, canStopThreadItem } from './threadListActions';

type TimeGroup = FlowerThreadTimeGroup;
export type FlowerThreadMenuAction = 'copy_thread_id' | 'fork' | 'copy_workdir' | 'stop' | 'pin' | 'rename' | 'delete' | 'browse_workdir' | 'terminal_workdir' | 'move_up' | 'move_down';
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
  pinBusy?: boolean;
  reorderable?: boolean;
  dragging?: boolean;
  dropPosition?: 'before' | 'after';
  onDragStart?: (event: DragEvent, item: FlowerThreadListItem) => void;
  onDragOver?: (event: DragEvent, item: FlowerThreadListItem) => void;
  onDrop?: (event: DragEvent) => void;
  onDragEnd?: () => void;
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
      data-pinned={props.item.pinned ? 'true' : 'false'}
      data-flower-thread-dragging={props.dragging ? 'true' : undefined}
      data-flower-thread-drop={props.dropPosition}
      onDragOver={(event) => props.onDragOver?.(event, props.item)}
      onDrop={(event) => props.onDrop?.(event)}
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
      <Show when={props.item.pinned && props.onDragStart}>
        <button
          type="button"
          class="flower-thread-drag-handle"
          draggable={props.reorderable}
          disabled={!props.reorderable}
          aria-label={copy().dragPinned}
          title={copy().dragPinned}
          onClick={(event) => { event.stopPropagation(); props.onContextMenu?.(event, props.item); }}
          onDragStart={(event) => props.onDragStart?.(event, props.item)}
          onDragEnd={() => props.onDragEnd?.()}
        ><GripVertical class="h-3.5 w-3.5" /></button>
      </Show>
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
          <Show when={props.busyLabel || flowerThreadIsStopping(props.item)}>
            <span class="text-[10px] text-muted-foreground" role="status">{flowerThreadIsStopping(props.item) ? copy().stopping : props.busyLabel}</span>
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
          disabled={props.pinBusy}
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
  canMoveUp: boolean;
  canMoveDown: boolean;
  pinBusy: boolean;
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
  const ItemButton: Component<{
    kind: FlowerThreadMenuAction;
    label: string;
    icon: JSX.Element;
    disabled?: boolean;
  }> = (itemProps) => {
    const disabled = createMemo(() => Boolean(itemProps.disabled || props.actionsBusy));
    return <button
      type="button"
      role="menuitem"
      class={cn('flower-thread-menu-item', itemProps.kind === 'delete' && 'flower-thread-menu-item-destructive')}
      data-destructive={itemProps.kind === 'delete' ? 'true' : undefined}
      aria-disabled={disabled() ? 'true' : undefined}
      aria-busy={props.busyAction === itemProps.kind ? 'true' : undefined}
      onClick={() => { if (!disabled()) action(itemProps.kind); }}
    >
      {itemProps.icon}
      <span>{props.busyAction === itemProps.kind ? props.copy.working : itemProps.label}</span>
    </button>;
  };
  return (
    <FlowerContextMenu
      x={props.x}
      y={props.y}
      label={props.copy.contextMenuLabel(props.item.title.trim())}
      height={340 + (props.item.pinned ? 72 : 0) + (props.showStopAction && canStopThreadItem(props.item) ? 44 : 0) + (props.showDeleteAction ? 44 : 0)}
      resolveRestore={props.resolveRestore}
      onClose={props.onClose}
    >
      <ItemButton kind="copy_thread_id" label={props.copy.copyThreadID} icon={<Copy class="h-3.5 w-3.5" />} />
      <ItemButton kind="fork" label={props.copy.fork} icon={<GitBranch class="h-3.5 w-3.5" />} disabled={!props.canFork || !canForkThreadItem(props.item)} />
      <FlowerDirectoryMenuItems
        path={props.workingDirectory}
        copy={props.copy}
        availability={props.directoryActions}
        onAction={(kind) => props.onAction(kind, { ...props.item, working_dir: props.workingDirectory })}
      />
      <div class="flower-thread-menu-separator" />
      <Show when={props.showStopAction && canStopThreadItem(props.item)}>
        <ItemButton kind="stop" label={props.copy.stop} icon={<XCircle class="h-3.5 w-3.5" />} />
      </Show>
      <ItemButton kind="pin" label={props.item.pinned ? props.copy.unpin : props.copy.pin} icon={<Pin class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />} disabled={!props.canPin || props.pinBusy || !canPinThreadItem(props.item)} />
      <Show when={props.item.pinned}>
        <ItemButton kind="move_up" label={props.copy.movePinnedUp} icon={<ArrowUp class="h-3.5 w-3.5" />} disabled={!props.canMoveUp || props.pinBusy} />
        <ItemButton kind="move_down" label={props.copy.movePinnedDown} icon={<ArrowDown class="h-3.5 w-3.5" />} disabled={!props.canMoveDown || props.pinBusy} />
      </Show>
      <ItemButton kind="rename" label={props.copy.rename} icon={<Pencil class="h-3.5 w-3.5" />} disabled={!props.canRename || !canRenameThreadItem(props.item)} />
      <Show when={props.showDeleteAction}>
        <div class="flower-thread-menu-separator" />
        <ItemButton kind="delete" label={props.copy.deleteMenuAction} icon={<Trash class="h-3.5 w-3.5" />} />
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
  error?: string;
  errorTitle?: string;
  errorRetryLabel?: string;
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
  pinBusy?: boolean;
  onMovePinned?: (threadID: string, position: FlowerThreadPinPosition) => void;
  showStopAction?: boolean;
  showDeleteAction?: boolean;
  busyThreadID?: string;
  busyAction?: FlowerThreadMenuAction | null;
  actionsBusy?: boolean;
}>;

export const FlowerThreadList: Component<FlowerThreadListProps> = (props) => {
  let listRef: HTMLDivElement | undefined;
  let scrollRef: HTMLDivElement | undefined;
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const filtered = createMemo(() => filterFlowerThreadItems(props.items, props.query));
  const itemByID = createMemo(() => new Map(props.items.map((item) => [item.thread_id, item] as const)));
  const groups = createMemo<readonly FlowerThreadRenderGroup[]>(() => groupFlowerThreadItems(filtered()).map((group) => (
    group.kind === 'pinned'
      ? { key: 'pinned', kind: group.kind, threadIDs: group.threads.map((thread) => thread.thread_id) }
      : { key: `time:${group.group}`, kind: group.kind, group: group.group, threadIDs: group.threads.map((thread) => thread.thread_id) }
  )));
  const groupByKey = createMemo(() => new Map(groups().map((group) => [group.key, group] as const)));
  const rowKeys = createMemo(() => groups().flatMap((group) => [`group:${group.key}`, ...group.threadIDs.map((id) => `thread:${id}`)]));
  const pinnedIDs = createMemo(() => groupFlowerThreadItems(props.items).find((group) => group.kind === 'pinned')?.threads.map((item) => item.thread_id) ?? []);
  const canReorder = () => Boolean(props.onMovePinned && !props.pinBusy && !props.query.trim() && pinnedIDs().length > 1);
  const [drag, setDrag] = createSignal<{ threadID: string; keys: readonly string[]; target?: FlowerThreadPinPosition } | null>(null);
  const visibleKeys = createMemo(() => drag()?.keys ?? rowKeys());
  let scrollFrame: number | undefined;
  let dragY = 0;
  const cancelDrag = () => {
    setDrag(null);
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  };
  const updateDragTarget = (y: number) => {
    const state = drag();
    if (!state || !scrollRef) return;
    const rows = Array.from(scrollRef.querySelectorAll<HTMLElement>('[data-flower-thread-card][data-pinned="true"]'));
    const target = rows.find((row) => y <= row.getBoundingClientRect().bottom) ?? rows.at(-1);
    if (!target) return;
    const id = target.dataset.threadId!;
    if (id === state.threadID) { if (state.target) setDrag({ ...state, target: undefined }); return; }
    const rect = target.getBoundingClientRect();
    const placement = y < rect.top + rect.height / 2 ? 'before' : 'after';
    if (state.target?.anchor_thread_id !== id || state.target.placement !== placement) {
      setDrag({ ...state, target: { anchor_thread_id: id, placement } });
    }
  };
  const edgeScroll = () => {
    scrollFrame = undefined;
    if (!drag() || !scrollRef) return;
    const rect = scrollRef.getBoundingClientRect();
    const distance = dragY < rect.top + 32 ? dragY - rect.top - 32 : dragY > rect.bottom - 32 ? dragY - rect.bottom + 32 : 0;
    if (distance) {
      scrollRef.scrollTop += Math.max(-12, Math.min(12, distance / 3));
      updateDragTarget(dragY);
      scrollFrame = requestAnimationFrame(edgeScroll);
    }
  };
  const startDrag = (event: DragEvent, item: FlowerThreadListItem) => {
    if (!canReorder() || !item.pinned || !event.dataTransfer) { event.preventDefault(); return; }
    setMenu(null);
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.thread_id);
    const card = (event.currentTarget as HTMLElement).closest('[data-flower-thread-card]');
    if (card instanceof HTMLElement) event.dataTransfer.setDragImage(card, 16, 16);
    setDrag({ threadID: item.thread_id, keys: rowKeys() });
  };
  const overDrag = (event: DragEvent) => {
    if (!drag()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragY = event.clientY;
    updateDragTarget(dragY);
    if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(edgeScroll);
  };
  const dropDrag = (event: DragEvent) => {
    const state = drag();
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    // Commit the visible insertion target once. Dragend only releases ownership.
    if (state.target && canReorder()) props.onMovePinned?.(state.threadID, state.target);
    cancelDrag();
  };
  const moveNeighbour = (threadID: string, direction: -1 | 1) => {
    if (!canReorder()) return;
    const ids = pinnedIDs();
    const index = ids.indexOf(threadID);
    const anchor = index < 0 ? undefined : ids[index + direction];
    if (anchor) props.onMovePinned?.(threadID, { anchor_thread_id: anchor, placement: direction < 0 ? 'before' : 'after' });
  };
  createEffect(() => {
    const state = drag();
    if (!state) return;
    if (!canReorder() || props.visible === false || !itemByID().get(state.threadID)?.pinned
      || (state.target && !itemByID().get(state.target.anchor_thread_id)?.pinned)) cancelDrag();
  });
  const escapeDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelDrag(); };
  document.addEventListener('keydown', escapeDrag);
  window.addEventListener('blur', cancelDrag);
  onCleanup(() => { cancelDrag(); document.removeEventListener('keydown', escapeDrag); window.removeEventListener('blur', cancelDrag); });
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
  const showLoadError = createMemo(() => Boolean(props.error?.trim()) && !showLoadingSkeleton());
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
      <Show when={props.query.trim() && pinnedIDs().length > 1 && props.onMovePinned}>
        <button type="button" class="flower-thread-clear-sort-search" onClick={() => props.onQueryChange('')}>{copy().clearSearchToReorder}</button>
      </Show>
      <div
        ref={scrollRef}
        class="flower-scroll flex-1"
        onWheel={() => { if (menu()) closeMenu(); }}
        onTouchMove={() => { if (menu()) closeMenu(); }}
        onPointerDown={(event) => { if (event.target === scrollRef && menu()) closeMenu(); }}
        onDragOver={overDrag}
        onDrop={dropDrag}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !scrollRef?.contains(event.relatedTarget)) {
            if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
            scrollFrame = undefined;
            const state = drag();
            if (state?.target) setDrag({ ...state, target: undefined });
          }
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
          <Show when={!showLoadError()} fallback={(
            <div class="flower-thread-empty rounded-lg border border-dashed p-6 text-sm" role="alert">
              <div class="font-medium">{props.errorTitle || copy().title}</div>
              <div class="mt-1 text-xs text-muted-foreground">{props.error}</div>
              <button
                type="button"
                class="mt-3 rounded-md border px-3 py-1.5 text-xs font-medium"
                onClick={props.onRefresh}
                disabled={props.refreshing}
              >
                {props.refreshing ? copy().working : (props.errorRetryLabel || copy().refreshLabel)}
              </button>
            </div>
          )}>
            <Show
              when={filtered().length > 0}
              fallback={<div class="flower-thread-empty rounded-lg border border-dashed p-6 text-sm">{copy().empty}</div>}
            >
            <FlowerThreadRows keys={visibleKeys()} render={(key) => {
              if (key.startsWith('group:')) {
                const group = () => groupByKey().get(key.slice(6));
                return <h3 class="flower-thread-group-label px-1 text-[10px] font-semibold uppercase tracking-[0.08em]">
                  {group()?.kind === 'pinned' ? copy().pinnedGroup : timeGroupLabel(group()?.group ?? 'older', copy())}
                </h3>;
              }
              const threadID = key.slice(7);
              const item = createMemo<FlowerThreadListItem>((previous) => itemByID().get(threadID) ?? previous!);
              return <FlowerThreadCard
                item={item()}
                active={props.activeThreadID === threadID}
                copy={copy()}
                busy={props.busyThreadID === threadID}
                busyLabel={props.busyThreadID === threadID && props.busyAction === 'fork' ? copy().forkCreating : undefined}
                onSelect={() => props.onSelect(threadID)}
                onContextMenu={openMenu}
                onKeyboardMenu={openMenu}
                onRename={props.onMenuAction ? (value) => props.onMenuAction?.('rename', value) : undefined}
                onPin={props.canPin && props.onMenuAction ? (value) => props.onMenuAction?.('pin', value) : undefined}
                pinBusy={props.pinBusy}
                reorderable={canReorder()}
                onDragStart={props.onMovePinned ? startDrag : undefined}
                onDragOver={overDrag}
                onDragEnd={cancelDrag}
                onDrop={dropDrag}
                dragging={drag()?.threadID === threadID}
                dropPosition={drag()?.target?.anchor_thread_id === threadID ? drag()?.target?.placement : undefined}
              />;
            }} />
            </Show>
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
            pinBusy={props.pinBusy === true}
            canMoveUp={canReorder() && pinnedIDs().indexOf(state().threadID) > 0}
            canMoveDown={canReorder() && pinnedIDs().indexOf(state().threadID) >= 0 && pinnedIDs().indexOf(state().threadID) < pinnedIDs().length - 1}
            showStopAction={props.showStopAction === true}
            showDeleteAction={props.showDeleteAction === true}
            actionsBusy={!!props.actionsBusy}
            busyAction={props.busyThreadID === state().threadID ? props.busyAction ?? null : null}
            resolveRestore={resolveCurrentMenuRestore}
            onClose={closeMenu}
            onAction={(action, item) => {
              const restore = resolveMenuRestore(state());
              setMenu(null);
              if (action === 'move_up' || action === 'move_down') {
                moveNeighbour(item.thread_id, action === 'move_up' ? -1 : 1);
                restore?.focus({ preventScroll: true });
              } else props.onMenuAction?.(action, item, restore);
            }}
          />
        )}
      </Show>
    </div>
  );
};
