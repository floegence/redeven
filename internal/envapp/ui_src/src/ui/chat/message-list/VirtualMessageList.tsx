// Virtualized message list with a single, explicit follow-state machine.

import { createEffect, createMemo, createSignal, onCleanup, Show, For } from 'solid-js';
import type { Accessor, Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext, type ScrollToBottomBehavior } from '../ChatProvider';
import { useVirtualList } from '../hooks/useVirtualList';
import { getMessageRenderKey } from '../messageIdentity';
import { WorkingIndicator } from '../status/WorkingIndicator';
import { MessageItem } from '../message/MessageItem';
import type { Message } from '../types';
import { captureViewportAnchor, resolveViewportAnchorScrollTop, type ViewportAnchor } from './scrollAnchor';
import type { FollowBottomRequest } from '../scroll/createFollowBottomController';
import { useI18n } from '../../i18n';

export interface VirtualMessageListProps {
  class?: string;
  tailVisible?: boolean;
  tailComponent?: Component;
  conversationKey?: string;
  revealRequestSeq?: number;
  revealPolicy?: 'visible' | 'hidden_until_bottom_committed';
  onBottomCommitted?: (conversationKey: string, revealRequestSeq: number) => void;
}

interface VirtualMessageRowProps {
  renderKey: string;
  observeItem: (el: HTMLElement, renderKey: string) => void;
  unobserveItem: (el: HTMLElement) => void;
  messageByRenderKey: Accessor<Map<string, Message>>;
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

const FOLLOW_BOTTOM_THRESHOLD_PX = 24;
const EXTERNAL_SCROLL_SYNC_PASSES = 2;
const ANIMATED_FOLLOW_TIME_CONSTANT_MS = 140;
const ANIMATED_FOLLOW_MIN_STEP_PX = 1;

type FollowMode = 'following' | 'paused';
type FollowMotionMode = 'instant' | 'animated';

const VirtualMessageRow: Component<VirtualMessageRowProps> = (props) => {
  let rowEl: HTMLDivElement | undefined;

  createEffect(() => {
    const el = rowEl;
    if (!el) return;

    props.observeItem(el, props.renderKey);
    onCleanup(() => {
      props.unobserveItem(el);
    });
  });

  return (
    <div
      class="chat-message-list-item"
      ref={(el: HTMLDivElement) => {
        rowEl = el;
      }}
    >
      <MessageItem message={props.messageByRenderKey().get(props.renderKey)!} />
    </div>
  );
};

export const VirtualMessageList: Component<VirtualMessageListProps> = (props) => {
  const ctx = useChatContext();
  const i18n = useI18n();

  const messages = createMemo(() => ctx.messages());
  const isWorking = ctx.isWorking;
  const isLoadingHistory = ctx.isLoadingHistory;
  const showListWorkingIndicator = createMemo(() => ctx.config().showListWorkingIndicator !== false);

  const [followMode, setFollowMode] = createSignal<FollowMode>('following');
  const [distanceToBottomPx, setDistanceToBottomPx] = createSignal(0);
  const [pendingMessageCount, setPendingMessageCount] = createSignal(0);
  const [scrollContainerVersion, setScrollContainerVersion] = createSignal(0);
  const [committedConversationKey, setCommittedConversationKey] = createSignal('');

  const messageByRenderKey = createMemo(() => {
    const byKey = new Map<string, Message>();
    messages().forEach((msg) => {
      byKey.set(getMessageRenderKey(msg), msg);
    });
    return byKey;
  });

  const messageIndexByRenderKey = createMemo(() => {
    const indexByKey = new Map<string, number>();
    messages().forEach((msg, index) => {
      indexByKey.set(getMessageRenderKey(msg), index);
    });
    return indexByKey;
  });

  const virtualList = useVirtualList({
    count: () => messages().length,
    getItemKey: (index: number) => {
      const message = messages()[index];
      return message ? getMessageRenderKey(message) : String(index);
    },
    getItemHeight: (index: number) => {
      const msg = messages()[index];
      if (!msg) return ctx.virtualListConfig().defaultItemHeight;
      return ctx.getMessageHeight(getMessageRenderKey(msg));
    },
    config: ctx.virtualListConfig(),
  });

  let prevMessageCount = messages().length;
  let prevScrollTop = 0;
  let scrollContainerEl: HTMLElement | null = null;
  let tailContainerEl: HTMLDivElement | null = null;
  let didInitialBottomSync = false;
  let lastHandledScrollRequestSeq = 0;
  let followToBottomRaf: number | null = null;
  let animatedFollowRaf: number | null = null;
  let animatedFollowLastTimestamp = 0;
  let animatedFollowTargetTop = 0;
  let viewportAnchor: ViewportAnchor | null = null;
  let tailObservedHeight = 0;
  let scrollViewportHeight = 0;
  let followMotionMode: FollowMotionMode = 'instant';
  let revealCommitQueued = false;
  let prefersReducedMotion = false;
  let reducedMotionMedia: MediaQueryList | null = null;

  const getDistanceToBottom = (el: HTMLElement) =>
    Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);

  const isNearBottom = (el: HTMLElement) =>
    getDistanceToBottom(el) <= FOLLOW_BOTTOM_THRESHOLD_PX;

  const updateDistanceToBottom = (el?: HTMLElement | null) => {
    const target = el ?? scrollContainerEl;
    if (!target) return;
    setDistanceToBottomPx(getDistanceToBottom(target));
  };

  const syncProgrammaticScroll = (target: HTMLElement) => {
    prevScrollTop = target.scrollTop;
    virtualList.onScroll();
    updateDistanceToBottom(target);
  };

  const getBottomScrollTop = (target: HTMLElement): number =>
    Math.max(0, target.scrollHeight - target.clientHeight);

  const cancelScheduledInstantFollow = (): void => {
    if (followToBottomRaf !== null) {
      cancelAnimationFrame(followToBottomRaf);
      followToBottomRaf = null;
    }
  };

  const cancelAnimatedFollow = (): void => {
    if (animatedFollowRaf !== null) {
      cancelAnimationFrame(animatedFollowRaf);
      animatedFollowRaf = null;
    }
    animatedFollowLastTimestamp = 0;
  };

  const setFollowMotionMode = (nextMode: FollowMotionMode): void => {
    if (followMotionMode === nextMode) return;
    followMotionMode = nextMode;
    if (nextMode === 'animated') {
      cancelScheduledInstantFollow();
    } else {
      cancelAnimatedFollow();
    }
  };

  const resolveFollowMotionMode = (behavior: ScrollToBottomBehavior): FollowMotionMode => (
    behavior === 'smooth' && !prefersReducedMotion ? 'animated' : 'instant'
  );

  const resolveRequestMotionMode = (request?: FollowBottomRequest | null): FollowMotionMode => {
    if (request?.reason === 'thread_switch' && request.source === 'system') {
      return 'instant';
    }
    return resolveFollowMotionMode(request?.behavior ?? 'auto');
  };

  const queueAnimatedFollow = (): void => {
    if (animatedFollowRaf !== null) return;
    animatedFollowRaf = requestAnimationFrame((timestamp) => {
      animatedFollowRaf = null;
      const target = scrollContainerEl;
      if (!target || followMode() !== 'following' || followMotionMode !== 'animated') {
        animatedFollowLastTimestamp = 0;
        return;
      }

      animatedFollowTargetTop = getBottomScrollTop(target);
      const diff = animatedFollowTargetTop - target.scrollTop;
      if (Math.abs(diff) <= 0.5) {
        if (Math.abs(diff) > 0) {
          target.scrollTop = animatedFollowTargetTop;
          syncProgrammaticScroll(target);
        } else {
          updateDistanceToBottom(target);
        }
        animatedFollowLastTimestamp = 0;
        return;
      }

      const deltaMs = animatedFollowLastTimestamp > 0
        ? Math.min(64, Math.max(1, timestamp - animatedFollowLastTimestamp))
        : 16;
      animatedFollowLastTimestamp = timestamp;
      const progress = 1 - Math.exp(-deltaMs / ANIMATED_FOLLOW_TIME_CONSTANT_MS);
      const rawStep = diff * progress;
      const minStep = Math.sign(diff) * ANIMATED_FOLLOW_MIN_STEP_PX;
      const nextScrollTop = target.scrollTop + (
        Math.abs(rawStep) >= ANIMATED_FOLLOW_MIN_STEP_PX ? rawStep : minStep
      );

      target.scrollTop = diff > 0
        ? Math.min(animatedFollowTargetTop, nextScrollTop)
        : Math.max(animatedFollowTargetTop, nextScrollTop);
      syncProgrammaticScroll(target);
      queueAnimatedFollow();
    });
  };

  const requestAnimatedFollowToBottom = (target?: HTMLElement | null): boolean => {
    const el = target ?? scrollContainerEl;
    if (!el) return false;
    animatedFollowTargetTop = getBottomScrollTop(el);
    queueAnimatedFollow();
    return true;
  };

  const applyFollowScrollDelta = (target: HTMLElement, delta: number): void => {
    if (Math.abs(delta) < 1) {
      updateDistanceToBottom(target);
      return;
    }
    if (followMotionMode === 'animated') {
      requestAnimatedFollowToBottom(target);
      return;
    }
    target.scrollTop = Math.max(0, target.scrollTop + delta);
    syncProgrammaticScroll(target);
  };

  const applyFollowingMode = (nextMotionMode?: FollowMotionMode) => {
    if (followMode() !== 'following') {
      setFollowMode('following');
    }
    if (nextMotionMode) {
      setFollowMotionMode(nextMotionMode);
    }
    viewportAnchor = null;
    if (pendingMessageCount() !== 0) {
      setPendingMessageCount(0);
    }
  };

  const applyPausedMode = () => {
    if (followMode() !== 'paused') {
      setFollowMode('paused');
    }
    cancelScheduledInstantFollow();
    setFollowMotionMode('instant');
  };

  const capturePausedViewportAnchor = (el: HTMLElement): void => {
    viewportAnchor = captureViewportAnchor({
      messageIds: messages().map((message) => getMessageRenderKey(message)),
      visibleRangeStart: virtualList.visibleRange().start,
      scrollTop: el.scrollTop,
      getItemOffset: virtualList.getItemOffset,
      getItemHeight: (index) => {
        const message = messages()[index];
        if (!message) {
          return ctx.virtualListConfig().defaultItemHeight;
        }
        return ctx.getMessageHeight(getMessageRenderKey(message));
      },
    });
  };

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = reducedMotionMedia.matches;
    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      if (!event.matches || followMotionMode !== 'animated') {
        return;
      }
      setFollowMotionMode('instant');
      if (followMode() === 'following') {
        scheduleFollowToBottom('auto');
      }
    };

    if (typeof reducedMotionMedia.addEventListener === 'function') {
      reducedMotionMedia.addEventListener('change', handleReducedMotionChange);
      onCleanup(() => {
        reducedMotionMedia?.removeEventListener('change', handleReducedMotionChange);
      });
    } else if (typeof reducedMotionMedia.addListener === 'function') {
      reducedMotionMedia.addListener(handleReducedMotionChange);
      onCleanup(() => {
        reducedMotionMedia?.removeListener(handleReducedMotionChange);
      });
    }
  }

  const scrollToBottomNow = (behavior: ScrollToBottomBehavior = 'auto'): boolean => {
    const el = scrollContainerEl;
    if (!el) return false;

    if (resolveFollowMotionMode(behavior) === 'animated') {
      return requestAnimatedFollowToBottom(el);
    }

    if (followMotionMode !== 'instant') {
      setFollowMotionMode('instant');
    }
    if (animatedFollowTargetTop !== 0) {
      animatedFollowTargetTop = 0;
    }

    if (behavior === 'auto') {
      virtualList.scrollToBottom();
    } else {
      el.scrollTop = getBottomScrollTop(el);
    }

    syncProgrammaticScroll(el);
    return true;
  };

  const commitBottomNow = (): boolean => {
    const el = scrollContainerEl;
    if (!el) return false;
    cancelScheduledInstantFollow();
    setFollowMotionMode('instant');
    virtualList.scrollToBottom();
    el.scrollTop = getBottomScrollTop(el);
    syncProgrammaticScroll(el);
    return true;
  };

  const conversationKey = createMemo(() => String(props.conversationKey ?? 'default').trim() || 'default');
  const revealRequestSeq = createMemo(() => Math.max(0, Number(props.revealRequestSeq ?? 0) || 0));
  const committedRevealKey = createMemo(() => `${conversationKey()}:${revealRequestSeq()}`);
  const revealRequiresBottomCommit = createMemo(() => (
    props.revealPolicy === 'hidden_until_bottom_committed' && messages().length > 0
  ));
  const listRevealReady = createMemo(() => (
    !revealRequiresBottomCommit() || committedConversationKey() === committedRevealKey()
  ));

  const completeRevealCommit = (key: string, requestSeq: number): boolean => {
    if (key !== conversationKey() || requestSeq !== revealRequestSeq()) return false;
    const revealKey = `${key}:${requestSeq}`;
    if (committedConversationKey() === revealKey) return true;
    if (!commitBottomNow()) return false;
    setCommittedConversationKey(revealKey);
    props.onBottomCommitted?.(key, requestSeq);
    return true;
  };

  const queueRevealCommit = (): void => {
    if (!revealRequiresBottomCommit()) return;
    if (committedConversationKey() === committedRevealKey()) return;
    if (!scrollContainerEl) return;
    if (revealCommitQueued) return;
    const key = conversationKey();
    const requestSeq = revealRequestSeq();
    revealCommitQueued = true;
    requestAnimationFrame(() => {
      revealCommitQueued = false;
      if (!completeRevealCommit(key, requestSeq)) {
        queueRevealCommit();
      }
    });
  };

  const scheduleFollowToBottom = (behavior?: ScrollToBottomBehavior, passes = 1) => {
    if (behavior) {
      setFollowMotionMode(resolveFollowMotionMode(behavior));
    }
    if (followMotionMode === 'animated') {
      requestAnimatedFollowToBottom();
      return;
    }
    if (followToBottomRaf !== null) return;
    followToBottomRaf = requestAnimationFrame(() => {
      followToBottomRaf = null;
      if (followMode() !== 'following') return;
      if (!scrollToBottomNow('auto')) return;
      if (passes > 1) {
        scheduleFollowToBottom(undefined, passes - 1);
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
      cancelScheduledInstantFollow();
      setFollowMotionMode('instant');
      return;
    }

    if (currentCount > prevMessageCount) {
      const addedCount = currentCount - prevMessageCount;
      if (followMode() === 'following') {
        scheduleFollowToBottom();
      } else {
        setPendingMessageCount((count) => count + addedCount);
      }
    }

    prevMessageCount = currentCount;

    requestAnimationFrame(() => {
      updateDistanceToBottom();
      queueRevealCommit();
    });
  });

  createEffect(() => {
    if (!revealRequiresBottomCommit()) {
      return;
    }
    if (committedConversationKey() !== committedRevealKey()) {
      queueRevealCommit();
    }
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
    applyFollowingMode('instant');
    if (revealRequiresBottomCommit()) {
      queueRevealCommit();
    } else {
      scheduleFollowToBottom('auto', EXTERNAL_SCROLL_SYNC_PASSES);
    }
  });

  // External bottom intents (thread switch/send) are funneled into the same state machine.
  createEffect(() => {
    scrollContainerVersion();
    const request = ctx.scrollToBottomRequest();
    if (!request || !scrollContainerEl) return;
    if (request.seq <= lastHandledScrollRequestSeq) return;

    lastHandledScrollRequestSeq = request.seq;
    applyFollowingMode(resolveRequestMotionMode(request));
    const syncPasses = request.source === 'system' ? EXTERNAL_SCROLL_SYNC_PASSES : 1;
    const behavior = request.reason === 'thread_switch' && request.source === 'system'
      ? 'auto'
      : request.behavior;
    scheduleFollowToBottom(behavior, syncPasses);
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
        capturePausedViewportAnchor(el);
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
    const updates: Array<{
      index: number;
      messageId: string;
      nextHeight: number;
      delta: number;
    }> = [];

    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const messageId = resizeObserverMap.get(el);
      if (!messageId) continue;

      const index = messageIndexByRenderKey().get(messageId);
      if (index === undefined) continue;

      const borderBoxHeight = entry.borderBoxSize?.[0]?.blockSize;
      const rectHeight = (entry.target as HTMLElement).getBoundingClientRect().height;
      const rawHeight = borderBoxHeight ?? (rectHeight > 0 ? rectHeight : entry.contentRect.height);
      const height = Math.round(rawHeight);
      if (height <= 0) continue;

      const cachedHeight = ctx.getMessageHeight(messageId);
      if (Math.abs(cachedHeight - height) < 1) {
        continue;
      }

      updates.push({
        index,
        messageId,
        nextHeight: height,
        delta: height - cachedHeight,
      });
    }

    if (updates.length === 0) return;

    const target = scrollContainerEl;
    const keepViewportAnchor = followMode() === 'paused' && !!target;
    const totalDelta = updates.reduce((sum, update) => sum + update.delta, 0);

    for (const update of updates) {
      ctx.setMessageHeight(update.messageId, update.nextHeight);
      virtualList.setItemHeight(update.index, update.nextHeight);
    }

    if (keepViewportAnchor && target) {
      const nextAnchorScrollTop = resolveViewportAnchorScrollTop(
        viewportAnchor,
        messageIndexByRenderKey(),
        virtualList.getItemOffset,
      );
      if (nextAnchorScrollTop !== null && Math.abs(nextAnchorScrollTop - target.scrollTop) > 0.5) {
        target.scrollTop = nextAnchorScrollTop;
        syncProgrammaticScroll(target);
      }
    } else if (followMode() === 'following' && target) {
      applyFollowScrollDelta(target, totalDelta);
    }

    updateDistanceToBottom(target);
  });

  const tailResizeObserver = new ResizeObserver((entries) => {
    const target = scrollContainerEl;
    if (!target) return;
    const entry = entries[0];
    if (!entry) return;

    const rawHeight =
      entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    const nextHeight = Math.round(rawHeight);
    if (nextHeight <= 0) return;

    const delta = tailObservedHeight > 0 ? nextHeight - tailObservedHeight : 0;
    tailObservedHeight = nextHeight;

    if (followMode() === 'following') {
      applyFollowScrollDelta(target, delta);
      queueRevealCommit();
    } else {
      updateDistanceToBottom(target);
    }
  });

  const scrollContainerResizeObserver = new ResizeObserver((entries) => {
    const target = scrollContainerEl;
    if (!target) return;
    const entry = entries[0];
    if (!entry) return;

    const rawHeight =
      entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    const nextHeight = Math.round(rawHeight);
    if (nextHeight <= 0) return;

    const delta = scrollViewportHeight > 0 ? scrollViewportHeight - nextHeight : 0;
    scrollViewportHeight = nextHeight;

    if (followMode() === 'following') {
      applyFollowScrollDelta(target, delta);
    } else {
      updateDistanceToBottom(target);
    }
  });

  createEffect(() => {
    const tailVisible = props.tailVisible === true;
    const el = tailContainerEl;
    tailResizeObserver.disconnect();
    tailObservedHeight = el ? Math.round(el.getBoundingClientRect().height) : 0;
    if (!tailVisible || !el) return;
    tailResizeObserver.observe(el);
    requestAnimationFrame(() => {
      updateDistanceToBottom();
      if (followMode() === 'following') {
        scheduleFollowToBottom();
      }
    });
  });

  onCleanup(() => {
    scrollContainerEl = null;
    resizeObserver.disconnect();
    tailResizeObserver.disconnect();
    scrollContainerResizeObserver.disconnect();
    cancelScheduledInstantFollow();
    cancelAnimatedFollow();
    revealCommitQueued = false;
  });

  // Ref callback for message items — observe resizes.
  function observeItem(el: HTMLElement, messageId: string): void {
    resizeObserverMap.set(el, messageId);
    resizeObserver.observe(el);
  }

  function unobserveItem(el: HTMLElement): void {
    resizeObserverMap.delete(el);
    resizeObserver.unobserve(el);
  }

  const visibleMessageRenderKeys = createMemo<string[]>(() => {
    const currentMessages = messages();
    const keys: string[] = [];
    virtualList.virtualItems().forEach((item) => {
      const msg = currentMessages[item.index];
      if (!msg) return;
      keys.push(getMessageRenderKey(msg));
    });
    return keys;
  });

  return (
    <div class={cn('chat-message-list-container', props.class)}>
      <Show when={isLoadingHistory()}>
        <div class="chat-loading-more">{i18n.t('uiCopy.chat.loadingHistory')}</div>
      </Show>

      <div
        class="chat-message-list-scroll"
        ref={((el: HTMLElement) => {
          scrollContainerResizeObserver.disconnect();
          scrollContainerEl = el;
          scrollViewportHeight = Math.round(el.clientHeight);
          scrollContainerResizeObserver.observe(el);
          virtualList.containerRef(el);
          virtualList.scrollRef(el);
          prevScrollTop = el.scrollTop;
          updateDistanceToBottom(el);
          setScrollContainerVersion((version) => version + 1);
          queueRevealCommit();
        }) as any}
        onScroll={handleScroll}
        data-chat-transcript-reveal-ready={listRevealReady() ? 'true' : 'false'}
        style={listRevealReady() ? undefined : { visibility: 'hidden' }}
      >
        <div class="chat-message-list-inner">
          <div
            class="chat-vlist-spacer"
            style={{ height: `${virtualList.paddingTop()}px` }}
          />

          <For each={visibleMessageRenderKeys()}>
            {(renderKey) => (
              <VirtualMessageRow
                renderKey={renderKey}
                observeItem={observeItem}
                unobserveItem={unobserveItem}
                messageByRenderKey={messageByRenderKey}
              />
            )}
          </For>

          <div
            class="chat-vlist-spacer"
            style={{ height: `${virtualList.paddingBottom()}px` }}
          />

          <Show when={props.tailVisible && props.tailComponent}>
            <div
              class="chat-message-list-tail"
              ref={(el) => {
                tailContainerEl = el;
              }}
            >
              <Dynamic component={props.tailComponent} />
            </div>
          </Show>
        </div>

        <Show when={showListWorkingIndicator() && isWorking()}>
          <div class="chat-working-indicator-wrapper">
            <WorkingIndicator />
          </div>
        </Show>
      </div>

      <Show when={showScrollToBottom()}>
        <button
          class="chat-scroll-to-bottom-btn"
          onClick={() => {
            applyFollowingMode(resolveFollowMotionMode('smooth'));
            ctx.requestScrollToBottom({ source: 'user', behavior: 'smooth', reason: 'manual' });
          }}
          aria-label={i18n.t('chatActivity.scrollToBottom')}
          title={pendingMessageCount() > 0
            ? i18n.tn('chatActivity.newMessages', pendingMessageCount(), { count: pendingMessageCount() })
            : i18n.t('chatActivity.scrollToBottom')}
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
