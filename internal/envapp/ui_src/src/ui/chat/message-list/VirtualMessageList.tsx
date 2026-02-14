// Virtualized message list component with auto-scroll and history loading.

import { createSignal, createEffect, createMemo, onCleanup, Show, For } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import { useVirtualList } from '../hooks/useVirtualList';
import { WorkingIndicator } from '../status/WorkingIndicator';
import { MessageItem } from '../message/MessageItem';

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
  const resizeObserverMap = new Map<Element, number>();
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const index = resizeObserverMap.get(el);
      if (index === undefined) continue;

      const height =
        entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;

      if (height > 0) {
        const msg = messages()[index];
        if (msg) {
          ctx.setMessageHeight(msg.id, height);
          virtualList.setItemHeight(index, height);
        }
      }
    }
  });

  onCleanup(() => {
    resizeObserver.disconnect();
  });

  // Ref callback for message items — observe resizes
  function observeItem(el: HTMLElement, index: number): void {
    resizeObserverMap.set(el, index);
    resizeObserver.observe(el);
  }

  // Compute visible indices from virtual items
  const visibleIndices = createMemo(() => {
    return virtualList.virtualItems().map((item) => item.index);
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

          <For each={visibleIndices()}>
            {(idx) => (
              <Show when={messages()[idx]}>
                {(msg) => (
                  <div
                    class="chat-message-list-item"
                    ref={(el: HTMLElement) => observeItem(el, idx)}
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
