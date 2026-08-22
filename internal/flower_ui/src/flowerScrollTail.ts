import { createSignal, type Accessor } from 'solid-js';

export const FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 96;
export const FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS = 220;

export type FlowerScrollTailController = Readonly<{
  bind: (node: HTMLDivElement | undefined) => void;
  nearBottom: Accessor<boolean>;
  userInterruptionRevision: () => number;
  startFollowing: () => void;
  stopFollowing: () => void;
  markNearBottom: () => void;
  captureWasNearBottom: () => boolean;
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
  setNearBottomValue?: (nearBottom: boolean) => void;
}>;

export function createFlowerScrollTailController(
  options: FlowerScrollTailControllerOptions,
): FlowerScrollTailController {
  const [nearBottom, setNearBottom] = createSignal(true);
  let node: HTMLDivElement | undefined;
  let measureFrame = 0;
  let scrollFrame = 0;
  let smoothScrollFrame = 0;
  let scrollToBottomInProgress = false;
  let followingLatest = true;
  let userInterruptionRevision = 0;

  const setValue = (value: boolean) => {
    setNearBottom(value);
    options.setNearBottomValue?.(value);
  };
  const startFollowing = () => {
    followingLatest = true;
    setValue(true);
  };
  const isNearBottom = (): boolean => {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= FLOWER_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX;
  };
  const cancelScheduledScroll = () => {
    if (scrollFrame) {
      options.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
  };
  const cancelSmoothScroll = () => {
    if (smoothScrollFrame) {
      options.cancelAnimationFrame(smoothScrollFrame);
      smoothScrollFrame = 0;
    }
    scrollToBottomInProgress = false;
  };
  const stopFollowing = () => {
    followingLatest = false;
    userInterruptionRevision += 1;
    cancelScheduledScroll();
    cancelSmoothScroll();
    setValue(isNearBottom());
  };
  const setScrollTop = (target: HTMLDivElement, scrollTop: number) => {
    target.scrollTop = scrollTop;
  };
  const scrollToBottom = (scrollOptions: Readonly<{ smooth?: boolean }> = {}) => {
    const target = node;
    if (!target) return;
    followingLatest = true;
    const targetScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    cancelSmoothScroll();
    if (!scrollOptions.smooth || options.reducedMotionPreferred() || typeof performance === 'undefined') {
      scrollToBottomInProgress = false;
      setScrollTop(target, targetScrollTop);
      setValue(true);
      return;
    }
    const startScrollTop = target.scrollTop;
    const delta = targetScrollTop - startScrollTop;
    if (Math.abs(delta) <= 1) {
      setScrollTop(target, targetScrollTop);
      setValue(true);
      return;
    }
    const startedAt = performance.now();
    const step = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS);
      const eased = 1 - ((1 - progress) ** 3);
      if (!followingLatest) {
        cancelSmoothScroll();
        setValue(isNearBottom());
        return;
      }
      setScrollTop(target, startScrollTop + (delta * eased));
      if (progress < 1) {
        smoothScrollFrame = options.requestAnimationFrame(step);
        return;
      }
      smoothScrollFrame = 0;
      scrollToBottomInProgress = false;
      setScrollTop(target, targetScrollTop);
      setValue(true);
    };
    scrollToBottomInProgress = true;
    smoothScrollFrame = options.requestAnimationFrame(step);
    setValue(true);
  };
  const scheduleTailScroll = (scrollOptions: Readonly<{ smooth?: boolean; force?: boolean }> = {}) => {
    const force = scrollOptions.force === true;
    if ((!force && !followingLatest) || scrollFrame) return;
    if (force) {
      followingLatest = true;
      setValue(true);
    }
    scrollFrame = options.requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!force && !followingLatest) return;
      scrollToBottom(scrollOptions);
    });
  };
  const measureAfterLayout = () => {
    if (measureFrame) {
      options.cancelAnimationFrame(measureFrame);
    }
    measureFrame = options.requestAnimationFrame(() => {
      measureFrame = 0;
      if (scrollToBottomInProgress) {
        setValue(true);
        return;
      }
      if (followingLatest) {
        // Content growth can move the viewport beyond the near-bottom threshold
        // before the queued scroll runs. Follow intent, not the new distance.
        setValue(true);
        scheduleTailScroll();
        return;
      }
      setValue(isNearBottom());
    });
  };

  return {
    bind: (nextNode) => {
      node = nextNode;
      setValue(isNearBottom());
    },
    nearBottom,
    userInterruptionRevision: () => userInterruptionRevision,
    startFollowing,
    stopFollowing,
    markNearBottom: startFollowing,
    captureWasNearBottom: () => {
      const value = isNearBottom();
      followingLatest = value;
      setValue(value);
      return value;
    },
    onScroll: () => {
      if (scrollToBottomInProgress) {
        setValue(true);
        return;
      }
      const value = isNearBottom();
      if (!value && followingLatest) {
        stopFollowing();
        return;
      }
      followingLatest = value;
      setValue(value);
    },
    onWheel: (event) => {
      if (event.deltaY < 0) {
        stopFollowing();
      }
    },
    measureAfterLayout,
    scheduleTailScroll,
    scrollToBottom,
    dispose: () => {
      if (measureFrame) {
        options.cancelAnimationFrame(measureFrame);
        measureFrame = 0;
      }
      if (scrollFrame) {
        cancelScheduledScroll();
      }
      cancelSmoothScroll();
    },
  };
}
