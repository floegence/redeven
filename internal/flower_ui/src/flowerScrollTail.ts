import { createSignal, type Accessor } from 'solid-js';

export const FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
export const FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;

export type FlowerScrollTailController = Readonly<{
  bind: (node: HTMLDivElement | undefined) => void;
  nearBottom: Accessor<boolean>;
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
  scheduleTailScroll: (options?: Readonly<{ smooth?: boolean; force?: boolean }>) => void;
  scrollToBottom: (options?: Readonly<{ smooth?: boolean }>) => void;
  dispose: () => void;
}>;

export type FlowerScrollTailControllerOptions = Readonly<{
  reducedMotionPreferred: () => boolean;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  onUserInteraction?: () => void;
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
  let userScroll: { top: number; height: number; viewportHeight: number; moved: boolean } | undefined;

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
  const scheduleLayout = () => {
    if (layoutFrame) return;
    layoutFrame = options.requestAnimationFrame((timestamp) => {
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
      } else if (request) smoothScroll = undefined;
      let nextTop = scrollTop + anchorDelta;
      if (followingLatest()) {
        const bottom = Math.max(0, scrollHeight - viewportHeight);
        if (smoothScroll) {
          const progress = Math.min(1, Math.max(0, (timestamp - smoothScroll.startedAt) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS));
          nextTop = smoothScroll.startTop + (bottom - smoothScroll.startTop) * (1 - (1 - progress) ** 3);
          if (progress >= 1) smoothScroll = undefined;
        } else nextTop = bottom;
      }
      if (nextTop !== scrollTop) setScrollTop(target, nextTop);
      setNearBottom(scrollHeight - nextTop - viewportHeight <= FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX);
      if (anchor?.finished) clearAnchor();
      if (gesture() || anchor || smoothScroll) scheduleLayout();
    });
  };
  const scrollToBottom = (scrollOptions: Readonly<{ smooth?: boolean }> = {}) => {
    if (!node) return;
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
    pendingScroll = scrollOptions;
    scheduleLayout();
  };
  const measureAfterLayout = scheduleLayout;

  const ownsScrollInput = (target: EventTarget | null): boolean => {
    if (!node) return false;
    if (target === node) return true;
    // A terminal, detail panel, editor, or other nested viewport owns its input
    // even when it has reached its edge. Do not broaden Workbench wheel ownership.
    let element = target instanceof Element ? target : null;
    while (element && element !== node) {
      const style = window.getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return false;
      element = element.parentElement;
    }
    return element === node;
  };
  const startUserScroll = (direction: number) => {
    if (!node) return;
    const current = gesture();
    if (current) current.scrolled = true;
    clearAnchor();
    stopFollowing();
    options.onUserInteraction?.();
    userScroll = { top: node.scrollTop, height: node.scrollHeight, viewportHeight: node.clientHeight, moved: false };
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
    if (!ownsScrollInput(event.target)) return;
    const nextY = event.touches[0]?.clientY;
    if (nextY === undefined) return;
    startUserScroll(touchY === undefined ? 0 : touchY - nextY);
    touchY = nextY;
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
    if (!ownsScrollInput(event.target)) return;
    const direction = ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) ? (event.shiftKey ? -1 : 1)
      : ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ? -1 : 0;
    if (direction) startUserScroll(direction);
  };
  const onScroll = () => {
    if (!node) return;
    const input = userScroll;
    if (input) {
      const delta = node.scrollTop - input.top;
      const sameLayout = input.height === node.scrollHeight && input.viewportHeight === node.clientHeight;
      input.top = node.scrollTop;
      input.height = node.scrollHeight;
      input.viewportHeight = node.clientHeight;
      input.moved ||= delta !== 0;
      if (delta < 0 && sameLayout) stopFollowing();
      if (delta > 0 && sameLayout && isNearBottom()) setFollowingLatest(true);
    }
    // Scroll events report geometry; only a verified user scroll may resume.
    setNearBottom(isNearBottom());
  };
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0 || !ownsScrollInput(event.target)) return;
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
      resizeObserver?.disconnect();
      disconnect = undefined;
    };
  };

  return {
    bind,
    nearBottom,
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
