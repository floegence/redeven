export type FollowBottomMode = 'following' | 'paused';

export type FollowBottomRequest = Readonly<{
  seq: number;
  reason: string;
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
  anchorAttribute?: string;
  createResizeObserver?: ResizeObserverFactory;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
}>;

const DEFAULT_FOLLOW_THRESHOLD_PX = 72;
const DEFAULT_EXPLICIT_SYNC_PASSES = 2;
const DEFAULT_ANCHOR_ATTRIBUTE = 'data-follow-bottom-anchor-id';
const FOLLOW_RAF_PENDING = -1;

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
  const anchorAttribute = String(args.anchorAttribute ?? DEFAULT_ANCHOR_ATTRIBUTE).trim() || DEFAULT_ANCHOR_ATTRIBUTE;
  const createResizeObserver = args.createResizeObserver ?? defaultResizeObserverFactory;
  const requestFrame = args.requestAnimationFrame ?? globalThis.requestAnimationFrame ?? fallbackRequestAnimationFrame;
  const cancelFrame = args.cancelAnimationFrame ?? globalThis.cancelAnimationFrame ?? fallbackCancelAnimationFrame;

  let currentMode: FollowBottomMode = 'following';
  let currentDistanceToBottomPx = 0;
  let scrollContainerEl: HTMLElement | null = null;
  let contentRootEl: HTMLElement | null = null;
  let viewportAnchor: FollowBottomViewportAnchor | null = null;
  let prevScrollTop = 0;
  let lastHandledRequestSeq = 0;
  let remainingSyncPasses = 0;
  let followRaf: number | null = null;

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
    prevScrollTop = scrollContainerEl.scrollTop;
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
    scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight;
    prevScrollTop = scrollContainerEl.scrollTop;
    updateDistanceToBottom(scrollContainerEl);
    remainingSyncPasses = Math.max(0, remainingSyncPasses - 1);
    if (remainingSyncPasses > 0) {
      queueFollowFrame();
    }
  };

  const scheduleFollowBottom = (passes = 1): void => {
    if (!scrollContainerEl) return;
    remainingSyncPasses = Math.max(remainingSyncPasses, Math.max(1, passes));
    queueFollowFrame();
  };

  const handleObservedLayoutChange = (): void => {
    if (!scrollContainerEl) return;
    if (currentMode === 'following') {
      scheduleFollowBottom(1);
      return;
    }
    restoreViewportAnchor();
    updateDistanceToBottom(scrollContainerEl);
  };

  const contentResizeObserver = createResizeObserver(() => {
    handleObservedLayoutChange();
  });

  const scrollContainerResizeObserver = createResizeObserver(() => {
    handleObservedLayoutChange();
  });

  const setScrollContainer = (element: HTMLElement | null | undefined): void => {
    const nextElement = element ?? null;
    if (scrollContainerEl === nextElement) return;
    scrollContainerResizeObserver?.disconnect();
    scrollContainerEl = nextElement;
    prevScrollTop = nextElement?.scrollTop ?? 0;
    updateDistanceToBottom(nextElement);
    if (scrollContainerEl) {
      scrollContainerResizeObserver?.observe(scrollContainerEl);
      if (currentMode === 'following') {
        scheduleFollowBottom(1);
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
        scheduleFollowBottom(1);
      }
    }
  };

  const handleScroll = (): void => {
    if (!scrollContainerEl) return;
    const nextScrollTop = scrollContainerEl.scrollTop;
    updateDistanceToBottom(scrollContainerEl);
    if (currentDistanceToBottomPx <= followThresholdPx) {
      applyFollowingMode();
    } else if (Math.abs(nextScrollTop - prevScrollTop) > 0.5) {
      currentMode = 'paused';
      viewportAnchor = captureViewportAnchor();
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
    applyFollowingMode();
    scheduleFollowBottom(explicitSyncPasses);
  };

  const dispose = (): void => {
    contentResizeObserver?.disconnect();
    scrollContainerResizeObserver?.disconnect();
    if (followRaf !== null) {
      cancelFrame(followRaf);
      followRaf = null;
    }
    scrollContainerEl = null;
    contentRootEl = null;
    viewportAnchor = null;
    remainingSyncPasses = 0;
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
