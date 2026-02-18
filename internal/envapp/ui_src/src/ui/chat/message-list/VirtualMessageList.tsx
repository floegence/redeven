// Virtualized message list with a single, explicit follow-state machine.

import { createEffect, createMemo, createSignal, onCleanup, Show, For } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import { useVirtualList } from '../hooks/useVirtualList';
import { WorkingIndicator } from '../status/WorkingIndicator';
import { MessageItem } from '../message/MessageItem';
import type { Message } from '../types';

export interface VirtualMessageListProps {
  class?: string;
}

/** Chevron-down icon for the scroll-to-bottom button. */
const ChevronDownIcon: Component = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

type FollowMode = 'following' | 'paused';

const FOLLOW_BOTTOM_THRESHOLD_PX = 24;
const EXTERNAL_SCROLL_SYNC_PASSES = 2;

export const VirtualMessageList: Component<VirtualMessageListProps> = (props) => {
  const ctx = useChatContext();

  const messages = createMemo(() => ctx.messages());
  const isWorking = ctx.isWorking;
  const isLoadingHistory = ctx.isLoadingHistory;

  const [followMode, setFollowMode] = createSignal<FollowMode>('following');
  const [distanceToBottomPx, setDistanceToBottomPx] = createSignal(0);
  const [pendingMessageCount, setPendingMessageCount] = createSignal(0);
  const [scrollContainerVersion, setScrollContainerVersion] = createSignal(0);

  const messageById = createMemo(() => {
    const byId = new Map<string, Message>();
    messages().forEach((msg) => {
      byId.set(msg.id, msg);
    });
    return byId;
  });

  const messageIndexById = createMemo(() => {
    const indexById = new Map<string, number>();
    messages().forEach((msg, index) => {
      indexById.set(msg.id, index);
    });
    return indexById;
  });

  const virtualList = useVirtualList({
    count: () => messages().length,
    getItemKey: (index: number) => messages()[index]?.id ?? String(index),
    getItemHeight: (index: number) => {
      const msg = messages()[index];
      if (!msg) return ctx.virtualListConfig().defaultItemHeight;
      return ctx.getMessageHeight(msg.id);
    },
    config: ctx.virtualListConfig(),
  });

  let prevMessageCount = messages().length;
  let prevScrollTop = 0;
  let scrollContainerEl: HTMLElement | null = null;
  let didInitialBottomSync = false;
  let lastHandledScrollRequestSeq = 0;
  let followToBottomRaf: number | null = null;

  const getDistanceToBottom = (el: HTMLElement) =>
    Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);

  const isNearBottom = (el: HTMLElement) =>
    getDistanceToBottom(el) <= FOLLOW_BOTTOM_THRESHOLD_PX;

  const updateDistanceToBottom = (el?: HTMLElement | null) => {
    const target = el ?? scrollContainerEl;
    if (!target) return;
    setDistanceToBottomPx(getDistanceToBottom(target));
  };

  const applyFollowingMode = () => {
    if (followMode() !== 'following') {
      setFollowMode('following');
    }
    if (pendingMessageCount() !== 0) {
      setPendingMessageCount(0);
    }
  };

  const applyPausedMode = () => {
    if (followMode() !== 'paused') {
      setFollowMode('paused');
    }
  };

  const scrollToBottomNow = (behavior: 'auto' | 'smooth' = 'auto'): boolean => {
    const el = scrollContainerEl;
    if (!el) return false;

    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      virtualList.scrollToBottom();
    }

    prevScrollTop = el.scrollTop;
    updateDistanceToBottom(el);
    return true;
  };

  const scheduleFollowToBottom = (behavior: 'auto' | 'smooth' = 'auto', passes = 1) => {
    if (followToBottomRaf !== null) return;
    followToBottomRaf = requestAnimationFrame(() => {
      followToBottomRaf = null;
      if (followMode() !== 'following') return;
      if (!scrollToBottomNow(behavior)) return;
      if (passes > 1) {
        scheduleFollowToBottom(behavior, passes - 1);
      }
    });
  };

  // Auto-follow only when in FOLLOWING mode; otherwise collect unread count.
  createEffect(() => {
    const currentCount = messages().length;

    if (currentCount <= 0) {
      prevMessageCount = 0;
      didInitialBottomSync = false;
      setPendingMessageCount(0);
      setDistanceToBottomPx(0);
      setFollowMode('following');
      return;
    }

    if (currentCount > prevMessageCount) {
      const addedCount = currentCount - prevMessageCount;
      if (followMode() === 'following') {
        scheduleFollowToBottom('auto');
      } else {
        setPendingMessageCount((count) => count + addedCount);
      }
    }

    prevMessageCount = currentCount;

    requestAnimationFrame(() => {
      updateDistanceToBottom();
    });
  });

  // Initial mount sync for already-loaded thread messages.
  createEffect(() => {
    scrollContainerVersion();
    const currentCount = messages().length;
    if (currentCount <= 0 || !scrollContainerEl) {
      didInitialBottomSync = false;
      return;
    }
    if (didInitialBottomSync) return;

    didInitialBottomSync = true;
    applyFollowingMode();
    scheduleFollowToBottom('auto', EXTERNAL_SCROLL_SYNC_PASSES);
  });

  // External bottom intents (thread switch/send) are funneled into the same state machine.
  createEffect(() => {
    scrollContainerVersion();
    const request = ctx.scrollToBottomRequest();
    if (!request || !scrollContainerEl) return;
    if (request.seq <= lastHandledScrollRequestSeq) return;

    lastHandledScrollRequestSeq = request.seq;
    applyFollowingMode();
    const syncPasses = request.source === 'system' ? EXTERNAL_SCROLL_SYNC_PASSES : 1;
    scheduleFollowToBottom(request.behavior, syncPasses);
  });

  const showScrollToBottom = createMemo(
    () => followMode() === 'paused' || distanceToBottomPx() > FOLLOW_BOTTOM_THRESHOLD_PX,
  );

  // Load more history when scrolled near the top.
  function handleScroll(): void {
    const el = scrollContainerEl;

    virtualList.onScroll();

    if (el) {
      const nextScrollTop = el.scrollTop;
      const nearBottom = isNearBottom(el);

      updateDistanceToBottom(el);

      if (nearBottom) {
        applyFollowingMode();
      } else if (Math.abs(nextScrollTop - prevScrollTop) > 0.5) {
        applyPausedMode();
      }

      prevScrollTop = nextScrollTop;
    }

    const range = virtualList.visibleRange();
    if (
      range.start <= ctx.virtualListConfig().loadThreshold &&
      !isLoadingHistory() &&
      ctx.hasMoreHistory()
    ) {
      ctx.loadMoreHistory();
    }
  }

  // ResizeObserver tracks per-item height changes from markdown/tool reflow.
  const resizeObserverMap = new Map<Element, string>();
  const resizeObserver = new ResizeObserver((entries) => {
    let anyHeightChanged = false;

    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const messageId = resizeObserverMap.get(el);
      if (!messageId) continue;

      const index = messageIndexById().get(messageId);
      if (index === undefined) continue;

      const rawHeight =
        entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const height = Math.round(rawHeight);
      if (height <= 0) continue;

      const cachedHeight = ctx.getMessageHeight(messageId);
      if (Math.abs(cachedHeight - height) < 1) {
        continue;
      }

      ctx.setMessageHeight(messageId, height);
      virtualList.setItemHeight(index, height);
      anyHeightChanged = true;
    }

    if (!anyHeightChanged) return;

    updateDistanceToBottom();
    if (followMode() === 'following') {
      scheduleFollowToBottom('auto');
    }
  });

  onCleanup(() => {
    scrollContainerEl = null;
    resizeObserver.disconnect();
    if (followToBottomRaf !== null) {
      cancelAnimationFrame(followToBottomRaf);
      followToBottomRaf = null;
    }
  });

  // Ref callback for message items — observe resizes.
  function observeItem(el: HTMLElement, messageId: string): void {
    resizeObserverMap.set(el, messageId);
    resizeObserver.observe(el);
  }

  const visibleMessageIds = createMemo<string[]>(() => {
    const currentMessages = messages();
    const ids: string[] = [];
    virtualList.virtualItems().forEach((item) => {
      const msg = currentMessages[item.index];
      if (!msg) return;
      ids.push(msg.id);
    });
    return ids;
  });

  return (
    <div class={cn('chat-message-list-container', props.class)}>
      <Show when={isLoadingHistory()}>
        <div class="chat-loading-more">Loading history...</div>
      </Show>

      <div
        class="chat-message-list-scroll"
        ref={((el: HTMLElement) => {
          scrollContainerEl = el;
          virtualList.containerRef(el);
          virtualList.scrollRef(el);
          prevScrollTop = el.scrollTop;
          updateDistanceToBottom(el);
          setScrollContainerVersion((version) => version + 1);
        }) as any}
        onScroll={handleScroll}
      >
        <div class="chat-message-list-inner">
          <div
            class="chat-vlist-spacer"
            style={{ height: `${virtualList.paddingTop()}px` }}
          />

          <For each={visibleMessageIds()}>
            {(messageId) => (
              <Show when={messageById().get(messageId)}>
                {(msg) => (
                  <div
                    class="chat-message-list-item"
                    ref={(el: HTMLElement) => observeItem(el, messageId)}
                  >
                    <MessageItem message={msg()} />
                  </div>
                )}
              </Show>
            )}
          </For>

          <div
            class="chat-vlist-spacer"
            style={{ height: `${virtualList.paddingBottom()}px` }}
          />
        </div>

        <Show when={isWorking()}>
          <div class="chat-working-indicator-wrapper">
            <WorkingIndicator />
          </div>
        </Show>
      </div>

      <Show when={showScrollToBottom()}>
        <button
          class="chat-scroll-to-bottom-btn"
          onClick={() => {
            applyFollowingMode();
            ctx.requestScrollToBottom({ source: 'user', behavior: 'auto' });
          }}
          aria-label="Scroll to bottom"
          title={pendingMessageCount() > 0 ? `${pendingMessageCount()} new messages` : 'Scroll to bottom'}
        >
          <ChevronDownIcon />
          <Show when={pendingMessageCount() > 0}>
            <span class="chat-scroll-to-bottom-badge">{pendingMessageCount()}</span>
          </Show>
        </button>
      </Show>
    </div>
  );
};
