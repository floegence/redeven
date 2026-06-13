import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Copy, Folder, GitBranch, MoreHorizontal, Pencil, Pin, Refresh, Search, X } from '@floegence/floe-webapp-core/icons';
import { Input, Tag } from '@floegence/floe-webapp-core/ui';

import type { FlowerThreadListCopy, FlowerThreadTimeGroup } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems, type FlowerThreadGroup } from './threadListModel';

type TimeGroup = FlowerThreadTimeGroup;
export type FlowerThreadMenuAction = 'copy_thread_id' | 'fork' | 'copy_workdir' | 'pin' | 'rename';
export type { FlowerThreadGroup };

type FlowerThreadRenderGroup = Readonly<{
  key: string;
  kind: FlowerThreadGroup['kind'];
  group?: TimeGroup;
  threadIDs: readonly string[];
}>;

function canForkThreadItem(item: FlowerThreadListItem): boolean {
  switch (item.status) {
    case 'running':
    case 'waiting_approval':
    case 'waiting_user':
    case 'read_only':
      return false;
    default:
      return true;
  }
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
  busy?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onContextMenu?: (event: MouseEvent, item: FlowerThreadListItem) => void;
  onKeyboardMenu?: (event: KeyboardEvent, item: FlowerThreadListItem) => void;
  onRename?: (item: FlowerThreadListItem) => void;
  onPin?: (item: FlowerThreadListItem) => void;
}>;

export const FlowerThreadCard: Component<FlowerThreadCardProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const title = () => props.item.title.trim() || copy().untitled;
  const indicator = createMemo(() => flowerThreadIndicator(props.item, props.active, copy()));
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
      data-flower-thread-indicator={indicator().visual}
      data-flower-thread-unread={indicator().attention === 'unread' ? 'true' : 'false'}
      data-flower-thread-action-required={indicator().actionRequired ? 'true' : 'false'}
      onContextMenu={(event) => props.onContextMenu?.(event, props.item)}
      class={cn(
        'flower-host-thread-card group relative w-full cursor-pointer rounded-lg border',
        props.active && 'flower-host-thread-card-active',
      )}
    >
      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        aria-label={ariaLabel()}
        aria-current={props.active ? 'true' : undefined}
        onClick={props.onSelect}
        onDblClick={(event) => {
          event.preventDefault();
          props.onRename?.(props.item);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            props.onKeyboardMenu?.(event, props.item);
          }
        }}
      >
        <div class="flower-host-thread-indicator relative mt-1.5 flex h-2 shrink-0 items-center justify-center" aria-hidden="true" title={indicator().title}>
          <div class="flower-host-thread-wave h-2 items-center gap-0.5">
            <div class="flower-host-thread-wave-bar" style="animation-delay: 0ms" />
            <div class="flower-host-thread-wave-bar" style="animation-delay: 180ms" />
            <div class="flower-host-thread-wave-bar" style="animation-delay: 360ms" />
            <div class="flower-host-thread-wave-bar" style="animation-delay: 540ms" />
          </div>
          <div class="flower-host-thread-status-dot h-2 w-2 rounded-full" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="flower-host-thread-list-title flex-1 truncate text-xs font-medium">{title()}</span>
          </div>
          <Show when={props.item.target_labels.length > 0}>
            <div class="mt-1 flex min-w-0 flex-wrap gap-1">
              <For each={props.item.target_labels}>
                {(label) => <Tag variant="neutral" class="max-w-[9rem] truncate px-1.5 py-0 text-[10px]">{label}</Tag>}
              </For>
            </div>
          </Show>
        </div>
      </button>
      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <Show
          when={props.canDelete && props.onDelete}
          fallback={<span class="flower-host-thread-card-time select-none text-[10px] transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true">{fmtFlowerShortTime(props.item.created_at_ms, copy())}</span>}
        >
          <span class="flower-host-thread-card-time select-none text-[10px] transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true">
            {fmtFlowerShortTime(props.item.created_at_ms, copy())}
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
      <Show when={props.onPin}>
        <button
          type="button"
          class="flower-host-thread-card-pin-button"
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
        class="flower-host-thread-card-menu-button"
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
  actionsBusy: boolean;
  busyAction: FlowerThreadMenuAction | null;
  onAction: (action: FlowerThreadMenuAction, item: FlowerThreadListItem) => void;
  onClose: () => void;
}>;

const FlowerThreadContextMenu: Component<FlowerThreadContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined;
  const left = () => `${Math.min(Math.max(props.x, 8), Math.max(8, window.innerWidth - 224))}px`;
  const top = () => `${Math.min(Math.max(props.y, 8), Math.max(8, window.innerHeight - 232))}px`;
  const focusableItems = () => Array.from(menuRef?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
  const focusItem = (delta: number) => {
    const items = focusableItems();
    if (items.length === 0) return;
    const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
    items[(current + delta + items.length) % items.length]?.focus();
  };
  const focusMenu = () => {
    const first = focusableItems()[0];
    if (first) {
      first.focus();
      return;
    }
    menuRef?.focus();
  };
  createEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef && event.target instanceof Node && menuRef.contains(event.target)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!menuRef) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (!(event.target instanceof Node) || !menuRef.contains(event.target)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusItem(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusItem(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusableItems()[0]?.focus();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        const items = focusableItems();
        items[items.length - 1]?.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!menuRef || !(event.target instanceof Node) || menuRef.contains(event.target)) return;
      props.onClose();
    };
    const onScrollOrResize = () => props.onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    queueMicrotask(() => {
      focusMenu();
    });
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    });
  });
  const action = (kind: FlowerThreadMenuAction) => {
    props.onAction(kind, props.item);
  };
  const workdir = () => String(props.item.working_dir ?? '').trim();
  const itemButton = (
    kind: FlowerThreadMenuAction,
    label: string,
    icon: JSX.Element,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      class="flower-host-thread-menu-item"
      disabled={disabled || props.actionsBusy}
      aria-busy={props.busyAction === kind ? 'true' : undefined}
      onClick={() => action(kind)}
    >
      {icon}
      <span>{props.busyAction === kind ? props.copy.working : label}</span>
    </button>
  );
  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      class="flower-host-thread-context-menu"
      style={{ left: left(), top: top() }}
      aria-label={props.copy.contextMenuLabel(props.item.title || props.copy.untitled)}
    >
      {itemButton('copy_thread_id', props.copy.copyThreadID, <Copy class="h-3.5 w-3.5" />)}
      {itemButton('fork', props.copy.fork, <GitBranch class="h-3.5 w-3.5" />, !props.canFork || !canForkThreadItem(props.item))}
      {itemButton('copy_workdir', props.copy.copyWorkingDirectory, <Folder class="h-3.5 w-3.5" />, workdir() === '')}
      <div class="flower-host-thread-menu-separator" />
      {itemButton('pin', props.item.pinned ? props.copy.unpin : props.copy.pin, <Pin class={cn('h-3.5 w-3.5', props.item.pinned && 'text-primary')} />, !props.canPin)}
      {itemButton('rename', props.copy.rename, <Pencil class="h-3.5 w-3.5" />, !props.canRename)}
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
  onMenuAction?: (action: FlowerThreadMenuAction, thread: FlowerThreadListItem, restore?: HTMLElement) => void;
  canFork?: boolean;
  canRename?: boolean;
  canPin?: boolean;
  busyThreadID?: string;
  busyAction?: FlowerThreadMenuAction | null;
  actionsBusy?: boolean;
}>;

export const FlowerThreadList: Component<FlowerThreadListProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const filtered = createMemo(() => filterFlowerThreadItems(props.items, props.query));
  const itemByID = createMemo(() => new Map(filtered().map((item) => [item.thread_id, item] as const)));
  const groups = createMemo<readonly FlowerThreadRenderGroup[]>(() => groupFlowerThreadItems(filtered()).map((group) => (
    group.kind === 'pinned'
      ? { key: 'pinned', kind: group.kind, threadIDs: group.threads.map((thread) => thread.thread_id) }
      : { key: `time:${group.group}`, kind: group.kind, group: group.group, threadIDs: group.threads.map((thread) => thread.thread_id) }
  )));
  const groupByKey = createMemo(() => new Map(groups().map((group) => [group.key, group] as const)));
  const groupKeys = createMemo(() => groups().map((group) => group.key));
  const [menu, setMenu] = createSignal<{ item: FlowerThreadListItem; x: number; y: number; restore?: HTMLElement } | null>(null);

  const openMenu = (event: MouseEvent | KeyboardEvent, item: FlowerThreadListItem) => {
    event.preventDefault();
    event.stopPropagation();
    let x = 0;
    let y = 0;
    let restore: HTMLElement | undefined;
    if (event instanceof MouseEvent && event.clientX > 0 && event.clientY > 0) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const rect = target?.getBoundingClientRect();
      x = rect ? rect.left + 18 : 24;
      y = rect ? rect.top + 18 : 24;
    }
    if (event.currentTarget instanceof HTMLButtonElement) {
      restore = event.currentTarget;
    } else if (event.currentTarget instanceof HTMLElement) {
      restore = event.currentTarget.querySelector('button') ?? undefined;
    }
    setMenu({ item, x, y, restore });
  };

  const closeMenu = () => {
    const restore = menu()?.restore;
    setMenu(null);
    restore?.focus();
  };

  createEffect(() => {
    const closeKey = [props.query, props.activeThreadID, props.items.length].join('\x00');
    void closeKey;
    setMenu(null);
  });

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
      <div class="flower-host-scroll flex-1 space-y-2">
        <Show
          when={filtered().length > 0}
          fallback={<div class="flower-host-thread-empty rounded-lg border border-dashed p-6 text-sm">{copy().empty}</div>}
        >
          <For each={groupKeys()}>
            {(groupKey) => {
              const group = () => groupByKey().get(groupKey);
              return (
              <section class="space-y-1">
                <h3 class="flower-host-thread-group-label px-1 text-[10px] font-semibold uppercase tracking-[0.08em]">
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
                            canDelete={!!props.onDelete}
                            busy={props.busyThreadID === threadID}
                            onSelect={() => props.onSelect(threadID)}
                            onDelete={props.onDelete ? () => props.onDelete?.(threadID) : undefined}
                            onContextMenu={openMenu}
                            onKeyboardMenu={openMenu}
                            onRename={props.onMenuAction ? (value) => props.onMenuAction?.('rename', value) : undefined}
                            onPin={props.canPin && props.onMenuAction ? (value) => props.onMenuAction?.('pin', value) : undefined}
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
      </div>
      <Show when={menu()}>
        {(state) => (
          <FlowerThreadContextMenu
            item={state().item}
            x={state().x}
            y={state().y}
            copy={copy()}
            canFork={!!props.canFork}
            canRename={!!props.canRename}
            canPin={!!props.canPin}
            actionsBusy={!!props.actionsBusy}
            busyAction={props.busyThreadID === state().item.thread_id ? props.busyAction ?? null : null}
            onClose={closeMenu}
            onAction={(action, item) => {
              const restore = state().restore;
              setMenu(null);
              props.onMenuAction?.(action, item, restore);
            }}
          />
        )}
      </Show>
    </div>
  );
};
