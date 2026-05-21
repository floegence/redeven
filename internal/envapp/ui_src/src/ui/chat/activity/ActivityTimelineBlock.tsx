import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { ActivityStatusIcon, formatActivityDuration, type ActivityStatus } from '../status/ActivityLine';
import type {
  ActivityDetailRef,
  ActivityGroup,
  ActivityItem,
  ActivityTimelineBlock as ActivityTimelineBlockType,
} from '../types';
import { ActivityChipList, ActivityItemRow } from './ActivityItemRow';
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
    case 'waiting_approval':
      return 'pending';
    default:
      return 'info';
  }
}

function isBlockingItem(item: ActivityItem): boolean {
  return (item.requiresApproval === true && item.approvalState === 'required')
    || item.status === 'waiting'
    || item.status === 'waiting_approval'
    || item.severity === 'blocking';
}

function itemKey(item: ActivityItem, index: number): string {
  return String(item.itemId || item.toolId || index).trim() || String(index);
}

function groupKey(group: ActivityGroup, index: number): string {
  return String(group.groupId || index).trim() || String(index);
}

function targetLabel(item: ActivityItem): string {
  const first = Array.isArray(item.targetRefs) ? item.targetRefs[0] : undefined;
  return String(first?.label ?? item.description ?? '').trim();
}

function primaryDetailRef(item: ActivityItem): ActivityDetailRef | undefined {
  return Array.isArray(item.detailRefs) ? item.detailRefs[0] : undefined;
}

function panelIdFor(blockIndex: number, itemId: string): string {
  return `activity-detail-${blockIndex}-${itemId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export const ActivityTimelineBlock: Component<ActivityTimelineBlockProps> = (props) => {
  const [openByGroup, setOpenByGroup] = createSignal<Record<string, boolean>>({});
  const [openByItem, setOpenByItem] = createSignal<Record<string, boolean>>({});
  const [detailStates, setDetailStates] = createSignal<Record<string, ActivityDetailLoadState>>({});

  const hasGroups = createMemo(() => Array.isArray(props.block.groups) && props.block.groups.length > 0);
  const summaryStatus = createMemo(() => toActivityStatus(props.block.summary?.status));
  const durationLabel = createMemo(() => formatActivityDuration(props.block.summary?.durationMs));

  const isGroupOpen = (group: ActivityGroup, index: number) => {
    const key = groupKey(group, index);
    const local = openByGroup()[key];
    return typeof local === 'boolean' ? local : Boolean(group.defaultOpen);
  };
  const toggleGroup = (group: ActivityGroup, index: number) => {
    const key = groupKey(group, index);
    setOpenByGroup((prev) => ({ ...prev, [key]: !isGroupOpen(group, index) }));
  };

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

  const toggleItem = (item: ActivityItem, ref: ActivityDetailRef | undefined, itemId: string) => {
    if (!ref) return;
    const nextOpen = !openByItem()[itemId];
    setOpenByItem((prev) => ({ ...prev, [itemId]: nextOpen }));
    if (nextOpen) ensureDetailLoaded(item, ref);
  };

  const retryItem = (item: ActivityItem, ref: ActivityDetailRef | undefined) => {
    if (!ref) return;
    void loadDetail(item, ref);
  };

  return (
    <Show when={hasGroups()}>
      <div class={cn('chat-activity-timeline', props.class)} data-status={summaryStatus()}>
        <div class="chat-activity-timeline-summary">
          <ActivityStatusIcon status={summaryStatus()} class="chat-activity-timeline-summary-icon" />
          <span class="chat-activity-timeline-summary-text">{props.block.summary?.label || 'Activity'}</span>
          <Show when={durationLabel()}>
            {(value) => <span class="chat-activity-timeline-duration">{value()}</span>}
          </Show>
        </div>

        <div class="chat-activity-timeline-groups">
          <For each={props.block.groups}>
            {(group, groupIndex) => {
              const expanded = createMemo(() => isGroupOpen(group, groupIndex()));
              return (
                <div class={cn('chat-activity-group', group.severity && `chat-activity-group-${group.severity}`)}>
                  <button
                    type="button"
                    class="chat-activity-group-head"
                    aria-expanded={expanded()}
                    onClick={() => toggleGroup(group, groupIndex())}
                  >
                    <span class={cn('chat-activity-group-chevron', expanded() && 'chat-activity-group-chevron-open')} aria-hidden="true">
                      <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
                    </span>
                    <ActivityStatusIcon status={toActivityStatus(group.status)} />
                    <span class="chat-activity-group-copy">
                      <span class="chat-activity-group-title">{group.title}</span>
                      <Show when={group.subtitle}>
                        {(subtitle) => <span class="chat-activity-group-subtitle">{subtitle()}</span>}
                      </Show>
                    </span>
                    <ActivityChipList chips={group.chips} />
                  </button>

                  <Show when={expanded()}>
                    <div class="chat-activity-items">
                      <For each={group.items}>
                        {(item, itemIndex) => {
                          const id = createMemo(() => itemKey(item, itemIndex()));
                          const ref = createMemo(() => primaryDetailRef(item));
                          const panelId = createMemo(() => panelIdFor(props.blockIndex, id()));
                          return (
                            <ActivityItemRow
                              item={item}
                              itemId={id()}
                              panelId={panelId()}
                              status={toActivityStatus(item.status)}
                              targetLabel={targetLabel(item)}
                              blocking={isBlockingItem(item)}
                              messageId={props.messageId}
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
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
};
