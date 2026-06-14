import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { ActivityStatusIcon, formatActivityDuration, type ActivityStatus } from '../status/ActivityLine';
import type {
  ActivityDetailRef,
  ActivityItem,
  ActivityTimelineBlock as ActivityTimelineBlockType,
} from '../types';
import { ActivityItemRow } from './ActivityItemRow';
import { activityDetailCacheKey, fetchActivityDetail } from './activityDetailApi';
import type { ActivityDetailLoadState } from './activityDetailTypes';

export interface ActivityTimelineBlockProps {
  block: ActivityTimelineBlockType;
  messageId: string;
  blockIndex: number;
  class?: string;
}

function toActivityStatus(status: string | undefined): ActivityStatus {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'pending':
    case 'waiting':
      return 'pending';
    default:
      return 'info';
  }
}

function isBlockingItem(item: ActivityItem): boolean {
  return (item.requires_approval === true && item.approval_state === 'requested')
    || item.status === 'waiting'
    || item.severity === 'blocking';
}

function itemKey(item: ActivityItem, index: number): string {
  return String(item.item_id || item.tool_id || index).trim() || String(index);
}

function targetLabel(item: ActivityItem): string {
  const first = Array.isArray(item.target_refs) ? item.target_refs[0] : undefined;
  return String(first?.label ?? item.description ?? '').trim();
}

function primaryDetailRef(item: ActivityItem): ActivityDetailRef | undefined {
  const explicit = Array.isArray(item.detail_refs) ? item.detail_refs[0] : undefined;
  if (explicit) return explicit;
  const itemID = itemKey(item, 0);
  return {
    ref_id: `activity:${itemID}:payload`,
    kind: 'tool_detail',
    tool_id: item.tool_id,
    fetch_mode: 'inline',
    payload: item.payload ?? {
      item_id: item.item_id,
      tool_id: item.tool_id,
      tool_name: item.tool_name,
      kind: item.kind,
      status: item.status,
    },
    title: String(item.label ?? item.tool_name ?? item.kind ?? 'Activity').trim() || 'Activity',
  };
}

function panelIdFor(blockIndex: number, item_id: string): string {
  return `activity-detail-${blockIndex}-${item_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function itemLabel(item: ActivityItem): string {
  const explicit = String(item.label ?? '').trim();
  if (explicit) return explicit;
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : {};
  const payloadText = (...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
    return '';
  };
  if (String(item.renderer ?? '').trim() === 'terminal') {
    const command = payloadText('command');
    if (command) return command;
  }
  if (String(item.renderer ?? '').trim() === 'web_search') {
    const query = payloadText('query');
    if (query) return query;
  }
  const toolName = String(item.tool_name ?? '').trim();
  return toolName || String(item.kind ?? '').trim() || 'Activity';
}

function summaryLabel(block: ActivityTimelineBlockType): string {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 1) return itemLabel(items[0]);
  const total = block.summary?.total_items || items.length;
  return total === 1 ? '1 activity' : `${total} activities`;
}

function defaultTimelineOpen(block: ActivityTimelineBlockType): boolean {
  return block.summary?.needs_attention === true || block.summary?.status !== 'success';
}

export const ActivityTimelineBlock: Component<ActivityTimelineBlockProps> = (props) => {
  const [open, setOpen] = createSignal<boolean | null>(null);
  const [openByItem, setOpenByItem] = createSignal<Record<string, boolean>>({});
  const [detailStates, setDetailStates] = createSignal<Record<string, ActivityDetailLoadState>>({});

  const items = createMemo(() => Array.isArray(props.block.items) ? props.block.items : []);
  const hasItems = createMemo(() => items().length > 0);
  const summaryStatus = createMemo(() => toActivityStatus(props.block.summary?.status));
  const durationLabel = createMemo(() => formatActivityDuration(props.block.summary?.duration_ms));
  const expanded = createMemo(() => open() ?? defaultTimelineOpen(props.block));

  const detailStateFor = (item: ActivityItem, ref: ActivityDetailRef | undefined): ActivityDetailLoadState => {
    if (!ref) return { status: 'idle' };
    return detailStates()[activityDetailCacheKey(item, ref)] ?? { status: 'idle' };
  };

  const loadDetail = async (item: ActivityItem, ref: ActivityDetailRef) => {
    const key = activityDetailCacheKey(item, ref);
    setDetailStates((prev) => ({ ...prev, [key]: { status: 'loading' } }));
    try {
      const presentation = await fetchActivityDetail(item, ref);
      setDetailStates((prev) => ({ ...prev, [key]: { status: 'ready', presentation } }));
    } catch (error) {
      setDetailStates((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const ensureDetailLoaded = (item: ActivityItem, ref: ActivityDetailRef) => {
    const state = detailStateFor(item, ref);
    if (state.status === 'idle' || state.status === 'error') {
      void loadDetail(item, ref);
    }
  };

  const toggleItem = (item: ActivityItem, ref: ActivityDetailRef | undefined, item_id: string) => {
    if (!ref) return;
    const nextOpen = !openByItem()[item_id];
    setOpenByItem((prev) => ({ ...prev, [item_id]: nextOpen }));
    if (nextOpen) ensureDetailLoaded(item, ref);
  };

  const retryItem = (item: ActivityItem, ref: ActivityDetailRef | undefined) => {
    if (!ref) return;
    void loadDetail(item, ref);
  };

  return (
    <Show when={hasItems()}>
      <div class={cn('chat-activity-timeline', props.class)} data-status={summaryStatus()}>
        <button
          type="button"
          class="chat-activity-timeline-summary"
          aria-expanded={expanded()}
          onClick={() => setOpen(!expanded())}
        >
          <span class={cn('chat-activity-timeline-chevron', expanded() && 'chat-activity-timeline-chevron-open')} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
          </span>
          <ActivityStatusIcon status={summaryStatus()} class="chat-activity-timeline-summary-icon" />
          <span class="chat-activity-timeline-summary-text">{summaryLabel(props.block)}</span>
          <Show when={durationLabel()}>
            {(value) => <span class="chat-activity-timeline-duration">{value()}</span>}
          </Show>
        </button>

        <Show when={expanded()}>
          <div class="chat-activity-items">
            <For each={items()}>
              {(item, itemIndex) => {
                const id = createMemo(() => itemKey(item, itemIndex()));
                const ref = createMemo(() => primaryDetailRef(item));
                const panelId = createMemo(() => panelIdFor(props.blockIndex, id()));
                return (
                  <ActivityItemRow
                    item={item}
                    item_id={id()}
                    label={itemLabel(item)}
                    panelId={panelId()}
                    status={toActivityStatus(item.status)}
                    targetLabel={targetLabel(item)}
                    blocking={isBlockingItem(item)}
                    messageId={props.messageId}
                    hasDetail={Boolean(ref())}
                    expanded={Boolean(openByItem()[id()])}
                    detailState={detailStateFor(item, ref())}
                    onToggle={() => toggleItem(item, ref(), id())}
                    onRetry={() => retryItem(item, ref())}
                  />
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};
