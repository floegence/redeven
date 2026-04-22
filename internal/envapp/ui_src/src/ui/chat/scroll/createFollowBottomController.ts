export type FollowBottomMode = 'following' | 'paused';
export type FollowBottomRequestReason = 'bootstrap' | 'thread_switch' | 'send' | 'manual';
export type FollowBottomRequestSource = 'system' | 'user';
export type FollowBottomScrollBehavior = 'auto' | 'smooth';
export type FollowBottomMotionMode = 'instant' | 'animated';

export type FollowBottomRequest = Readonly<{
  seq: number;
  reason: FollowBottomRequestReason;
  source: FollowBottomRequestSource;
  behavior: FollowBottomScrollBehavior;
}>;

export type FollowBottomViewportAnchor = Readonly<{
  id: string;
  topOffsetPx: number;
}>;

type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  disconnect: () => void;
}>;

type ResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserverLike | null;
type EventTargetLike = Readonly<{
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
}>;

export type FollowBottomController = Readonly<{
  setScrollContainer: (element: HTMLElement | null | undefined) => void;
  setContentRoot: (element: HTMLElement | null | undefined) => void;
  handleScroll: () => void;
  requestFollowBottom: (request?: FollowBottomRequest | null) => void;
  mode: () => FollowBottomMode;
  distanceToBottomPx: () => number;
  dispose: () => void;
}>;

export type CreateFollowBottomControllerArgs = Readonly<{
  followThresholdPx?: number;
  explicitSyncPasses?: number;
  recentUserScrollIntentMs?: number;
  anchorAttribute?: string;
  createResizeObserver?: ResizeObserverFactory;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
  now?: () => number;
  eventTarget?: EventTargetLike | null;
  getPrefersReducedMotion?: () => boolean;
}>;

const DEFAULT_FOLLOW_THRESHOLD_PX = 24;
const DEFAULT_EXPLICIT_SYNC_PASSES = 2;
const DEFAULT_RECENT_USER_SCROLL_INTENT_MS = 640;
const DEFAULT_ANCHOR_ATTRIBUTE = 'data-follow-bottom-anchor-id';
const FOLLOW_RAF_PENDING = -1;
const ANIMATED_FOLLOW_TIME_CONSTANT_MS = 120;
const ANIMATED_FOLLOW_MIN_STEP_PX = 1;
const USER_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
  'Spacebar',
]);

function defaultResizeObserverFactory(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') return null;
  return new ResizeObserver(callback);
}

function fallbackRequestAnimationFrame(callback: FrameRequestCallback): number {
  callback(0);
  return 0;
}

function fallbackCancelAnimationFrame(): void {
  // No-op fallback for environments without rAF.
}

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function bottomScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function readAnchorID(element: Element, anchorAttribute: string): string {
  return String(element.getAttribute(anchorAttribute) ?? '').trim();
}

function anchorElements(contentRoot: HTMLElement, anchorAttribute: string): HTMLElement[] {
  return Array.from(contentRoot.querySelectorAll<HTMLElement>(`[${anchorAttribute}]`))
    .filter((element) => Boolean(readAnchorID(element, anchorAttribute)));
}

function findAnchorElementByID(
  contentRoot: HTMLElement,
  anchorAttribute: string,
  anchorID: string,
): HTMLElement | null {
  if (!anchorID) return null;
  return anchorElements(contentRoot, anchorAttribute)
    .find((element) => readAnchorID(element, anchorAttribute) === anchorID) ?? null;
}

export function createFollowBottomController(
  args: CreateFollowBottomControllerArgs = {},
): FollowBottomController {
  const followThresholdPx = Math.max(0, Number(args.followThresholdPx ?? DEFAULT_FOLLOW_THRESHOLD_PX) || 0);
  const explicitSyncPasses = Math.max(1, Number(args.explicitSyncPasses ?? DEFAULT_EXPLICIT_SYNC_PASSES) || 1);
  const recentUserScrollIntentMs = Math.max(0, Number(
    args.recentUserScrollIntentMs ?? DEFAULT_RECENT_USER_SCROLL_INTENT_MS,
  ) || 0);
  const anchorAttribute = String(args.anchorAttribute ?? DEFAULT_ANCHOR_ATTRIBUTE).trim() || DEFAULT_ANCHOR_ATTRIBUTE;
  const createResizeObserver = args.createResizeObserver ?? defaultResizeObserverFactory;
  const requestFrame = args.requestAnimationFrame ?? globalThis.requestAnimationFrame ?? fallbackRequestAnimationFrame;
  const cancelFrame = args.cancelAnimationFrame ?? globalThis.cancelAnimationFrame ?? fallbackCancelAnimationFrame;
  const now = args.now ?? Date.now;
  const eventTarget = args.eventTarget ?? (typeof window !== 'undefined' ? window : null);
  const getPrefersReducedMotion = args.getPrefersReducedMotion
    ?? (() => (
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ));

  let currentMode: FollowBottomMode = 'following';
  let currentDistanceToBottomPx = 0;
  let currentMotionMode: FollowBottomMotionMode = 'instant';
  let scrollContainerEl: HTMLElement | null = null;
  let contentRootEl: HTMLElement | null = null;
  let viewportAnchor: FollowBottomViewportAnchor | null = null;
  let prevScrollTop = 0;
  let lastHandledRequestSeq = 0;
  let remainingSyncPasses = 0;
  let followRaf: number | null = null;
  let animatedFollowRaf: number | null = null;
  let layoutBatchRaf: number | null = null;
  let animatedFollowTargetTop = 0;
  let animatedFollowLastTimestamp = 0;
  let recentUserScrollIntentUntilMs = 0;
  let pointerScrollGestureActive = false;
  let disposeUserScrollIntentListeners: (() => void) | null = null;
  let contentLayoutDirty = false;
  let containerLayoutDirty = false;

  const clearUserScrollIntent = (): void => {
    recentUserScrollIntentUntilMs = 0;
    pointerScrollGestureActive = false;
  };

  const markUserScrollIntent = (): void => {
    recentUserScrollIntentUntilMs = Math.max(recentUserScrollIntentUntilMs, now() + recentUserScrollIntentMs);
  };

  const hasRecentUserScrollIntent = (): boolean => (
    pointerScrollGestureActive ||
    now() <= recentUserScrollIntentUntilMs
  );

  const isUserScrollKey = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    return USER_SCROLL_KEYS.has(event.key);
  };

  const attachUserScrollIntentListeners = (element: HTMLElement): (() => void) => {
    const handleWheel = () => {
      markUserScrollIntent();
    };
    const handleTouch = () => {
      markUserScrollIntent();
    };
    const handlePointerDown = () => {
      pointerScrollGestureActive = true;
      markUserScrollIntent();
    };
    const handlePointerUp = () => {
      pointerScrollGestureActive = false;
    };
    const handleKeyDown = (event: Event) => {
      if (event instanceof KeyboardEvent && isUserScrollKey(event)) {
        markUserScrollIntent();
      }
    };

    element.addEventListener('wheel', handleWheel);
    element.addEventListener('touchstart', handleTouch);
    element.addEventListener('touchmove', handleTouch);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('keydown', handleKeyDown);
    eventTarget?.addEventListener('pointerup', handlePointerUp, true);
    eventTarget?.addEventListener('pointercancel', handlePointerUp, true);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('touchstart', handleTouch);
      element.removeEventListener('touchmove', handleTouch);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('keydown', handleKeyDown);
      eventTarget?.removeEventListener('pointerup', handlePointerUp, true);
      eventTarget?.removeEventListener('pointercancel', handlePointerUp, true);
    };
  };

  const updateDistanceToBottom = (target?: HTMLElement | null): void => {
    const element = target ?? scrollContainerEl;
    if (!element) {
      currentDistanceToBottomPx = 0;
      return;
    }
    currentDistanceToBottomPx = distanceFromBottom(element);
  };

  const applyFollowingMode = (): void => {
    currentMode = 'following';
    viewportAnchor = null;
    clearUserScrollIntent();
  };

  const syncProgrammaticScroll = (target: HTMLElement): void => {
    prevScrollTop = target.scrollTop;
    updateDistanceToBottom(target);
  };

  const cancelScheduledInstantFollow = (): void => {
    if (followRaf !== null) {
      cancelFrame(followRaf);
      followRaf = null;
    }
  };

  const cancelAnimatedFollow = (): void => {
    if (animatedFollowRaf !== null) {
      cancelFrame(animatedFollowRaf);
      animatedFollowRaf = null;
    }
    animatedFollowLastTimestamp = 0;
  };

  const cancelLayoutBatch = (): void => {
    if (layoutBatchRaf !== null) {
      cancelFrame(layoutBatchRaf);
      layoutBatchRaf = null;
    }
    contentLayoutDirty = false;
    containerLayoutDirty = false;
  };

  const setFollowMotionMode = (nextMode: FollowBottomMotionMode): void => {
    if (currentMotionMode === nextMode) return;
    currentMotionMode = nextMode;
    if (nextMode === 'animated') {
      cancelScheduledInstantFollow();
    } else {
      cancelAnimatedFollow();
    }
  };

  const resolveFollowMotionMode = (behavior: FollowBottomScrollBehavior): FollowBottomMotionMode => (
    behavior === 'smooth' && !getPrefersReducedMotion() ? 'animated' : 'instant'
  );

  const applyFollowingModeWithMotion = (nextMode?: FollowBottomMotionMode): void => {
    applyFollowingMode();
    if (nextMode) {
      setFollowMotionMode(nextMode);
    }
  };

  const applyPausedMode = (): void => {
    currentMode = 'paused';
    cancelScheduledInstantFollow();
    setFollowMotionMode('instant');
  };

  const captureViewportAnchor = (): FollowBottomViewportAnchor | null => {
    if (!scrollContainerEl || !contentRootEl) return null;
    const containerRect = scrollContainerEl.getBoundingClientRect();
    for (const element of anchorElements(contentRootEl, anchorAttribute)) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= containerRect.top) continue;
      return {
        id: readAnchorID(element, anchorAttribute),
        topOffsetPx: rect.top - containerRect.top,
      };
    }
    return null;
  };

  const restoreViewportAnchor = (): void => {
    if (!scrollContainerEl || !contentRootEl || !viewportAnchor) return;
    const element = findAnchorElementByID(contentRootEl, anchorAttribute, viewportAnchor.id);
    if (!element) return;
    const containerRect = scrollContainerEl.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const delta = rect.top - containerRect.top - viewportAnchor.topOffsetPx;
    if (Math.abs(delta) <= 0.5) return;
    scrollContainerEl.scrollTop += delta;
    syncProgrammaticScroll(scrollContainerEl);
  };

  const queueFollowFrame = (): void => {
    if (followRaf !== null) return;
    followRaf = FOLLOW_RAF_PENDING;
    const rafID = requestFrame(() => {
      followRaf = null;
      runFollowSync();
    });
    if (followRaf === FOLLOW_RAF_PENDING) {
      followRaf = rafID;
    }
  };

  const runFollowSync = (): void => {
    followRaf = null;
    if (!scrollContainerEl || currentMode !== 'following') {
      remainingSyncPasses = 0;
      return;
    }
    scrollContainerEl.scrollTop = bottomScrollTop(scrollContainerEl);
    syncProgrammaticScroll(scrollContainerEl);
    remainingSyncPasses = Math.max(0, remainingSyncPasses - 1);
    if (remainingSyncPasses > 0) {
      queueFollowFrame();
    }
  };

  const queueAnimatedFollow = (): void => {
    if (animatedFollowRaf !== null) return;
    animatedFollowRaf = requestFrame((timestamp) => {
      animatedFollowRaf = null;
      const target = scrollContainerEl;
      if (!target || currentMode !== 'following' || currentMotionMode !== 'animated') {
        animatedFollowLastTimestamp = 0;
        return;
      }

      animatedFollowTargetTop = bottomScrollTop(target);
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

  const requestAnimatedFollowToBottom = (target?: HTMLElement | null): void => {
    const element = target ?? scrollContainerEl;
    if (!element) return;
    animatedFollowTargetTop = bottomScrollTop(element);
    queueAnimatedFollow();
  };

  const scheduleFollowBottom = (
    behavior?: FollowBottomScrollBehavior,
    passes = 1,
  ): void => {
    if (!scrollContainerEl) return;
    if (behavior) {
      setFollowMotionMode(resolveFollowMotionMode(behavior));
    }
    if (currentMotionMode === 'animated') {
      requestAnimatedFollowToBottom(scrollContainerEl);
      return;
    }
    remainingSyncPasses = Math.max(remainingSyncPasses, Math.max(1, passes));
    queueFollowFrame();
  };

  const handleObservedLayoutChange = (): void => {
    if (!scrollContainerEl) return;
    if (currentMode === 'following') {
      scheduleFollowBottom(undefined, 1);
      return;
    }
    restoreViewportAnchor();
    updateDistanceToBottom(scrollContainerEl);
  };

  const flushObservedLayoutBatch = (): void => {
    layoutBatchRaf = null;
    if (!contentLayoutDirty && !containerLayoutDirty) return;
    contentLayoutDirty = false;
    containerLayoutDirty = false;
    handleObservedLayoutChange();
  };

  const queueObservedLayoutBatch = (source: 'content' | 'container'): void => {
    if (source === 'content') {
      contentLayoutDirty = true;
    } else {
      containerLayoutDirty = true;
    }
    if (layoutBatchRaf !== null) return;
    layoutBatchRaf = requestFrame(() => {
      flushObservedLayoutBatch();
    });
  };

  const contentResizeObserver = createResizeObserver(() => {
    queueObservedLayoutBatch('content');
  });

  const scrollContainerResizeObserver = createResizeObserver(() => {
    queueObservedLayoutBatch('container');
  });

  const setScrollContainer = (element: HTMLElement | null | undefined): void => {
    const nextElement = element ?? null;
    if (scrollContainerEl === nextElement) return;
    scrollContainerResizeObserver?.disconnect();
    disposeUserScrollIntentListeners?.();
    disposeUserScrollIntentListeners = null;
    clearUserScrollIntent();
    scrollContainerEl = nextElement;
    prevScrollTop = nextElement?.scrollTop ?? 0;
    updateDistanceToBottom(nextElement);
    if (scrollContainerEl) {
      disposeUserScrollIntentListeners = attachUserScrollIntentListeners(scrollContainerEl);
      scrollContainerResizeObserver?.observe(scrollContainerEl);
      if (currentMode === 'following') {
        scheduleFollowBottom(undefined, 1);
      }
    }
  };

  const setContentRoot = (element: HTMLElement | null | undefined): void => {
    const nextElement = element ?? null;
    if (contentRootEl === nextElement) return;
    contentResizeObserver?.disconnect();
    contentRootEl = nextElement;
    if (contentRootEl) {
      contentResizeObserver?.observe(contentRootEl);
      if (currentMode === 'following') {
        scheduleFollowBottom(undefined, 1);
      }
    }
  };

  const handleScroll = (): void => {
    if (!scrollContainerEl) return;
    const nextScrollTop = scrollContainerEl.scrollTop;
    const scrollDeltaPx = nextScrollTop - prevScrollTop;
    const didScrollMeaningfully = Math.abs(scrollDeltaPx) > 0.5;
    const userScrollingUp = scrollDeltaPx < -0.5 && hasRecentUserScrollIntent();
    updateDistanceToBottom(scrollContainerEl);
    if (userScrollingUp) {
      applyPausedMode();
      viewportAnchor = captureViewportAnchor();
    } else if (currentDistanceToBottomPx <= followThresholdPx) {
      applyFollowingMode();
    } else if (didScrollMeaningfully) {
      if (hasRecentUserScrollIntent()) {
        applyPausedMode();
        viewportAnchor = captureViewportAnchor();
      } else if (currentMode === 'following') {
        scheduleFollowBottom(undefined, 1);
      }
    }
    prevScrollTop = nextScrollTop;
  };

  const requestFollowBottom = (request?: FollowBottomRequest | null): void => {
    if (request && request.seq <= lastHandledRequestSeq) {
      return;
    }
    if (request) {
      lastHandledRequestSeq = request.seq;
    }
    const behavior = request?.behavior ?? 'auto';
    const source = request?.source ?? 'system';
    applyFollowingModeWithMotion(resolveFollowMotionMode(behavior));
    scheduleFollowBottom(behavior, source === 'system' ? explicitSyncPasses : 1);
  };

  const dispose = (): void => {
    contentResizeObserver?.disconnect();
    scrollContainerResizeObserver?.disconnect();
    disposeUserScrollIntentListeners?.();
    disposeUserScrollIntentListeners = null;
    cancelScheduledInstantFollow();
    cancelAnimatedFollow();
    cancelLayoutBatch();
    scrollContainerEl = null;
    contentRootEl = null;
    viewportAnchor = null;
    remainingSyncPasses = 0;
    clearUserScrollIntent();
  };

  return {
    setScrollContainer,
    setContentRoot,
    handleScroll,
    requestFollowBottom,
    mode: () => currentMode,
    distanceToBottomPx: () => currentDistanceToBottomPx,
    dispose,
  };
}
