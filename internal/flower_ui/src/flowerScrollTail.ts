import { createSignal, type Accessor } from 'solid-js';

export const FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
export const FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;

export type FlowerScrollTailController = Readonly<{
  bind: (node: HTMLDivElement | undefined) => void;
  nearBottom: Accessor<boolean>;
  followingLatest: Accessor<boolean>;
  viewport: () => HTMLDivElement | undefined;
  preserveLayoutAnchor: (title: HTMLElement) => void;
  showLatest: Accessor<boolean>;
  latestPointerBlocked: Accessor<boolean>;
  onPointerDown: (event: PointerEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  activateDisclosure: (title: HTMLElement) => void;
  finishDisclosure: (title: HTMLElement) => void;
  releaseDisclosure: (title: HTMLElement) => void;
  userInterruptionRevision: () => number;
  startFollowing: () => void;
  stopFollowing: () => void;
  onScroll: () => void;
  onWheel: (event: WheelEvent) => void;
  measureAfterLayout: () => void;
  flushLayout: () => void;
  prepareArrival: () => number;
  scheduleTailScroll: (options?: Readonly<{ smooth?: boolean; force?: boolean }>) => void;
  scrollToBottom: (options?: Readonly<{ smooth?: boolean }>) => void;
  dispose: () => void;
}>;

export type FlowerScrollTailControllerOptions = Readonly<{
  canFollowLatest?: () => boolean;
  reducedMotionPreferred: () => boolean;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  onUserInteraction?: () => void;
  onLayout?: () => void;
}>;

export function createFlowerScrollTailController(
  options: FlowerScrollTailControllerOptions,
): FlowerScrollTailController {
  const [nearBottom, setNearBottom] = createSignal(true);
  let node: HTMLDivElement | undefined;
  let layoutFrame = 0;
  let pendingScroll: Readonly<{ smooth?: boolean; force?: boolean }> | undefined;
  let smoothScroll: { startedAt: number; startTop: number } | undefined;
  const [followingLatest, setFollowingLatest] = createSignal(true);
  let userInterruptionRevision = 0;
  let anchor: { title: HTMLElement; top: number; activated: boolean; finished?: boolean } | undefined;
  type Gesture = {
    target: Element;
    pointerID?: number;
    key?: string;
    wasFollowing: boolean;
    latest: boolean;
    activated: boolean;
    scrolled: boolean;
    latestVisible: boolean;
  };
  const [gesture, setGesture] = createSignal<Gesture>();
  let releaseFrame = 0;
  let scrollIntentFrame = 0;
  let disconnect: (() => void) | undefined;
  let touchY: number | undefined;
  let userScroll: { top: number; height: number; viewportHeight: number; direction: number; moved: boolean } | undefined;

  const clearFrame = (id: number) => {
    if (id) options.cancelAnimationFrame(id);
    return 0;
  };
  const clearAnchor = () => { anchor = undefined; };
  const endUserScroll = () => {
    userScroll = undefined;
    scrollIntentFrame = clearFrame(scrollIntentFrame);
  };

  const startFollowing = () => {
    clearAnchor();
    endUserScroll();
    setFollowingLatest(true);
    setNearBottom(isNearBottom());
  };
  const isNearBottom = (): boolean => {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX;
  };
  const cancelScheduledScroll = () => { pendingScroll = undefined; };
  const cancelSmoothScroll = () => { smoothScroll = undefined; };
  const stopFollowing = () => {
    setFollowingLatest(false);
    userInterruptionRevision += 1;
    cancelScheduledScroll();
    cancelSmoothScroll();
    setNearBottom(isNearBottom());
  };
  const setScrollTop = (target: HTMLDivElement, scrollTop: number) => {
    target.scrollTop = scrollTop;
    // Our own position writes cannot count as user scrolling.
    if (userScroll) userScroll.top = target.scrollTop;
  };
  // Resize, tail-follow, smooth scrolling and disclosure anchoring share one
  // read/write pass. Notifications never cancel and restart the frame deadline.
  const layout = (timestamp: number) => {
    layoutFrame = 0;
    const target = node;
    if (!target) return;
    if (gesture() && !gesture()!.target.isConnected) finishGesture();
    if (anchor && (!anchor.title.isConnected || !target.contains(anchor.title))) clearAnchor();
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const viewportHeight = target.clientHeight;
    const anchorDelta = anchor ? anchor.title.getBoundingClientRect().top - anchor.top : 0;
    const request = pendingScroll;
    pendingScroll = undefined;
    if (request?.smooth && !options.reducedMotionPreferred()) {
      smoothScroll = { startedAt: timestamp, startTop: scrollTop };
    }
    let nextTop = scrollTop + anchorDelta;
    if (followingLatest() && (options.canFollowLatest?.() ?? true)) {
      const bottom = Math.max(0, scrollHeight - viewportHeight);
      if (smoothScroll && !options.reducedMotionPreferred()) {
        const progress = Math.min(1, Math.max(0, (timestamp - smoothScroll.startedAt) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS));
        nextTop = smoothScroll.startTop + (bottom - smoothScroll.startTop) * (1 - (1 - progress) ** 3);
        if (progress >= 1) smoothScroll = undefined;
      } else { smoothScroll = undefined; nextTop = bottom; }
    }
    if (nextTop !== scrollTop) setScrollTop(target, nextTop);
    setNearBottom(scrollHeight - nextTop - viewportHeight <= FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX);
    options.onLayout?.();
    if (anchor?.finished) clearAnchor();
    if (gesture() || anchor || smoothScroll) scheduleLayout();
  };
  const scheduleLayout = () => {
    if (!layoutFrame) layoutFrame = options.requestAnimationFrame(layout);
  };
  const scrollToBottom = (scrollOptions: Readonly<{ smooth?: boolean }> = {}) => {
    if (!node || !(options.canFollowLatest?.() ?? true)) return;
    startFollowing();
    if (scrollOptions.smooth && !options.reducedMotionPreferred()) {
      pendingScroll = scrollOptions;
      scheduleLayout();
    } else {
      cancelSmoothScroll();
      pendingScroll = undefined;
      setScrollTop(node, Math.max(0, node.scrollHeight - node.clientHeight));
      setNearBottom(true);
    }
  };
  const scheduleTailScroll = (scrollOptions: Readonly<{ smooth?: boolean; force?: boolean }> = {}) => {
    if (!scrollOptions.force && !followingLatest()) return;
    if (scrollOptions.force) startFollowing();
    pendingScroll = { ...scrollOptions, smooth: scrollOptions.smooth || pendingScroll?.smooth };
    scheduleLayout();
  };
  const measureAfterLayout = scheduleLayout;

  const ownsScrollInput = (target: EventTarget | null, direction: number): boolean => {
    if (!node) return false;
    if (target === node) return true;
    // Match the browser's native scroll chain, including nested reading regions.
    // A region owns input while it can scroll in that direction; explicit CSS
    // containment stops the chain even when its content fits without scrolling.
    let element = target instanceof Element ? target : null;
    while (element && element !== node) {
      const style = window.getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY)) {
        if (style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') return false;
        const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
        if (element.scrollHeight > element.clientHeight
          && (direction === 0 || direction < 0 && element.scrollTop > 1 || direction > 0 && remaining > 1)) return false;
      }
      element = element.parentElement;
    }
    return element === node;
  };
  const startUserScroll = (direction: number) => {
    if (!node) return;
    // Input cannot leave the tail while all content fits in the viewport.
    if (followingLatest() && node.scrollHeight <= node.clientHeight) return;
    clearAnchor();
    stopFollowing();
    options.onUserInteraction?.();
    userScroll = { top: node.scrollTop, height: node.scrollHeight, viewportHeight: node.clientHeight, direction, moved: false };
    scrollIntentFrame = clearFrame(scrollIntentFrame);
    // Native scrolling happens after the input default action. Expire input
    // that did not scroll; an actual scroll keeps ownership until scrollend.
    scrollIntentFrame = options.requestAnimationFrame(() => {
      scrollIntentFrame = options.requestAnimationFrame(() => {
        scrollIntentFrame = 0;
        const draggingScrollbar = gesture()?.target === node && gesture()?.pointerID !== undefined;
        if (!userScroll?.moved && !draggingScrollbar) endUserScroll();
      });
    });
    if (direction > 0 && node.scrollHeight - node.clientHeight - node.scrollTop <= 1) startFollowing();
  };
  const stabilizeAnchor = () => {
    if (!anchor || !node) return;
    if (!anchor.title.isConnected || !node.contains(anchor.title)) {
      clearAnchor();
      return;
    }
    const delta = anchor.title.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.01) setScrollTop(node, node.scrollTop + delta);
  };
  const finishGesture = () => {
    releaseFrame = clearFrame(releaseFrame);
    const current = gesture();
    if (!current) return;
    stabilizeAnchor();
    if (!current.activated) {
      clearAnchor();
      if (current.wasFollowing && !current.scrolled) {
        startFollowing();
        measureAfterLayout();
      }
    }
    setGesture(undefined);
    if (!userScroll?.moved) endUserScroll();
  };
  const scheduleGestureRelease = () => {
    releaseFrame = clearFrame(releaseFrame);
    // Leave hit testing unchanged through pointerup and native click dispatch.
    releaseFrame = options.requestAnimationFrame(finishGesture);
  };
  const trackInteraction = scheduleLayout;
  const beginAnchor = (title: HTMLElement, activated: boolean) => {
    if (!node || !node.contains(title)) return;
    if (anchor?.title === title) {
      anchor.activated ||= activated;
    } else {
      anchor = { title, top: title.getBoundingClientRect().top, activated };
    }
    stopFollowing();
    endUserScroll();
    options.onUserInteraction?.();
    trackInteraction();
  };
  const beginGesture = (target: Element, identity: { pointerID?: number; key?: string }) => {
    if (gesture()) finishGesture();
    clearAnchor();
    const latest = Boolean(target.closest('[data-flower-scroll-to-latest]'));
    setGesture({ target, ...identity, latest, wasFollowing: followingLatest(), activated: false, scrolled: false, latestVisible: !followingLatest() && !nearBottom() });
    const title = target.closest<HTMLElement>('[data-flower-disclosure-trigger]');
    if (title && !latest) beginAnchor(title, false);
    trackInteraction();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
    touchY = event.pointerType === 'touch' ? event.clientY : undefined;
    beginGesture(event.target, { pointerID: event.pointerId });
    if (event.target === node && event.pointerType !== 'touch') startUserScroll(0);
  };
  const onTouchMove = (event: TouchEvent) => {
    const nextY = event.touches[0]?.clientY;
    if (nextY === undefined) return;
    const direction = touchY === undefined ? 0 : touchY - nextY;
    touchY = nextY;
    if (ownsScrollInput(event.target, direction)) startUserScroll(direction);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('[data-flower-disclosure-trigger], [data-flower-scroll-to-latest]');
    if (control && (event.key === 'Enter' || event.key === ' ')) {
      if (!event.repeat) beginGesture(control, { key: event.key });
      return;
    }
    if (event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    if (event.key === ' ' && event.target.closest('button, summary')) return;
    const direction = ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) ? (event.shiftKey ? -1 : 1)
      : ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ? -1 : 0;
    if (direction && ownsScrollInput(event.target, direction)) startUserScroll(direction);
  };
  const onScroll = () => {
    if (!node) return;
    const input = userScroll;
    if (input) {
      const delta = node.scrollTop - input.top;
      const sameLayout = input.height === node.scrollHeight && input.viewportHeight === node.clientHeight;
      // Growth can race a real downward scroll. A non-contracting scroll range
      // cannot clamp the viewport forward, so it still proves user movement.
      const rangeDidNotShrink = node.scrollHeight - node.clientHeight >= input.height - input.viewportHeight;
      const moved = delta !== 0 && (sameLayout || delta > 0 && rangeDidNotShrink);
      const reachedPreviousBottom = node.scrollTop >= Math.max(0, input.height - input.viewportHeight) - 1;
      input.top = node.scrollTop;
      input.height = node.scrollHeight;
      input.viewportHeight = node.clientHeight;
      input.moved ||= moved;
      if (moved) {
        const current = gesture();
        if (current) current.scrolled = true;
        if (delta < 0) stopFollowing();
        if (delta > 0 && input.direction >= 0 && (isNearBottom() || reachedPreviousBottom)) {
          setFollowingLatest(true);
          scheduleLayout();
        }
      }
    }
    // Scroll events report geometry; only a verified user scroll may resume.
    setNearBottom(isNearBottom());
  };
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0 || !ownsScrollInput(event.target, event.deltaY)) return;
    startUserScroll(event.deltaY);
  };
  const activateDisclosure = (title: HTMLElement) => {
    const current = gesture();
    if (current) current.activated = true;
    beginAnchor(title, true);
  };
  const finishDisclosure = (title: HTMLElement) => {
    if (anchor?.title !== title || !anchor.activated) return;
    anchor.finished = true;
    scheduleLayout();
  };
  const bind = (nextNode: HTMLDivElement | undefined) => {
    disconnect?.();
    finishGesture();
    clearAnchor();
    endUserScroll();
    node = nextNode;
    setNearBottom(isNearBottom());
    if (!node?.ownerDocument) return;
    // Solid binds cloned template nodes before adoption into the live document.
    const document = globalThis.document;
    const window = document.defaultView!;
    const onRelease = (event: PointerEvent) => {
      if (gesture()?.pointerID === event.pointerId) scheduleGestureRelease();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (gesture()?.key === event.key) scheduleGestureRelease();
    };
    const onClick = (event: MouseEvent) => {
      const current = gesture();
      if (!current) return;
      if (current.latest && event.target instanceof Element && event.target.closest('[data-flower-scroll-to-latest]')) current.activated = true;
      scheduleGestureRelease();
    };
    const onBlur = () => { finishGesture(); clearAnchor(); endUserScroll(); };
    document.addEventListener('pointerup', onRelease, true);
    document.addEventListener('pointercancel', onRelease, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('blur', onBlur);
    node.addEventListener('scrollend', endUserScroll);
    // Historical rows may acquire real layout without a message mutation.
    // Capture their non-bubbling notification and reuse the same layout pass.
    node.addEventListener('contentvisibilityautostatechange', measureAfterLayout, true);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measureAfterLayout) : undefined;
    resizeObserver?.observe(node);
    if (node.firstElementChild) resizeObserver?.observe(node.firstElementChild);
    const boundNode = node;
    disconnect = () => {
      document.removeEventListener('pointerup', onRelease, true);
      document.removeEventListener('pointercancel', onRelease, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onBlur);
      boundNode.removeEventListener('scrollend', endUserScroll);
      boundNode.removeEventListener('contentvisibilityautostatechange', measureAfterLayout, true);
      resizeObserver?.disconnect();
      disconnect = undefined;
    };
  };

  return {
    bind,
    nearBottom,
    followingLatest,
    viewport: () => node,
    preserveLayoutAnchor: (title) => {
      if (!node?.contains(title) || followingLatest()) return;
      anchor = { title, top: title.getBoundingClientRect().top, activated: true };
      scheduleLayout();
    },
    showLatest: () => gesture()?.latestVisible ?? (!followingLatest() && !nearBottom()),
    latestPointerBlocked: () => Boolean(gesture() && !gesture()!.latest),
    onPointerDown,
    onTouchMove,
    onKeyDown,
    activateDisclosure,
    finishDisclosure,
    releaseDisclosure: (title) => { if (anchor?.title === title) clearAnchor(); },
    userInterruptionRevision: () => userInterruptionRevision,
    startFollowing,
    stopFollowing,
    onScroll,
    onWheel,
    measureAfterLayout,
    flushLayout: () => {
      layoutFrame = clearFrame(layoutFrame);
      layout(performance.now());
    },
    prepareArrival: () => {
      if (!node || !followingLatest() || !(options.canFollowLatest?.() ?? true) || options.reducedMotionPreferred()
        || node.scrollHeight - node.clientHeight - node.scrollTop <= 1) return 0;
      // A burst shares the current motion deadline. Ordinary layout notices
      // retarget its destination without turning it back into a one-frame jump.
      if (!smoothScroll && !pendingScroll?.smooth) scheduleTailScroll({ smooth: true });
      return FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS;
    },
    scheduleTailScroll,
    scrollToBottom,
    dispose: () => {
      disconnect?.();
      setGesture(undefined);
      clearAnchor();
      endUserScroll();
      releaseFrame = clearFrame(releaseFrame);
      layoutFrame = clearFrame(layoutFrame);
      cancelScheduledScroll();
      cancelSmoothScroll();
    },
  };
}
