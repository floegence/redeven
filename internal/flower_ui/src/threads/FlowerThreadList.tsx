import { Card, Dialog, DialogPlacementProvider, StableText, Input, SegmentedControl, createFloatingPresence, type FloatingPresenceState } from '@floegence/floe-webapp-core/ui';
import { flowerThreadIsStopping } from '../flowerSurfaceModel';
import type { Component, JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ArrowUp, ArrowDown, ChevronRight, Clock, Copy, Folder, GitBranch, Grid, MessageSquare, MoreHorizontal, Pencil, Plus, Refresh, Search, ShieldCheck, Trash, XCircle } from '@floegence/floe-webapp-core/icons';

import { FlowerPinIcon } from '../icons/FlowerPinIcon';
import { animateFlowerThreadRowsChange, FlowerThreadRows } from './FlowerThreadRows';
import { FlowerThreadWave } from '../FlowerThreadWave';
import type { FlowerThreadPinPosition } from '../contracts/flowerSurfaceContracts';
import { FlowerContextMenu } from '../FlowerContextMenu';
import { FlowerDirectoryMenuItems, type FlowerDirectoryMenuAvailability } from '../FlowerDirectoryMenuItems';

import type { FlowerThreadListCopy, FlowerThreadTimeGroup } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';
import { comparePinnedFlowerThreads, filterFlowerThreadItems, flowerDirectoryName, flowerThreadIndicator, groupFlowerThreadItems, groupFlowerThreadsByDirectory, moveFlowerDirectory, FLOWER_DIRECTORY_PAGE_SIZE, type FlowerThreadGroup } from './threadListModel';
import { canForkThreadItem, canPinThreadItem, canRenameThreadItem, canStopThreadItem } from './threadListActions';
import { loadFlowerDirectoryPreferences, saveFlowerDirectoryPreferences, type FlowerDirectoryPreferenceStorage } from './directoryPreferences';

type TimeGroup = FlowerThreadTimeGroup;
export type FlowerThreadMenuAction = 'reference' | 'copy_thread_id' | 'fork' | 'copy_workdir' | 'stop' | 'pin' | 'rename' | 'delete' | 'browse_workdir' | 'terminal_workdir' | 'move_up' | 'move_down';
export type { FlowerThreadGroup };

type FlowerThreadRenderGroup = Readonly<{
  key: string;
  kind: FlowerThreadGroup['kind'] | 'directory';
  group?: TimeGroup;
  path?: string;
  runningCount?: number;
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
  const indicator = createMemo(() => flowerThreadIndicator(props.item, copy()));
  const itemCanRename = createMemo(() => canRenameThreadItem(props.item));
  const itemCanPin = createMemo(() => canPinThreadItem(props.item));
  const titleDraggable = () => Boolean(props.item.pinned && props.reorderable && props.onDragStart);
  const progressLabel = () => flowerThreadIsStopping(props.item) ? copy().stopping : props.busyLabel;
  const ariaLabel = () => [
    title(),
    indicator().ariaStatus,
    indicator().attention === 'unread' ? copy().unread : '',
    props.item.pinned ? copy().pinnedGroup : '',
    props.busyLabel,
  ].filter(Boolean).join(', ');

  return (
    <div
      data-flower-thread-card
      data-flower-pin-action={props.onPin && itemCanPin() ? 'true' : undefined}
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
      <button
        type="button"
        class="flower-thread-card-select-button cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
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
        <div class="flower-thread-indicator relative flex h-2 shrink-0 items-center justify-center" aria-hidden="true" title={indicator().title}>
          <Show when={indicator().visual === 'wave'}>
            <FlowerThreadWave />
          </Show>
          <div class="flower-thread-status-dot h-1.5 w-1.5 rounded-full" />
        </div>
        <span
          class="flower-thread-list-title flex-1 truncate"
          draggable={titleDraggable()}
          title={titleDraggable() ? copy().dragPinned : undefined}
          onDragStart={(event) => props.onDragStart?.(event, props.item)}
          onDragEnd={() => props.onDragEnd?.()}
        >{title()}</span>
      </button>
      <Show when={progressLabel()}>
        <span class="sr-only" role="status">{progressLabel()}</span>
      </Show>
      <div class="flower-thread-card-trailing" data-has-timestamp={!indicator().actionRequired && !progressLabel() ? 'true' : undefined}>
        <div class="flower-thread-card-summary" aria-hidden="true">
          <Show when={indicator().actionRequired} fallback={
            <span class="flower-thread-card-time" data-progress={progressLabel() ? 'true' : undefined} title={progressLabel()}>{progressLabel() || fmtFlowerShortTime(props.item.created_at_ms, copy())}</span>
          }>
            <span class="flower-thread-card-action-indicator" title={indicator().ariaStatus}>
              <Show when={props.item.status === 'waiting_approval'} fallback={<MessageSquare class="flower-thread-card-action-icon" />}>
                <ShieldCheck class="flower-thread-card-action-icon" />
              </Show>
              <span class="flower-thread-card-action-badge">{indicator().ariaStatus}</span>
            </span>
          </Show>
        </div>
        <div class="flower-thread-card-actions">
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
              <FlowerPinIcon pinned={props.item.pinned} class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />
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
        </div>
      </div>
    </div>
  );
};

type FlowerThreadContextMenuProps = Readonly<{
  presenceState: FloatingPresenceState;
  onPanelRef: (element: HTMLDivElement | undefined) => void;
  item: FlowerThreadListItem;
  x: number;
  y: number;
  copy: FlowerThreadListCopy;
  referenceDisabledReason?: string;
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
  onClose: (restoreFocus?: boolean) => void;
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
    disabledReason?: string;
  }> = (itemProps) => {
    const disabled = createMemo(() => Boolean(itemProps.disabled || (itemProps.kind !== 'reference' && props.actionsBusy)));
    return <button
      type="button"
      role="menuitem"
      class={cn('flower-thread-menu-item', itemProps.kind === 'delete' && 'flower-thread-menu-item-destructive')}
      data-destructive={itemProps.kind === 'delete' ? 'true' : undefined}
      title={itemProps.disabledReason}
      aria-description={itemProps.disabledReason}
      aria-disabled={disabled() ? 'true' : undefined}
      aria-busy={props.busyAction === itemProps.kind ? 'true' : undefined}
      onClick={() => { if (!disabled()) action(itemProps.kind); }}
    >
      {itemProps.icon}
      <span><StableText reserve={[props.copy.working, itemProps.label]}>{props.busyAction === itemProps.kind ? props.copy.working : itemProps.label}</StableText></span>
    </button>;
  };
  return (
    <FlowerContextMenu
      presenceState={props.presenceState}
      onPanelRef={props.onPanelRef}
      x={props.x}
      y={props.y}
      label={props.copy.contextMenuLabel(props.item.title.trim())}
      resolveRestore={props.resolveRestore}
      onClose={props.onClose}
    >
      <ItemButton kind="reference" label={props.copy.referenceThread} icon={<MessageSquare class="h-3.5 w-3.5" />} disabled={!!props.referenceDisabledReason} disabledReason={props.referenceDisabledReason} />
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
      <ItemButton kind="pin" label={props.item.pinned ? props.copy.unpin : props.copy.pin} icon={<FlowerPinIcon pinned={props.item.pinned} class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />} disabled={!props.canPin || props.pinBusy || !canPinThreadItem(props.item)} />
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
  preferenceScope?: string;
  preferenceStorage?: FlowerDirectoryPreferenceStorage;
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
  onSelectFromWorkspace?: (threadID: string) => void;
  revealThreadID?: string;
  onRevealComplete?: (threadID: string) => void;
  navigationVisible?: boolean;
  onNewInDirectory?: (path: string) => void;
  onRefresh: () => void;
  onMenuAction?: (action: FlowerThreadMenuAction, thread: FlowerThreadListItem, restore?: HTMLElement) => void;
  directoryActions?: FlowerDirectoryMenuAvailability;
  visible?: boolean;
  referenceDisabledReason?: string;
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
  const [preferences, setPreferences] = createSignal(loadFlowerDirectoryPreferences(props.preferenceScope ?? 'default', props.preferenceStorage));
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [workspaceLimits, setWorkspaceLimits] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [workspacesOpen, setWorkspacesOpen] = createSignal(false);
  const [workspaceQuery, setWorkspaceQuery] = createSignal('');
  const [localRevealThreadID, setLocalRevealThreadID] = createSignal('');
  let restoreWorkspaceFocus = true;
  let workspaceTrigger: HTMLButtonElement | undefined;
  let workspaceGrid: HTMLDivElement | undefined;
  const [workspaceContainers, setWorkspaceContainers] = createSignal<ReadonlyMap<string, HTMLElement>>(new Map());
  const registerWorkspaceRows = (key: string, element: HTMLElement) => {
    setWorkspaceContainers(previous => new Map(previous).set(key, element));
    onCleanup(() => setWorkspaceContainers(previous => {
      if (previous.get(key) !== element) return previous;
      const next = new Map(previous); next.delete(key); return next;
    }));
  };
  createEffect(on(() => props.preferenceScope ?? 'default', scope => {
    setPreferences(loadFlowerDirectoryPreferences(scope, props.preferenceStorage));
    setCollapsed(new Set<string>());
    setLimits(new Map<string, number>());
    setWorkspaceLimits(new Map<string, number>());
  }, { defer: true }));
  const updatePreferences = (next: ReturnType<typeof preferences>) => {
    setPreferences(next);
    saveFlowerDirectoryPreferences(props.preferenceScope ?? 'default', next, props.preferenceStorage);
  };
  const filtered = createMemo(() => filterFlowerThreadItems(props.items, props.query));
  const itemByID = createMemo(() => new Map(props.items.map((item) => [item.thread_id, item] as const)));
  const pinnedItems = createMemo(() => props.items.filter(item => item.pinned).sort(comparePinnedFlowerThreads));
  const filteredPins = createMemo(() => filterFlowerThreadItems(pinnedItems(), props.query));
  const workspaceFiltered = createMemo(() => filterFlowerThreadItems(props.items, workspaceQuery()));
  const workspacePins = createMemo(() => filterFlowerThreadItems(pinnedItems(), workspaceQuery()));
  // Unfiltered sidebar and overview share the same summary grouping and activity counts.
  const allDirectoryGroups = createMemo(() => groupFlowerThreadsByDirectory(filterFlowerThreadItems(props.items, ''), preferences().order));
  const directoryGroups = createMemo(() => props.query.trim() ? groupFlowerThreadsByDirectory(filtered(), preferences().order) : allDirectoryGroups());
  const workspaceGroups = createMemo(() => workspaceQuery().trim() ? groupFlowerThreadsByDirectory(workspaceFiltered(), preferences().order) : allDirectoryGroups());
  const workspaceGroupByPath = createMemo(() => new Map(workspaceGroups().map(group => [group.path, group] as const)));
  const workspacePaths = createMemo(() => workspaceGroups().map(group => group.path));
  const workspaceRowGroups = createMemo(() => [
    { key: 'pinned', keys: workspacePins().map(item => `thread:${item.thread_id}`) },
    ...workspaceGroups().map(group => ({ key: `directory:${group.path}`, keys: [
      ...group.threads.slice(0, workspaceLimits().get(group.path) ?? FLOWER_DIRECTORY_PAGE_SIZE).map(item => `thread:${item.thread_id}`),
      ...(group.threads.length > (workspaceLimits().get(group.path) ?? FLOWER_DIRECTORY_PAGE_SIZE) ? [`more:${group.path}`] : []),
    ] })),
  ]);
  const workspaceRowKeys = createMemo(() => workspaceRowGroups().flatMap(group => group.keys));
  const workspaceRowTargets = createMemo(() => {
    const containers = workspaceContainers();
    const targets = new Map<string, HTMLElement>();
    for (const group of workspaceRowGroups()) {
      const container = containers.get(group.key);
      if (container) for (const key of group.keys) targets.set(key, container);
    }
    return targets;
  });
  const duplicateDirectoryNames = createMemo(() => {
    const counts = new Map<string, number>();
    for (const group of allDirectoryGroups()) if (group.path) {
      const name = flowerDirectoryName(group.path);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  });
  const groups = createMemo<readonly FlowerThreadRenderGroup[]>(() => preferences().mode === 'directory'
    ? [
      ...(filteredPins().length ? [{ key: 'pinned', kind: 'pinned' as const, threadIDs: filteredPins().map(thread => thread.thread_id) }] : []),
      ...directoryGroups().map(group => ({ key: `directory:${group.path}`, kind: 'directory' as const, path: group.path, runningCount: group.runningCount, threadIDs: group.threads.map(thread => thread.thread_id) })),
    ]
    : groupFlowerThreadItems(filtered()).map((group) => (
    group.kind === 'pinned'
      ? { key: 'pinned', kind: group.kind, threadIDs: group.threads.map((thread) => thread.thread_id) }
      : { key: `time:${group.group}`, kind: group.kind, group: group.group, threadIDs: group.threads.map((thread) => thread.thread_id) }
  )));
  const groupByKey = createMemo(() => new Map(groups().map((group) => [group.key, group] as const)));
  const rowKeys = createMemo(() => groups().flatMap((group) => {
    if (group.kind !== 'directory') return [`group:${group.key}`, ...group.threadIDs.map(id => `thread:${id}`)];
    const path = group.path!;
    const shown = collapsed().has(path) ? [] : group.threadIDs.slice(0, limits().get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE);
    return [`group:${group.key}`, ...shown.map(id => `thread:${id}`),
      ...(!collapsed().has(path) && shown.length < group.threadIDs.length ? [`more:${group.key}`] : []), `end:${group.key}`];
  }));
  const pinnedIDs = createMemo(() => pinnedItems().map(item => item.thread_id));
  const canReorder = createMemo(() => Boolean(props.onMovePinned && !props.pinBusy && !props.query.trim() && pinnedIDs().length > 1));
  const [drag, setDrag] = createSignal<{ threadID: string; keys: readonly string[]; target?: FlowerThreadPinPosition } | null>(null);
  const [directoryDrag, setDirectoryDrag] = createSignal<{ path: string; target?: { path: string; placement: 'before' | 'after' } } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = createSignal('');
  let directoryDragPreview: HTMLDivElement | undefined;
  let stopDirectoryGesture: (() => void) | undefined;
  let suppressDirectoryClick = false;
  const directoryReorderable = () => !props.query.trim() && allDirectoryGroups().length > 1;
  createEffect(() => {
    if (!directoryReorderable() || preferences().mode !== 'directory' || props.visible === false) stopDirectoryGesture?.();
    if (props.visible === false) setWorkspacesOpen(false);
  });
  const commitDirectoryMove = (path: string, anchor: string, placement: 'before' | 'after') => {
    const current = allDirectoryGroups().map(group => group.path);
    const order = moveFlowerDirectory(current, path, anchor, placement);
    if (order.every((value, index) => value === current[index])) return;
    animateFlowerThreadRowsChange(scrollRef?.querySelector<HTMLElement>('.flower-thread-rows'), () => {
      updatePreferences({ ...preferences(), order: [...order, ...preferences().order.filter(value => !order.includes(value))] });
    });
    setReorderAnnouncement(`${directoryLabel(path)}: ${order.indexOf(path) + 1} / ${order.length}`);
  };
  const directoryLabel = (path: string) => path ? flowerDirectoryName(path) : copy().noDirectory;
  const toggleDirectory = (path: string) => {
    if (suppressDirectoryClick) { suppressDirectoryClick = false; return; }
    animateFlowerThreadRowsChange(scrollRef?.querySelector<HTMLElement>('.flower-thread-rows'), () => {
      setCollapsed(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
      setLimits(previous => { const next = new Map(previous); next.delete(path); return next; });
    }, 'disclosure');
  };
  const showMore = (path: string, panel = false) => {
    const update = (previous: ReadonlyMap<string, number>) => new Map(previous).set(path, (previous.get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE) + FLOWER_DIRECTORY_PAGE_SIZE);
    const container = panel
      ? Array.from(workspaceGrid?.querySelectorAll<HTMLElement>('[data-flower-workspace]') ?? []).find(node => node.dataset.flowerWorkspace === path)?.querySelector<HTMLElement>('.flower-workspace-threads')
      : scrollRef?.querySelector<HTMLElement>('.flower-thread-rows');
    animateFlowerThreadRowsChange(container, () => { if (panel) setWorkspaceLimits(update); else setLimits(update); }, 'disclosure');
  };
  const togglePin = (item: FlowerThreadListItem, restore?: HTMLElement, panel = false) => {
    if (item.pinned && (panel || preferences().mode === 'directory')) {
      const path = item.working_dir.trim();
      const projected = props.items.map(value => value.thread_id === item.thread_id ? { ...value, pinned: false } : value);
      const group = groupFlowerThreadsByDirectory(filterFlowerThreadItems(projected, panel ? workspaceQuery() : props.query), preferences().order).find(value => value.path === path);
      const index = group?.threads.findIndex(value => value.thread_id === item.thread_id) ?? -1;
      if (!panel && collapsed().has(path)) setCollapsed(previous => { const next = new Set(previous); next.delete(path); return next; });
      const currentLimits = panel ? workspaceLimits() : limits();
      if (index >= (currentLimits.get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE)) {
        const update = (previous: ReadonlyMap<string, number>) => new Map(previous).set(path, Math.ceil((index + 1) / FLOWER_DIRECTORY_PAGE_SIZE) * FLOWER_DIRECTORY_PAGE_SIZE);
        if (panel) setWorkspaceLimits(update); else setLimits(update);
      }
    }
    if (restore) props.onMenuAction?.('pin', item, restore);
    else props.onMenuAction?.('pin', item);
    if (panel || preferences().mode === 'directory') requestAnimationFrame(() => {
      const viewport = panel ? workspaceGrid?.closest<HTMLElement>('.flower-workspaces-scroll') : scrollRef;
      const row = Array.from(viewport?.querySelectorAll<HTMLElement>(panel ? '[data-flower-workspace-thread-id]' : '[data-flower-thread-card]') ?? [])
        .find(node => (panel ? node.dataset.flowerWorkspaceThreadId : node.dataset.threadId) === item.thread_id);
      if (!row || !viewport || !row.isConnected) return;
      const bounds = viewport.getBoundingClientRect(), target = row.getBoundingClientRect();
      if (target.top < bounds.top) viewport.scrollTop += target.top - bounds.top;
      else if (target.bottom > bounds.bottom) viewport.scrollTop += target.bottom - bounds.bottom;
    });
  };
  createEffect(() => {
    const threadID = props.revealThreadID || localRevealThreadID();
    if (!threadID || props.visible === false || props.navigationVisible === false) return;
    const item = itemByID().get(threadID);
    if (!item) return;
    if (props.query.trim()) { props.onQueryChange(''); return; }
    if (preferences().mode === 'directory' && !item.pinned) {
      const path = item.working_dir.trim();
      const index = allDirectoryGroups().find(group => group.path === path)?.threads.findIndex(thread => thread.thread_id === threadID) ?? -1;
      if (index < 0) return;
      if (collapsed().has(path)) setCollapsed(previous => { const next = new Set(previous); next.delete(path); return next; });
      if ((limits().get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE) <= index) {
        setLimits(previous => new Map(previous).set(path, Math.ceil((index + 1) / FLOWER_DIRECTORY_PAGE_SIZE) * FLOWER_DIRECTORY_PAGE_SIZE));
      }
    }
    const frame = requestAnimationFrame(() => {
      if (!scrollRef?.isConnected || props.visible === false || props.navigationVisible === false) return;
      const row = Array.from(scrollRef.querySelectorAll<HTMLElement>('[data-flower-thread-card]')).find(node => node.dataset.threadId === threadID);
      if (!row || scrollRef.clientHeight === 0) return;
      const viewport = scrollRef.getBoundingClientRect(), target = row.getBoundingClientRect();
      if (target.top < viewport.top) scrollRef.scrollTop += target.top - viewport.top;
      else if (target.bottom > viewport.bottom) scrollRef.scrollTop += target.bottom - viewport.bottom;
      setLocalRevealThreadID('');
      props.onRevealComplete?.(threadID);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const moveDirectoryWithKeyboard = (event: KeyboardEvent, path: string) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !directoryReorderable()) return;
    event.preventDefault();
    const paths = allDirectoryGroups().map(entry => entry.path);
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const anchor = paths[paths.indexOf(path) + direction];
    if (anchor !== undefined) commitDirectoryMove(path, anchor, direction < 0 ? 'before' : 'after');
  };
  const beginDirectoryGesture = (event: PointerEvent, path: string) => {
    if (!directoryReorderable() || !event.isPrimary || event.button !== 0 || stopDirectoryGesture || !scrollRef) return;
    for (const animation of scrollRef.getAnimations({ subtree: true })) {
      if (animation.id === 'flower-thread-layout' || animation.id === 'flower-thread-exit' || animation.id === 'flower-thread-disclosure') animation.finish();
    }
    const startX = event.clientX, startY = event.clientY, pointerID = event.pointerId;
    const source = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-flower-directory-header]')!;
    const sourceRect = source.getBoundingClientRect();
    const grabY = startY - sourceRect.top;
    const width = Math.min(sourceRect.width, 280);
    const grabX = Math.min(startX - sourceRect.left, width - 12);
    const ends = new Map(Array.from(scrollRef.querySelectorAll<HTMLElement>('[data-flower-directory-end]')).map(node => [node.dataset.flowerDirectoryEnd, node]));
    const groups = Array.from(scrollRef.querySelectorAll<HTMLElement>('[data-flower-directory-header]')).map(header => ({ header, end: ends.get(header.dataset.flowerDirectoryHeader) }));
    let active = false;
    let latestX = startX, latestY = startY;
    let scrollFrame: number | undefined;
    let timer: number | undefined;
    const targetAt = () => {
      const state = directoryDrag();
      if (!state || !scrollRef) return;
      const bounds = scrollRef.getBoundingClientRect();
      let target: { path: string; placement: 'before' | 'after' } | undefined;
      if (latestX >= bounds.left - 32 && latestX <= bounds.right + 32) {
        const rectangles = groups.map(group => ({ ...group, top: group.header.getBoundingClientRect().top, bottom: (group.end ?? group.header).getBoundingClientRect().bottom }));
        const group = rectangles.find(group => latestY <= group.bottom) ?? rectangles.at(-1);
        const anchor = group?.header.dataset.flowerDirectoryHeader;
        if (group && anchor !== undefined && anchor !== path) target = { path: anchor, placement: latestY < (group.top + group.bottom) / 2 ? 'before' : 'after' };
      }
      if (state.target?.path !== target?.path || state.target?.placement !== target?.placement) setDirectoryDrag({ path, target });
    };
    const paintPreview = () => {
      if (!directoryDragPreview) return;
      directoryDragPreview.style.width = `${width}px`;
      directoryDragPreview.style.transform = `translate3d(${Math.max(8, Math.min(window.innerWidth - width - 8, latestX - grabX))}px, ${latestY - grabY + 16}px, 0)`;
    };
    const scroll = () => {
      scrollFrame = undefined;
      if (!active || !scrollRef) return;
      paintPreview();
      const rect = scrollRef.getBoundingClientRect();
      const distance = latestY < rect.top + 40 ? latestY - rect.top - 40 : latestY > rect.bottom - 40 ? latestY - rect.bottom + 40 : 0;
      const previous = scrollRef.scrollTop;
      if (latestX >= rect.left - 32 && latestX <= rect.right + 32) scrollRef.scrollTop += Math.max(-14, Math.min(14, distance / 3));
      targetAt();
      if (scrollRef.scrollTop !== previous) scrollFrame = requestAnimationFrame(scroll);
    };
    const activate = () => {
      active = true;
      document.documentElement.style.cursor = 'grabbing';
      suppressDirectoryClick = true;
      setDirectoryDrag({ path });
      paintPreview();
      targetAt();
    };
    if (event.pointerType === 'touch') timer = window.setTimeout(activate, 350);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerID) return;
      latestX = next.clientX; latestY = next.clientY;
      const distance = Math.hypot(latestX - startX, latestY - startY);
      if (!active && event.pointerType === 'touch' && distance > 8) { stopDirectoryGesture?.(); return; }
      if (!active && event.pointerType !== 'touch' && distance > 5) activate();
      if (!active) return;
      next.preventDefault();
      if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(scroll);
    };
    const preventTouchScroll = (next: TouchEvent) => { if (active) next.preventDefault(); };
    const finish = (next?: PointerEvent) => {
      if (next && next.pointerId !== pointerID) return;
      if (next?.type === 'pointerup' && active) {
        latestX = next.clientX; latestY = next.clientY;
        targetAt();
        const target = directoryDrag()?.target;
        if (target) commitDirectoryMove(path, target.path, target.placement);
      }
      if (active) window.setTimeout(() => { suppressDirectoryClick = false; }, 0);
      stopDirectoryGesture?.();
    };
    const cancel = () => finish();
    const selection = (next: Event) => { if (active) next.preventDefault(); };
    const originalCursor = document.documentElement.style.cursor;
    stopDirectoryGesture = () => {
      stopDirectoryGesture = undefined;
      if (active) window.setTimeout(() => { suppressDirectoryClick = false; }, 0);
      if (timer !== undefined) window.clearTimeout(timer);
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('touchmove', preventTouchScroll);
      document.removeEventListener('selectstart', selection, true);
      document.removeEventListener('contextmenu', selection, true);
      document.documentElement.style.cursor = originalCursor;
      setDirectoryDrag(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', cancel);
    if (event.pointerType === 'touch') window.addEventListener('touchmove', preventTouchScroll, { passive: false });
    document.addEventListener('selectstart', selection, true);
    document.addEventListener('contextmenu', selection, true);
  };
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
    const rows = Array.from(scrollRef.querySelectorAll<HTMLElement>('[data-flower-thread-card][data-pinned="true"]'))
      .filter(row => !row.dataset.flowerThreadExiting);
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
  const escapeDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelDrag(); stopDirectoryGesture?.(); } };
  document.addEventListener('keydown', escapeDrag);
  window.addEventListener('blur', cancelDrag);
  onCleanup(() => { cancelDrag(); stopDirectoryGesture?.(); document.removeEventListener('keydown', escapeDrag); window.removeEventListener('blur', cancelDrag); });
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
  const [menuPanel, setMenuPanel] = createSignal<HTMLDivElement>();
  const menuPresence = createFloatingPresence({ open: () => Boolean(menuPresentation()), element: menuPanel });
  const presentedMenu = createMemo<ReturnType<typeof menuPresentation>>(previous => menuPresentation()
    ?? (menuPresence.mounted() ? previous ?? null : null));
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

  const closeMenu = (restoreFocus = true) => {
    const state = menu();
    const restore = state ? resolveMenuRestore(state) : undefined;
    setMenu(null);
    if (restoreFocus) restore?.focus({ preventScroll: true });
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
    <div ref={listRef} class="flower-thread-list flex min-h-0 flex-col gap-2 p-2" data-view={preferences().mode}>
      <div class="flower-thread-list-toolbar flex flex-col gap-2">
        <div class="flower-thread-list-header flex items-center gap-2">
          <div class="flower-thread-list-heading min-w-0 flex-1">
            <h2 class="flower-thread-list-title truncate font-medium">{copy().title}</h2>
            <Show when={props.warmup || props.loading}>
              <p class="sr-only" role="status">{copy().warmupDescription}</p>
            </Show>
          </div>
          <SegmentedControl class="flower-thread-view-switch" role="radiogroup" aria-label={copy().title} size="sm"
            value={preferences().mode} onChange={mode => {
              updatePreferences({ ...preferences(), mode: mode === 'directory' ? 'directory' : 'time' });
              const rows = scrollRef?.querySelector<HTMLElement>('.flower-thread-rows');
              if (rows && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                for (const animation of rows.getAnimations()) if (animation.id === 'flower-thread-view') animation.cancel();
                const style = getComputedStyle(rows);
                const animation = rows.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: parseFloat(style.getPropertyValue('--floe-duration-fast')) || 140, easing: style.getPropertyValue('--floe-ease-out').trim() || 'ease-out' });
                animation.id = 'flower-thread-view';
              }
            }}
            options={[{ value: 'time', label: copy().viewByTime, icon: Clock }, { value: 'directory', label: copy().viewByDirectory, icon: Folder }]} />
          <button ref={workspaceTrigger} type="button" class="flower-thread-workspaces-button" aria-haspopup="dialog" aria-expanded={workspacesOpen()} aria-label={copy().workspaces} title={copy().workspaces}
            disabled={showLoadingSkeleton()} onClick={() => { setMenu(null); setWorkspaceQuery(''); setWorkspaceLimits(new Map()); restoreWorkspaceFocus = true; setWorkspacesOpen(true); }}><Grid class="h-3.5 w-3.5" /></button>
          <button
            type="button"
            class="flower-thread-refresh-button flex cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={copy().refreshLabel}
            title={copy().refreshLabel}
            aria-busy={props.refreshing || props.warmup || props.loading}
            disabled={props.refreshing || props.warmup || props.loading}
            onClick={props.onRefresh}
          >
            <Refresh class={cn('h-3.5 w-3.5', (props.refreshing || props.warmup || props.loading) && 'animate-spin')} />
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
      </div>
      <span class="sr-only" aria-live="polite">{reorderAnnouncement()}</span>
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
          <div class="flower-thread-warmup-list flower-thread-rows" role="status" aria-live="polite" aria-label={copy().warmupDescription}>
            <div class="flower-thread-group-label px-1 text-[11px] font-semibold uppercase tracking-[0.08em]" aria-hidden="true">
              <span class="flower-thread-warmup-line flower-thread-warmup-line-group" />
            </div>
            <For each={warmupRows}>
              {(row) => (
                <div class="flower-thread-warmup-card" data-row={String(row)} aria-hidden="true">
                  <div class="flower-thread-card-select-button">
                    <span class="flower-thread-indicator h-2 shrink-0" />
                    <span class="flower-thread-list-title min-w-0 flex-1">
                      <span class="flower-thread-warmup-line flower-thread-warmup-line-title" />
                    </span>
                  </div>
                  <div class="flower-thread-card-trailing" data-has-timestamp="true">
                    <div class="flower-thread-card-summary">
                      <span class="flower-thread-card-time flower-thread-warmup-line flower-thread-warmup-time" />
                    </div>
                    <span class="flower-thread-warmup-menu">
                      <span class="flower-thread-warmup-line" />
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        )}>
          <Show when={!showLoadError()} fallback={(
            <div class="flower-thread-empty rounded-lg border border-dashed p-6 flower-body-copy" role="alert">
              <div class="font-medium">{props.errorTitle || copy().title}</div>
              <div class="mt-1 text-xs text-muted-foreground">{props.error}</div>
              <button
                type="button"
                class="mt-3 rounded-md border px-3 py-1.5 text-xs font-medium"
                onClick={props.onRefresh}
                disabled={props.refreshing}
              >
                <StableText reserve={[copy().working, props.errorRetryLabel || copy().refreshLabel]}>{props.refreshing ? copy().working : (props.errorRetryLabel || copy().refreshLabel)}</StableText>
              </button>
            </div>
          )}>
            <Show
              when={filtered().length > 0}
              fallback={<div class="flower-thread-empty rounded-lg border border-dashed p-6 flower-body-copy">{copy().empty}</div>}
            >
            <FlowerThreadRows keys={visibleKeys()} render={(key) => {
              if (key.startsWith('group:')) {
                const group = () => groupByKey().get(key.slice(6));
                if (key.startsWith('group:directory:')) {
                  const path = key.slice('group:directory:'.length);
                  return <div class="flower-directory-header" data-flower-directory-header={path}
                    data-dragging={directoryDrag()?.path === path ? 'true' : undefined}
                    data-drop-before={directoryDrag()?.target?.path === path && directoryDrag()?.target?.placement === 'before' ? 'true' : undefined}>
                    <button type="button" class="flower-directory-toggle" aria-expanded={!collapsed().has(path)}
                      title={path || copy().noDirectory} aria-label={path || copy().noDirectory} aria-description={directoryReorderable() ? copy().reorderDirectory : undefined}
                      onPointerDown={event => beginDirectoryGesture(event, path)}
                      onClick={() => toggleDirectory(path)}
                      onKeyDown={event => moveDirectoryWithKeyboard(event, path)}>
                      <ChevronRight class="flower-directory-chevron h-3 w-3 shrink-0" />
                      <Folder class="h-3.5 w-3.5 shrink-0" /><span class="flower-directory-name" data-full-path={duplicateDirectoryNames().has(directoryLabel(path)) ? 'true' : undefined}>{duplicateDirectoryNames().has(directoryLabel(path)) ? path : directoryLabel(path)}</span><span class="flower-directory-count">{group()?.threadIDs.length}</span>
                    </button>
                    <Show when={collapsed().has(path) && (group()?.runningCount ?? 0) > 0}>
                      <span class="flower-directory-running" data-flower-thread-indicator="wave" role="img" aria-label={copy().statuses.running} title={copy().statuses.running}><FlowerThreadWave /></span>
                    </Show>
                    <Show when={path && props.onNewInDirectory}><button type="button" class="flower-directory-new" aria-label={copy().newInDirectory(path)}
                      title={copy().newInDirectory(path)} disabled={props.warmup || props.loading} onClick={() => props.onNewInDirectory?.(path)}><Plus class="h-3.5 w-3.5" /></button></Show>
                  </div>;
                }
                return <h3 class="flower-thread-group-label px-1 text-[11px] font-semibold" data-pinned-group={group()?.kind === 'pinned' ? 'true' : undefined}>
                  {group()?.kind === 'pinned' ? copy().pinnedGroup : timeGroupLabel(group()?.group ?? 'older', copy())}
                </h3>;
              }
              if (key.startsWith('more:directory:')) {
                const path = key.slice('more:directory:'.length);
                const group = () => groupByKey().get(`directory:${path}`);
                return <button type="button" class="flower-directory-more" onClick={() => showMore(path)}>
                  {copy().showMoreThreads(Math.min(FLOWER_DIRECTORY_PAGE_SIZE, (group()?.threadIDs.length ?? 0) - (limits().get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE)))}
                </button>;
              }
              if (key.startsWith('end:directory:')) {
                const path = key.slice('end:directory:'.length);
                return <div class="flower-directory-end" data-flower-directory-end={path}
                  data-drop-after={directoryDrag()?.target?.path === path && directoryDrag()?.target?.placement === 'after' ? 'true' : undefined} />;
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
                onPin={props.canPin && props.onMenuAction ? value => togglePin(value) : undefined}
                pinBusy={props.pinBusy}
                reorderable={canReorder()}
                onDragStart={props.onMovePinned ? startDrag : undefined}
                onDragOver={overDrag}
                onDragEnd={cancelDrag}
                onDrop={dropDrag}
                dragging={drag()?.threadID === threadID || (!item().pinned && directoryDrag()?.path === item().working_dir.trim())}
                dropPosition={drag()?.target?.anchor_thread_id === threadID ? drag()?.target?.placement : undefined}
              />;
            }} />
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={directoryDrag()}>{state => <Portal>
        <div ref={directoryDragPreview} class="flower-directory-drag-preview" data-flower-directory-drag-preview data-floe-surface="floating" aria-hidden="true">
          <Folder class="h-4 w-4" />
          <span>{directoryLabel(state().path)}</span><span class="flower-directory-count">{allDirectoryGroups().find(group => group.path === state().path)?.threads.length}</span>
        </div>
      </Portal>}</Show>
      <DialogPlacementProvider mode="global">
        <Dialog open={workspacesOpen() && props.visible !== false} onOpenChange={setWorkspacesOpen} title={<span class="flower-workspaces-title"><Grid class="h-4 w-4" />{copy().workspaces}</span>} closeLabel={copy().closeWorkspaces}
          class="flower-workspaces-dialog" contentClass="flower-workspaces-dialog-content overflow-hidden" onPresenceChange={present => {
            if (!present && !workspacesOpen() && restoreWorkspaceFocus) queueMicrotask(() => {
              if (document.activeElement === document.body) workspaceTrigger?.focus({ preventScroll: true });
            });
          }}>
          <label class="flower-workspaces-search relative block">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input class="pl-9" value={workspaceQuery()} placeholder={copy().searchPlaceholder} aria-label={copy().searchPlaceholder}
              onInput={event => { setWorkspaceQuery(event.currentTarget.value); setWorkspaceLimits(new Map()); }} />
          </label>
          <div class="flower-workspaces-scroll">
            <section class="flower-workspace-pins" aria-label={copy().pinnedGroup}>
              <h3 class="flower-thread-group-label" data-pinned-group="true">{copy().pinnedGroup}</h3>
              <div class="flower-workspace-threads" ref={element => registerWorkspaceRows('pinned', element)} />
            </section>
            <div ref={workspaceGrid} class="flower-workspaces-grid">
              <Show when={workspacePaths().length > 0} fallback={<div class="flower-workspaces-empty">{copy().empty}</div>}>
                <For each={[0, 1]}>{column => <div class="flower-workspaces-column">
                  <For each={workspacePaths().slice(column * Math.ceil(workspacePaths().length / 2), (column + 1) * Math.ceil(workspacePaths().length / 2))}>{path => {
                    const threads = () => workspaceGroupByPath().get(path)?.threads ?? [];
                    return <Card variant="well" class="flower-workspace-card" role="group" aria-label={path || copy().noDirectory} data-flower-workspace={path}>
                      <div class="flower-workspace-heading">
                        <div class="flower-workspace-icon"><Folder class="h-4 w-4" /></div>
                        <div class="flower-workspace-identity">
                          <div class="flower-workspace-name" title={path || copy().noDirectory}>{directoryLabel(path)}</div>
                          <Show when={path}><div class="flower-workspace-path" title={path}>{path}</div></Show>
                        </div>
                        <span class="flower-directory-count">{threads().length}</span>
                        <Show when={path && props.onNewInDirectory}><button type="button" class="flower-directory-new" aria-label={copy().newInDirectory(path)}
                          title={copy().newInDirectory(path)} disabled={props.warmup || props.loading}
                          onClick={() => { restoreWorkspaceFocus = false; setWorkspacesOpen(false); props.onNewInDirectory?.(path); }}><Plus class="h-4 w-4" /></button></Show>
                      </div>
                      <div class="flower-workspace-threads" ref={element => registerWorkspaceRows(`directory:${path}`, element)} />
                    </Card>;
                  }}</For>
                </div>}</For>
              </Show>
            </div>
            <FlowerThreadRows class="flower-workspace-row-owner" keys={workspaceRowKeys()} targets={workspaceRowTargets()} render={key => {
              if (key.startsWith('more:')) {
                const path = key.slice('more:'.length);
                return <button type="button" class="flower-directory-more" onClick={() => showMore(path, true)}>
                  {copy().showMoreThreads(Math.min(FLOWER_DIRECTORY_PAGE_SIZE, (workspaceGroupByPath().get(path)?.threads.length ?? 0) - (workspaceLimits().get(path) ?? FLOWER_DIRECTORY_PAGE_SIZE)))}
                </button>;
              }
              const threadID = key.slice('thread:'.length);
              const item = createMemo<FlowerThreadListItem>(previous => itemByID().get(threadID) ?? previous!);
              const indicator = () => flowerThreadIndicator(item(), copy());
              return <div class="flower-workspace-thread" data-flower-workspace-thread-id={threadID} data-flower-thread-indicator={indicator().visual} data-pinned={item().pinned ? 'true' : undefined} data-active={props.activeThreadID === threadID ? 'true' : undefined}>
                <button type="button" class="flower-workspace-thread-select" aria-current={props.activeThreadID === threadID ? 'true' : undefined}
                  aria-label={[item().title, indicator().ariaStatus, indicator().attention === 'unread' ? copy().unread : '', item().pinned ? copy().pinnedGroup : ''].filter(Boolean).join(', ')}
                  onClick={() => {
                    restoreWorkspaceFocus = false;
                    setWorkspacesOpen(false);
                    setLocalRevealThreadID(threadID);
                    if (props.onSelectFromWorkspace) props.onSelectFromWorkspace(threadID); else props.onSelect(threadID);
                  }}>
                  <span class="flower-workspace-indicator" title={indicator().title} aria-hidden="true">
                    <Show when={indicator().visual === 'wave'}><FlowerThreadWave /></Show>
                    <Show when={indicator().visual === 'dot'}><span class="flower-workspace-unread" /></Show>
                    <Show when={indicator().actionRequired}><Show when={item().status === 'waiting_approval'} fallback={<MessageSquare class="h-3 w-3" />}><ShieldCheck class="h-3 w-3" /></Show></Show>
                  </span>
                  <span class="flower-workspace-thread-title">{item().title}</span><span class="flower-workspace-thread-time">{fmtFlowerShortTime(item().created_at_ms, copy())}</span>
                </button>
                <Show when={props.canPin && props.onMenuAction && canPinThreadItem(item())}><button type="button" class="flower-workspace-thread-pin" aria-label={`${item().pinned ? copy().unpin : copy().pin}: ${item().title}`}
                  title={item().pinned ? copy().unpin : copy().pin} aria-pressed={item().pinned} disabled={props.pinBusy} onClick={() => togglePin(item(), undefined, true)}>
                  <FlowerPinIcon pinned={item().pinned} class="h-3.5 w-3.5" /></button></Show>
              </div>;
            }} />
          </div>
        </Dialog>
      </DialogPlacementProvider>
      <Show when={menuPresence.mounted() && presentedMenu()}>
        {(state) => (
          <FlowerThreadContextMenu
            presenceState={menuPresence.state()}
            onPanelRef={setMenuPanel}
            item={state().item}
            workingDirectory={state().workingDirectory}
            directoryActions={props.directoryActions}
            x={state().x}
            y={state().y}
            copy={copy()}
            referenceDisabledReason={props.referenceDisabledReason}
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
              } else if (action === 'pin') togglePin(item, restore);
              else props.onMenuAction?.(action, item, restore);
            }}
          />
        )}
      </Show>
    </div>
  );
};
