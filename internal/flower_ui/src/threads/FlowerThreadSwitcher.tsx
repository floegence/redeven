import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Plus, Search } from '@floegence/floe-webapp-core/icons';

import type { FlowerThreadListCopy } from '../copy';
import type { FlowerCompanionThreadListItem } from '../flowerCompanionPresence';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems } from './threadListModel';

export type FlowerThreadSwitcherGroupKind = 'attention' | 'working' | 'pinned' | 'recent';

export type FlowerThreadSwitcherGroup = Readonly<{
  kind: FlowerThreadSwitcherGroupKind;
  threads: readonly FlowerCompanionThreadListItem[];
}>;

export type FlowerThreadSwitcherCopy = Readonly<{
  label: string;
  searchPlaceholder: string;
  newConversation: string;
  empty: string;
  queued: string;
  groups: Readonly<Record<FlowerThreadSwitcherGroupKind, string>>;
  threadList: FlowerThreadListCopy;
}>;

const GROUP_ORDER: readonly FlowerThreadSwitcherGroupKind[] = ['attention', 'working', 'pinned', 'recent'];

function queuedTurnCount(item: FlowerCompanionThreadListItem): number {
  return Number.isFinite(item.queued_turn_count) ? Math.max(0, Number(item.queued_turn_count)) : 0;
}

export function groupFlowerThreadSwitcherItems(
  items: readonly FlowerCompanionThreadListItem[],
  query: string,
  copy: FlowerThreadListCopy,
): FlowerThreadSwitcherGroup[] {
  const filtered = filterFlowerThreadItems(items, query);
  const ordered = groupFlowerThreadItems(filtered).flatMap((group) => group.threads);
  const seen = new Set<string>();
  const groups: Record<FlowerThreadSwitcherGroupKind, FlowerCompanionThreadListItem[]> = {
    attention: [],
    working: [],
    pinned: [],
    recent: [],
  };

  for (const item of ordered) {
    if (seen.has(item.thread_id)) continue;
    seen.add(item.thread_id);
    const indicator = flowerThreadIndicator(item, false, copy);
    if (indicator.actionRequired) {
      groups.attention.push(item);
    } else if (indicator.visual === 'wave' || queuedTurnCount(item) > 0) {
      groups.working.push(item);
    } else if (item.pinned) {
      groups.pinned.push(item);
    } else {
      groups.recent.push(item);
    }
  }

  return GROUP_ORDER
    .filter((kind) => groups[kind].length > 0)
    .map((kind) => ({ kind, threads: groups[kind] }));
}

function fmtUpdatedTime(ms: number, copy: FlowerThreadListCopy): string {
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
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

export type FlowerThreadSwitcherProps = Readonly<{
  items: readonly FlowerCompanionThreadListItem[];
  activeThreadID?: string;
  query: string;
  copy: FlowerThreadSwitcherCopy;
  onQueryChange: (query: string) => void;
  onNewConversation: () => void;
  onSelect: (threadID: string) => void;
  onEscape: () => void;
  focusOnMount?: boolean;
}>;

export const FlowerThreadSwitcher: Component<FlowerThreadSwitcherProps> = (props) => {
  const uid = createUniqueId();
  const listboxID = `flower-thread-switcher-list-${uid}`;
  let searchRef: HTMLInputElement | undefined;
  let mounted = true;
  const groups = createMemo(() => groupFlowerThreadSwitcherItems(props.items, props.query, props.copy.threadList));
  const threadByID = createMemo(() => new Map(groups().flatMap((group) => group.threads).map((item) => [item.thread_id, item] as const)));
  const optionKeys = createMemo(() => ['new', ...groups().flatMap((group) => group.threads.map((item) => item.thread_id))]);
  const [highlightedKey, setHighlightedKey] = createSignal('new');
  const optionID = (key: string) => `flower-thread-switcher-option-${uid}-${key.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;

  const activate = (key: string) => {
    if (key === 'new') {
      props.onNewConversation();
      return;
    }
    if (threadByID().has(key)) props.onSelect(key);
  };

  const moveHighlight = (delta: number) => {
    const keys = optionKeys();
    if (keys.length === 0) return;
    const current = Math.max(0, keys.indexOf(highlightedKey()));
    setHighlightedKey(keys[(current + delta + keys.length) % keys.length] ?? 'new');
    searchRef?.focus();
  };

  createEffect(() => {
    const keys = optionKeys();
    if (!keys.includes(highlightedKey())) setHighlightedKey(keys[0] ?? 'new');
  });

  onMount(() => {
    if (props.focusOnMount === false) return;
    queueMicrotask(() => {
      if (mounted) searchRef?.focus();
    });
  });
  onCleanup(() => {
    mounted = false;
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onEscape();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === 'Enter' && event.target === searchRef && !event.isComposing) {
      event.preventDefault();
      activate(highlightedKey());
    }
  };

  const rowMeta = (item: FlowerCompanionThreadListItem, groupKind: FlowerThreadSwitcherGroupKind): string => {
    const indicator = flowerThreadIndicator(item, props.activeThreadID === item.thread_id, props.copy.threadList);
    if (indicator.actionRequired || indicator.visual === 'wave') return indicator.title;
    if (queuedTurnCount(item) > 0) return props.copy.queued;
    if (groupKind === 'pinned') return props.copy.threadList.pinnedBadge;
    return fmtUpdatedTime(item.updated_at_ms || item.created_at_ms, props.copy.threadList);
  };

  return (
    <div
      data-flower-thread-switcher
      class="flex max-h-[min(70vh,30rem)] min-h-0 w-full flex-col overflow-hidden rounded-md border border-border/70 bg-popover text-popover-foreground shadow-lg"
      aria-label={props.copy.label}
      onKeyDown={onKeyDown}
    >
      <div class="shrink-0 border-b border-border/60 p-2.5">
        <label class="relative block">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            class="h-8 w-full cursor-text rounded-md border border-input bg-background px-2.5 pl-8 text-xs text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            value={props.query}
            placeholder={props.copy.searchPlaceholder}
            aria-label={props.copy.searchPlaceholder}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxID}
            aria-activedescendant={optionID(highlightedKey())}
            onInput={(event) => {
              props.onQueryChange(event.currentTarget.value);
              setHighlightedKey('new');
            }}
          />
        </label>
      </div>

      <div id={listboxID} role="listbox" aria-label={props.copy.label} class="flower-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        <button
          id={optionID('new')}
          type="button"
          role="option"
          aria-selected="false"
          data-flower-thread-switcher-new
          data-highlighted={highlightedKey() === 'new' ? 'true' : 'false'}
          tabIndex={-1}
          class={cn(
            'flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium outline-none transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/70',
            highlightedKey() === 'new' && 'bg-accent text-accent-foreground',
          )}
          onPointerMove={() => setHighlightedKey('new')}
          onClick={props.onNewConversation}
        >
          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-background text-muted-foreground" aria-hidden="true">
            <Plus class="h-3.5 w-3.5" />
          </span>
          <span class="truncate">{props.copy.newConversation}</span>
        </button>

        <Show when={groups().length > 0} fallback={(
          <div class="px-2 py-5 text-center text-xs text-muted-foreground">{props.copy.empty}</div>
        )}>
          <For each={groups()}>
            {(group) => {
              const labelID = `flower-thread-switcher-group-${uid}-${group.kind}`;
              return (
                <section role="group" aria-labelledby={labelID} class="mt-1.5 first:mt-1">
                  <h3 id={labelID} class="px-2 pb-1 pt-1 text-[10px] font-semibold tracking-normal text-muted-foreground">
                    {props.copy.groups[group.kind]}
                  </h3>
                  <For each={group.threads}>
                    {(item) => {
                      const indicator = createMemo(() => flowerThreadIndicator(item, props.activeThreadID === item.thread_id, props.copy.threadList));
                      const queued = () => queuedTurnCount(item) > 0;
                      const highlighted = () => highlightedKey() === item.thread_id;
                      return (
                        <button
                          id={optionID(item.thread_id)}
                          type="button"
                          role="option"
                          aria-selected={props.activeThreadID === item.thread_id ? 'true' : 'false'}
                          data-flower-thread-switcher-thread={item.thread_id}
                          data-flower-thread-switcher-group={group.kind}
                          data-highlighted={highlighted() ? 'true' : 'false'}
                          tabIndex={-1}
                          class={cn(
                            'group flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none transition-colors',
                            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/70',
                            highlighted() && 'bg-accent text-accent-foreground',
                            props.activeThreadID === item.thread_id && 'font-medium',
                          )}
                          onPointerMove={() => setHighlightedKey(item.thread_id)}
                          onClick={() => props.onSelect(item.thread_id)}
                        >
                          <span
                            class={cn(
                              'flex h-2 w-2 shrink-0 items-center justify-center rounded-full border',
                              indicator().actionRequired && 'border-warning/50 bg-warning/20',
                              indicator().visual === 'wave' && 'border-primary/50 bg-primary/20 motion-safe:animate-pulse',
                              indicator().attention === 'unread' && item.status === 'failed' && 'border-error/60 bg-error/70',
                              indicator().attention === 'unread' && item.status !== 'failed' && 'border-primary/60 bg-primary/70',
                              queued() && indicator().visual === 'none' && 'border-primary/40 bg-primary/30',
                              !queued() && !indicator().actionRequired && indicator().visual === 'none' && indicator().attention === 'none' && 'border-muted-foreground/25 bg-muted-foreground/15',
                            )}
                            aria-hidden="true"
                          />
                          <span class="min-w-0 flex-1 truncate text-xs">{item.title.trim() || props.copy.threadList.untitled}</span>
                          <span class="max-w-[42%] shrink-0 truncate text-[10px] font-normal text-muted-foreground">
                            {rowMeta(item, group.kind)}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </section>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};
