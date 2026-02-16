// Virtualized message list component with auto-scroll and history loading.

import { createEffect, createMemo, onCleanup, Show, For } from 'solid-js';
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

export const VirtualMessageList: Component<VirtualMessageListProps> = (props) => {
  const ctx = useChatContext();

  const messages = createMemo(() => ctx.messages());
  const isWorking = ctx.isWorking;
  const isLoadingHistory = ctx.isLoadingHistory;
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

  // Track previous message count for auto-scroll
  let prevMessageCount = messages().length;

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  createEffect(() => {
    const currentCount = messages().length;
    if (currentCount > prevMessageCount && virtualList.isAtBottom()) {
      // Use rAF to wait for DOM update before scrolling
      requestAnimationFrame(() => {
        virtualList.scrollToBottom();
      });
    }
    prevMessageCount = currentCount;
  });

  // Show scroll-to-bottom button when not at bottom
  const showScrollToBottom = createMemo(() => !virtualList.isAtBottom());

  // Load more history when scrolled near the top
  function handleScroll(): void {
    virtualList.onScroll();

    // Check if near top for loading more history
    const range = virtualList.visibleRange();
    if (
      range.start <= ctx.virtualListConfig().loadThreshold &&
      !isLoadingHistory() &&
      ctx.hasMoreHistory()
    ) {
      ctx.loadMoreHistory();
    }
  }

  // ResizeObserver for tracking individual message heights
  let followToBottomRaf: number | null = null;
  const scheduleFollowToBottom = () => {
    if (followToBottomRaf !== null) return;
    followToBottomRaf = requestAnimationFrame(() => {
      followToBottomRaf = null;
      if (virtualList.isAtBottom()) {
        virtualList.scrollToBottom();
      }
    });
  };

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

      if (height > 0) {
        const cachedHeight = ctx.getMessageHeight(messageId);
        if (Math.abs(cachedHeight - height) < 1) {
          continue;
        }
        ctx.setMessageHeight(messageId, height);
        virtualList.setItemHeight(index, height);
        anyHeightChanged = true;
      }
    }

    // Keep the view anchored to the bottom while streaming (worker-based markdown rendering
    // may update DOM height asynchronously after the last stream event).
    if (anyHeightChanged && virtualList.isAtBottom()) {
      scheduleFollowToBottom();
    }
  });

  onCleanup(() => {
    resizeObserver.disconnect();
    if (followToBottomRaf !== null) {
      cancelAnimationFrame(followToBottomRaf);
      followToBottomRaf = null;
    }
  });

  // Ref callback for message items — observe resizes
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
          virtualList.containerRef(el);
          virtualList.scrollRef(el);
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
          onClick={() => virtualList.scrollToBottom()}
          aria-label="Scroll to bottom"
        >
          <ChevronDownIcon />
        </button>
      </Show>
    </div>
  );
};
