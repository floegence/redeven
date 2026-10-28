import { createSignal, type Accessor } from 'solid-js';

export const FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
export const FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;

export type FlowerScrollTailController = Readonly<{
  isPreparing: () => boolean;
  registerDestination: (prepare: () => boolean) => () => void;
  prepareDestination: () => boolean;
  bind: (node: HTMLDivElement | undefined) => void;
  nearBottom: Accessor<boolean>;
  followingLatest: Accessor<boolean>;
  viewport: () => HTMLDivElement | undefined;
  preserveLayoutAnchor: (title: HTMLElement) => void;
  preserveCollapseOffset: (moving?: () => boolean) => void;
  restoreReadingAnchor: (title: HTMLElement, screenTop: number) => void;
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
  onScroll: () => 'before' | 'after' | 'following' | undefined;
  onWheel: (event: WheelEvent) => void;
  measureAfterLayout: () => void;
  flushLayout: (notify?: boolean) => void;
  prepareArrival: () => number;
  scheduleTailScroll: (options?: Readonly<{ smooth?: boolean; force?: boolean }>) => void;
  scrollToBottom: (options?: Readonly<{ smooth?: boolean }>) => void;
  dispose: () => void;
}>;

export type FlowerScrollTailControllerOptions = Readonly<{
  nearBottomThreshold?: number;
  observeChildren?: boolean;
  smoothContentGrowth?: boolean;
  canFollowLatest?: () => boolean;
  preparing?: () => boolean;
  reducedMotionPreferred: () => boolean;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  onUserInteraction?: () => void;
  onScrollIntent?: (direction: 'before' | 'after') => void;
  onLayout?: () => void;
}>;

export function createFlowerScrollTailController(
  options: FlowerScrollTailControllerOptions,
): FlowerScrollTailController {
  const destinations = new Set<() => boolean>();
  const nearBottomThreshold = options.nearBottomThreshold ?? FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX;
  const [nearBottom, setNearBottom] = createSignal(true);
  let node: HTMLDivElement | undefined;
  let knownScrollTop = 0;
  let knownScrollHeight = 0;
  let knownViewportHeight = 0;
  let readingTailSpace = 0;
  // An automatic fold may shrink the scroll range. Keep its prior offset until
  // new output fills the retained room or explicit navigation takes ownership.
  let collapseOffset: number | undefined;
  let collapseMoving: (() => boolean) | undefined;
  const clearCollapseOffset = () => { collapseOffset = undefined; collapseMoving = undefined; };
  let collapseFlushQueued = false;
  let layoutFrame = 0;
  let layoutDirty = false;
  let layoutNotificationPending = false;
  let presentationHidden = false;
  let immediateTail = true;
  let growthScroll: { bottom: number; position: number; timestamp?: number } | undefined;
  let growthScrollEvent = false;
  let pendingScroll: Readonly<{ smooth?: boolean; force?: boolean }> | undefined;
  let smoothScroll: { startedAt: number; startTop: number } | undefined;
  const [followingLatest, setFollowingLatest] = createSignal(true);
  let userInterruptionRevision = 0;
  let anchor: { title: HTMLElement; top: number; activated: boolean; finished?: boolean; reading?: boolean; fallbacks?: { title: HTMLElement; top: number }[] } | undefined;
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
  const outerReadingTarget = (target: HTMLElement) => {
    let result = target;
    for (let parent = target.parentElement; parent && parent !== node; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(window.getComputedStyle(parent).overflowY)) result = parent;
    }
    return result;
  };

  const visibleReadingTarget = () => {
    if (!node?.ownerDocument) return;
    const bounds = node.getBoundingClientRect();
    for (const y of [bounds.top + 12, bounds.top + 40, bounds.top + bounds.height / 2]) {
      for (const x of [bounds.left + bounds.width / 2, bounds.left + 96, bounds.left + bounds.width / 3]) {
        const hit = node.ownerDocument.elementFromPoint(x, y);
        const target = hit?.closest<HTMLElement>(
          '.flower-activity-inline-button, .flower-tool-sequence-toggle, .flower-turn-summary-button, [data-flower-message-id] p, [data-flower-message-id] pre, [data-flower-message-id] li, [data-parent-event], [data-flower-message-id]');
        if (target && node.contains(target) && target.getBoundingClientRect().height > 0) {
          // The clipped end of an unresolved skeleton is not reading content.
          // Anchor the next visible row so replacing that skeleton can grow
          // above the reader without pushing the following messages away.
          const message = target.closest<HTMLElement>('[data-flower-message-id]');
          if (message?.querySelector('.flower-history-text-loading') && message.getBoundingClientRect().top < bounds.top) {
            const following = [...node.querySelectorAll<HTMLElement>('[data-flower-message-id], [data-parent-event]')].find(row => {
              const rect = row.getBoundingClientRect();
              return rect.height > 0 && rect.top >= bounds.top && rect.top < bounds.bottom;
            });
            if (following) return outerReadingTarget(following);
          }
          return outerReadingTarget(target);
        }
      }
    }
  };
  const readingAnchor = (title: HTMLElement) => {
    const fallbacks: { title: HTMLElement; top: number }[] = [];
    // A group header can move to its canonical first item when history is
    // completed. Keep independent visible rows as well as ancestor shells.
    const bounds = node?.getBoundingClientRect();
    if (bounds && node?.ownerDocument) {
      for (const y of [bounds.top + 40, bounds.top + bounds.height / 2, bounds.bottom - 40]) {
        const hit = node.ownerDocument.elementFromPoint(bounds.left + bounds.width / 2, y);
        const row = hit?.closest<HTMLElement>('[data-flower-row-message-id], [data-parent-event]');
        if (row && node.contains(row) && !row.contains(title) && row.getBoundingClientRect().height > 0
          && !fallbacks.some(value => value.title === row)) fallbacks.push({ title: row, top: row.getBoundingClientRect().top });
      }
    }
    for (let parent = title.parentElement; parent && parent !== node; parent = parent.parentElement) {
      if (parent.matches('[data-flower-row-message-id], [data-flower-message-id], [data-parent-event], .flower-history-message')) {
        fallbacks.push({ title: parent, top: parent.getBoundingClientRect().top });
      }
    }
    return { title, top: title.getBoundingClientRect().top, activated: true, reading: true, fallbacks };
  };
  const restoreConnectedAnchor = () => {
    if (!anchor || !node) return false;
    if (anchor.title.isConnected && node.contains(anchor.title) && anchor.title.getBoundingClientRect().height !== 0) return true;
    const fallback = anchor.fallbacks?.find(value => value.title.isConnected && node!.contains(value.title) && value.title.getBoundingClientRect().height > 0);
    if (fallback) { anchor = { ...anchor, ...fallback }; return true; }
    clearAnchor();
    return false;
  };
  const captureReadingAnchor = () => {
    if (!node?.ownerDocument || followingLatest() || anchor && !anchor.reading) return;
    const title = visibleReadingTarget();
    if (title) anchor = readingAnchor(title);
  };
  const startFollowing = () => {
    clearCollapseOffset();
    clearAnchor();
    endUserScroll();
    cancelScheduledScroll();
    cancelSmoothScroll();
    immediateTail = true;
    setFollowingLatest(true);
    setNearBottom(isNearBottom());
  };
  const isNearBottom = (): boolean => {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= nearBottomThreshold;
  };
  const latestVisible = () => !followingLatest() && (!nearBottom() || !(options.canFollowLatest?.() ?? true));
  const cancelScheduledScroll = () => { pendingScroll = undefined; };
  const cancelSmoothScroll = () => {
    smoothScroll = undefined;
    growthScroll = undefined;
    growthScrollEvent = false;
  };
  const stopFollowing = () => {
    clearCollapseOffset();
    setFollowingLatest(false);
    userInterruptionRevision += 1;
    cancelScheduledScroll();
    cancelSmoothScroll();
    setNearBottom(isNearBottom());
  };
  const setScrollTop = (target: HTMLDivElement, scrollTop: number) => {
    target.scrollTop = scrollTop;
    knownScrollTop = target.scrollTop;
    // Our own position writes cannot count as user scrolling.
    if (userScroll) userScroll.top = target.scrollTop;
  };
  const setReadingTailSpace = (height: number) => {
    if (height === readingTailSpace) return;
    readingTailSpace = height;
    if (height) node?.style.setProperty('--flower-reading-tail-space', `${height}px`);
    else node?.style.removeProperty('--flower-reading-tail-space');
  };
  const advanceGrowth = (timestamp: number) => {
    const motion = growthScroll;
    if (!motion || !node) return;
    if (!followingLatest() || !(options.canFollowLatest?.() ?? true) || options.preparing?.()) {
      growthScroll = undefined;
      return;
    }
    // Keep fractional position independently of the browser's pixel rounding.
    // Retargeting never resets time or eases from rest. A line settles in about
    // 160 ms; large bursts catch up proportionally without overshoot or drift.
    const elapsed = Math.min(32, Math.max(0, timestamp - (motion.timestamp ?? timestamp)));
    motion.timestamp = timestamp;
    motion.position += (motion.bottom - motion.position) * (1 - Math.exp(-elapsed / 44));
    if (options.reducedMotionPreferred() || motion.bottom - motion.position <= 0.75) {
      motion.position = motion.bottom;
      growthScroll = undefined;
    }
    if (motion.position !== knownScrollTop) {
      // Deliver the last rounded-pixel event even if the fractional motion
      // settles on a later frame without another native scroll event.
      growthScrollEvent = Boolean(growthScroll && motion.bottom - motion.position > 1);
      setScrollTop(node, motion.position);
    }
    setNearBottom(motion.bottom - motion.position <= nearBottomThreshold);
    if (growthScroll) requestFrame();
  };
  const preserveReadingRange = (top: number) => {
    const content = node?.firstElementChild;
    if (!node || !content) return;
    // scrollHeight includes unused viewport space. Once older rows are
    // prepended, that space disappears and the browser clamps an otherwise
    // correct anchor offset. Keep only the trailing room needed at this
    // reading position; release it when it leaves view or new text fills it.
    const extent = content.getBoundingClientRect().bottom - node.getBoundingClientRect().top
      - node.clientTop + node.scrollTop + (parseFloat(getComputedStyle(node).paddingBottom) || 0);
    const needed = Math.max(0, Math.ceil(top + node.clientHeight - extent));
    setReadingTailSpace(anchor || collapseOffset !== undefined ? needed : Math.min(readingTailSpace, needed));
  };
  // Resize, tail-follow, smooth scrolling and disclosure anchoring share one
  // read/write pass. Notifications never cancel and restart the frame deadline.
  const layout = (timestamp: number, notify = true) => {
    layoutDirty = false;
    if (notify) layoutNotificationPending = false;
    const target = node;
    if (!target) return;
    if (options.preparing?.()) { clearCollapseOffset(); setReadingTailSpace(0); }
    if (gesture() && !gesture()!.target.isConnected) finishGesture();
    const nativeDelta = target.scrollTop - knownScrollTop;
    // Native wheel scrolling can update scrollTop before dispatching scroll.
    // Layout correction must follow that input, never undo it for one frame.
    if (userScroll && nativeDelta && anchor?.reading
      && (userScroll.direction === 0 || Math.sign(nativeDelta) === Math.sign(userScroll.direction))) {
      anchor.top -= nativeDelta;
      for (const fallback of anchor.fallbacks ?? []) fallback.top -= nativeDelta;
      knownScrollTop = target.scrollTop;
    }
    restoreConnectedAnchor();
    const scrollTop = target.scrollTop;
    let scrollHeight = target.scrollHeight;
    const viewportHeight = target.clientHeight;
    const anchorDelta = anchor ? anchor.title.getBoundingClientRect().top - anchor.top : 0;
    const request = pendingScroll;
    pendingScroll = undefined;
    if (options.preparing?.() || collapseOffset !== undefined || presentationHidden) cancelSmoothScroll();
    else if (request?.smooth && !options.reducedMotionPreferred()) {
      growthScroll = undefined;
      smoothScroll = { startedAt: timestamp, startTop: scrollTop };
    }
    let nextTop = collapseOffset ?? scrollTop + anchorDelta;
    if (!smoothScroll && (collapseOffset !== undefined || readingTailSpace || anchor && nextTop > Math.max(0, scrollHeight - viewportHeight))) {
      preserveReadingRange(nextTop);
      scrollHeight = target.scrollHeight;
      if (!readingTailSpace && !collapseMoving?.()) clearCollapseOffset();
    }
    if (collapseOffset === undefined && followingLatest() && (options.canFollowLatest?.() ?? true)) {
      const returningWithSpace = Boolean(smoothScroll && readingTailSpace);
      const bottom = Math.max(0, scrollHeight - (returningWithSpace ? readingTailSpace : 0) - viewportHeight);
      if (smoothScroll && !options.reducedMotionPreferred()) {
        const progress = Math.min(1, Math.max(0, (timestamp - smoothScroll.startedAt) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS));
        nextTop = smoothScroll.startTop + (bottom - smoothScroll.startTop) * (1 - (1 - progress) ** 3);
        if (progress >= 1) smoothScroll = undefined;
      } else {
        smoothScroll = undefined;
        const animateGrowth = options.smoothContentGrowth && !immediateTail && !presentationHidden && !options.preparing?.()
          && !options.reducedMotionPreferred() && viewportHeight === knownViewportHeight
          && scrollHeight >= knownScrollHeight && bottom > scrollTop
          && (growthScroll || scrollHeight > knownScrollHeight);
        if (animateGrowth) {
          if (growthScroll) growthScroll.bottom = bottom;
          else growthScroll = { bottom, position: scrollTop };
          nextTop = scrollTop;
        } else { growthScroll = undefined; nextTop = bottom; }
      }
      // Explicit return may animate through retained reading room. Release it
      // only at the destination, so removing it cannot clamp an animation.
      if (returningWithSpace && !smoothScroll) {
        setReadingTailSpace(0);
        scrollHeight = target.scrollHeight;
      }
    }
    if (nextTop !== scrollTop) setScrollTop(target, nextTop);
    knownScrollHeight = scrollHeight;
    knownViewportHeight = viewportHeight;
    immediateTail = presentationHidden;
    setNearBottom(scrollHeight - nextTop - viewportHeight <= nearBottomThreshold);
    if (notify) options.onLayout?.();
    // Reading anchors survive asynchronous Markdown, images and page decoration.
    // Only an active disclosure animation needs frame polling.
    if (anchor?.finished) { anchor.finished = false; anchor.reading = true; }
    if (gesture() || anchor && !anchor.reading || smoothScroll || growthScroll) requestFrame();
  };
  const requestFrame = () => {
    if (!layoutFrame && !presentationHidden) layoutFrame = options.requestAnimationFrame(timestamp => {
      layoutFrame = 0;
      if (layoutDirty || gesture() || anchor && !anchor.reading || smoothScroll) layout(timestamp);
      else if (layoutNotificationPending) {
        layoutNotificationPending = false;
        options.onLayout?.();
      }
      advanceGrowth(timestamp);
    });
  };
  const scheduleLayout = () => {
    layoutDirty = true;
    layoutNotificationPending = true;
    requestFrame();
  };
  const flushLayout = (notify = true) => {
    // Before-paint correction must not cancel the scheduled readiness and
    // history-demand notification owned by the normal layout pass.
    if (notify) layoutFrame = clearFrame(layoutFrame);
    layout(performance.now(), notify);
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
      setReadingTailSpace(0);
      knownScrollHeight = node.scrollHeight;
      knownViewportHeight = node.clientHeight;
      setScrollTop(node, Math.max(0, knownScrollHeight - knownViewportHeight));
      immediateTail = false;
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
    const notifyIntent = () => { if (direction) options.onScrollIntent?.(direction < 0 ? 'before' : 'after'); };
    // Input cannot leave the tail while all content fits in the viewport.
    if (followingLatest() && node.scrollHeight <= node.clientHeight) { notifyIntent(); return; }
    clearAnchor();
    stopFollowing();
    // At the oldest loaded edge, wheel input may not produce a scroll event.
    // Keep that visible position protected while its pending page arrives.
    captureReadingAnchor();
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
    if (direction > 0 && node.scrollHeight - node.clientHeight - node.scrollTop <= 1
      && (options.canFollowLatest?.() ?? true)) startFollowing();
    notifyIntent();
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
    title = outerReadingTarget(title);
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
    setGesture({ target, ...identity, latest, wasFollowing: followingLatest(), activated: false, scrolled: false, latestVisible: latestVisible() });
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
    const externalDelta = node.scrollTop - knownScrollTop;
    // Animation writes already know the geometry. Avoid remeasuring and asking
    // the host to scan history on each intermediate frame; the final event
    // still publishes the settled viewport through the normal reading path.
    if (growthScrollEvent && !externalDelta && !userScroll) {
      growthScrollEvent = false;
      return 'following' as const;
    }
    growthScrollEvent = false;
    knownScrollTop = node.scrollTop;
    let direction: 'before' | 'after' | undefined;
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
        // Empty reserved rows may have no hit-testable reading target. Move
        // the existing anchor with the native input before trying to replace it.
        if (anchor?.reading && externalDelta) {
          anchor.top -= externalDelta;
          for (const fallback of anchor.fallbacks ?? []) fallback.top -= externalDelta;
        }
        direction = delta < 0 ? 'before' : 'after';
        options.onScrollIntent?.(direction);
        const current = gesture();
        if (current) current.scrolled = true;
        if (delta < 0) stopFollowing();
        if (delta > 0 && input.direction >= 0 && (isNearBottom() || reachedPreviousBottom)
          && (options.canFollowLatest?.() ?? true)) {
          // Returning to the tail ends reading-anchor ownership. Otherwise
          // a stale anchor can manufacture trailing room during the next page.
          clearAnchor();
          clearCollapseOffset();
          setFollowingLatest(true);
          scheduleLayout();
        }
      }
    }
    if (direction && !followingLatest()) captureReadingAnchor();
    else if (!input && externalDelta && anchor?.reading
      && node.scrollHeight === knownScrollHeight && node.clientHeight === knownViewportHeight) {
      // Native focus/scrollIntoView and scrollbar movement can occur without a
      // wheel event. They establish a new reading position, unlike our writes.
      anchor.top -= externalDelta;
      for (const fallback of anchor.fallbacks ?? []) fallback.top -= externalDelta;
      captureReadingAnchor();
    }
    if (readingTailSpace || node.scrollHeight !== knownScrollHeight || node.clientHeight !== knownViewportHeight) scheduleLayout();
    // Scroll events report geometry; only a verified user scroll may resume.
    setNearBottom(isNearBottom());
    return direction;
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
    title = outerReadingTarget(title);
    if (anchor?.title !== title || !anchor.activated) return;
    anchor.finished = true;
    scheduleLayout();
  };
  const bind = (nextNode: HTMLDivElement | undefined) => {
    disconnect?.();
    finishGesture();
    clearAnchor();
    endUserScroll();
    setReadingTailSpace(0);
    clearCollapseOffset();
    cancelSmoothScroll();
    cancelScheduledScroll();
    layoutFrame = clearFrame(layoutFrame);
    layoutDirty = false;
    layoutNotificationPending = false;
    presentationHidden = false;
    immediateTail = true;
    node = nextNode;
    knownScrollTop = node?.scrollTop ?? 0;
    knownScrollHeight = node?.scrollHeight ?? 0;
    knownViewportHeight = node?.clientHeight ?? 0;
    setNearBottom(isNearBottom());
    if (!node?.ownerDocument) return;
    // Solid binds cloned template nodes before adoption into the live document.
    const document = globalThis.document;
    const window = document.defaultView!;
    presentationHidden = document.hidden;
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
    const onSelectionChange = () => {
      if (!options.smoothContentGrowth || !followingLatest()) return;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !node?.contains(selection.anchorNode) && !node?.contains(selection.focusNode)) return;
      stopFollowing();
      const current = gesture();
      if (current) current.scrolled = true;
      captureReadingAnchor();
      options.onUserInteraction?.();
    };
    const onVisibilityChange = () => {
      presentationHidden = document.hidden;
      if (document.hidden) {
        cancelSmoothScroll();
        cancelScheduledScroll();
        layoutFrame = clearFrame(layoutFrame);
        immediateTail = true;
      } else scheduleLayout();
    };
    const onScrollEnd = endUserScroll;
    document.addEventListener('pointerup', onRelease, true);
    document.addEventListener('pointercancel', onRelease, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    node.addEventListener('scrollend', onScrollEnd);
    // Historical rows may acquire real layout without a message mutation.
    // Capture their non-bubbling notification and reuse the same layout pass.
    node.addEventListener('contentvisibilityautostatechange', measureAfterLayout, true);
    // ResizeObserver runs after layout and before paint. Deferring this pass
    // to rAF would paint new content geometry with the previous scroll offset,
    // including skipped historical rows that become relevant above the tail.
    // Consume the queued pass without revealing/loading DOM inside this resize
    // delivery. Presentation mutations stay in rAF to avoid observer loops.
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      layoutFrame = clearFrame(layoutFrame);
      layout(performance.now(), false);
      if (options.onLayout) layoutNotificationPending = true;
      if (layoutNotificationPending) requestFrame();
    }) : undefined;
    const observeChildren = () => {
      if (!options.observeChildren || !resizeObserver || !node) return;
      resizeObserver.disconnect();
      resizeObserver.observe(node);
      for (const child of node.children) resizeObserver.observe(child);
    };
    const childrenObserver = options.observeChildren && typeof MutationObserver === 'function'
      ? new MutationObserver(() => { observeChildren(); flushLayout(false); scheduleLayout(); }) : undefined;
    childrenObserver?.observe(node, { childList: true });
    resizeObserver?.observe(node);
    const boundNode = node;
    let disconnected = false;
    // Solid invokes the viewport ref before inserting its transcript child.
    // Observe that child after synchronous mounting, so history publication
    // and hydration are corrected before paint even without viewport resize.
    queueMicrotask(() => {
      if (!disconnected) observeChildren();
      if (!disconnected && boundNode.firstElementChild) resizeObserver?.observe(boundNode.firstElementChild);
    });
    disconnect = () => {
      disconnected = true;
      document.removeEventListener('pointerup', onRelease, true);
      document.removeEventListener('pointercancel', onRelease, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      boundNode.removeEventListener('scrollend', onScrollEnd);
      boundNode.removeEventListener('contentvisibilityautostatechange', measureAfterLayout, true);
      resizeObserver?.disconnect();
      childrenObserver?.disconnect();
      disconnect = undefined;
    };
  };

  return {
    isPreparing: () => options.preparing?.() ?? false,
    registerDestination: prepare => {
      destinations.add(prepare);
      return () => { destinations.delete(prepare); };
    },
    prepareDestination: () => {
      let ready = true;
      for (const prepare of destinations) ready = prepare() && ready;
      return ready;
    },
    bind,
    nearBottom,
    followingLatest,
    viewport: () => node,
    preserveCollapseOffset: (moving) => {
      if (!node || !followingLatest() || options.preparing?.()) return;
      collapseOffset ??= node.scrollTop;
      // Incoming prose can briefly add room before the animated fold removes
      // it. Retain the same offset until its owner settles that motion.
      collapseMoving = moving;
      // Disclosure effects settle in this checkpoint. Correct the shrunken
      // range before rAF callbacks or the first exposed frame can observe it.
      if (!collapseFlushQueued) {
        collapseFlushQueued = true;
        queueMicrotask(() => {
          collapseFlushQueued = false;
          if (collapseOffset !== undefined) flushLayout(false);
        });
      }
      cancelSmoothScroll();
      cancelScheduledScroll();
      scheduleLayout();
    },
    preserveLayoutAnchor: (title) => {
      if (!node?.contains(title) || followingLatest()) return;
      // Preserve the earliest uncorrected screen position across concurrent
      // body, event and page completions; a later caller must not bless a jump.
      if (restoreConnectedAnchor()) return;
      const visible = visibleReadingTarget() ?? title;
      anchor = readingAnchor(visible);
      scheduleLayout();
    },
    restoreReadingAnchor: (title, screenTop) => {
      if (!node?.contains(title) || followingLatest()) return;
      anchor = { title, top: screenTop, activated: true, finished: true };
      flushLayout();
    },
    showLatest: () => gesture()?.latestVisible ?? latestVisible(),
    latestPointerBlocked: () => Boolean(gesture() && !gesture()!.latest),
    onPointerDown,
    onTouchMove,
    onKeyDown,
    activateDisclosure,
    finishDisclosure,
    releaseDisclosure: (title) => { if (anchor?.title === outerReadingTarget(title)) clearAnchor(); },
    userInterruptionRevision: () => userInterruptionRevision,
    startFollowing,
    stopFollowing,
    onScroll,
    onWheel,
    measureAfterLayout,
    flushLayout,
    prepareArrival: () => {
      if (!node || !followingLatest() || options.preparing?.() || !(options.canFollowLatest?.() ?? true) || options.reducedMotionPreferred()
        || node.scrollHeight - node.clientHeight - node.scrollTop <= 1) return 0;
      // A burst shares the current motion deadline. Ordinary layout notices
      // retarget its destination without turning it back into a one-frame jump.
      if (!smoothScroll && !pendingScroll?.smooth) scheduleTailScroll({ smooth: true });
      return FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS;
    },
    scheduleTailScroll,
    scrollToBottom,
    dispose: () => {
      clearCollapseOffset();
      disconnect?.();
      setGesture(undefined);
      clearAnchor();
      endUserScroll();
      setReadingTailSpace(0);
      releaseFrame = clearFrame(releaseFrame);
      layoutFrame = clearFrame(layoutFrame);
      cancelScheduledScroll();
      cancelSmoothScroll();
    },
  };
}
