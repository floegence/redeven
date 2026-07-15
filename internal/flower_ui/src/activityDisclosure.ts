import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

export const FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS = 400;
export const FLOWER_ACTIVITY_SETTLE_HOLD_MS = 1200;
export const FLOWER_ACTIVITY_OPEN_DURATION_MS = 360;
export const FLOWER_ACTIVITY_RESIZE_DURATION_MS = 280;
export const FLOWER_ACTIVITY_CLOSE_DURATION_MS = 300;

export type FlowerActivityDisclosureIntent = 'settled' | 'active' | 'attention';

export type FlowerActivityDisclosureActivity = Readonly<{
  status?: string;
  severity?: string;
  needs_attention?: boolean;
  attention_reasons?: readonly string[];
}>;

export function flowerActivityDisclosureIntent(
  activity: FlowerActivityDisclosureActivity | null | undefined,
): FlowerActivityDisclosureIntent {
  const status = String(activity?.status ?? '').trim().toLowerCase();
  const severity = String(activity?.severity ?? '').trim().toLowerCase();
  const reasons = new Set((activity?.attention_reasons ?? []).map((reason) => String(reason).trim().toLowerCase()));
  if (
    status === 'error'
    || status === 'waiting'
    || severity === 'error'
    || severity === 'blocking'
    || reasons.has('error')
    || reasons.has('waiting')
    || reasons.has('approval')
  ) {
    return 'attention';
  }
  if (status === 'pending' || status === 'running') return 'active';
  if (activity?.needs_attention === true) return 'attention';
  return 'settled';
}

export type FlowerActivityDisclosureController = Readonly<{
  open: Accessor<boolean>;
  toggle: () => void;
  retainOpen: () => void;
}>;

export type FlowerActivityDisclosureControllerOptions = Readonly<{
  intent: Accessor<FlowerActivityDisclosureIntent>;
  manualOpen: Accessor<boolean | null | undefined>;
  onManualOpenChange: (open: boolean) => void;
  reducedMotion?: Accessor<boolean>;
  openDelayMs?: number;
  settleHoldMs?: number;
}>;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createFlowerActivityDisclosureController(
  options: FlowerActivityDisclosureControllerOptions,
): FlowerActivityDisclosureController {
  const openDelayMs = Math.max(0, options.openDelayMs ?? FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);
  const settleHoldMs = Math.max(0, options.settleHoldMs ?? FLOWER_ACTIVITY_SETTLE_HOLD_MS);
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const initialIntent = options.intent();
  const [automaticOpen, setAutomaticOpen] = createSignal(initialIntent === 'attention');
  let attentionLatched = initialIntent === 'attention';
  let openTimer: number | undefined;
  let settleTimer: number | undefined;

  const clearOpenTimer = () => {
    if (openTimer === undefined) return;
    window.clearTimeout(openTimer);
    openTimer = undefined;
  };
  const clearSettleTimer = () => {
    if (settleTimer === undefined) return;
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
  };
  const clearScheduled = () => {
    clearOpenTimer();
    clearSettleTimer();
  };

  createEffect(() => {
    const intent = options.intent();
    const manualOpen = options.manualOpen();
    const motionReduced = reducedMotion();
    clearScheduled();

    if (typeof manualOpen === 'boolean') return;
    if (intent === 'attention') {
      attentionLatched = true;
      setAutomaticOpen(true);
      return;
    }
    if (intent === 'active') {
      if (attentionLatched || automaticOpen()) return;
      if (motionReduced) {
        setAutomaticOpen(false);
        return;
      }
      openTimer = window.setTimeout(() => {
        openTimer = undefined;
        if (
          options.intent() === 'active'
          && typeof options.manualOpen() !== 'boolean'
          && !reducedMotion()
        ) {
          setAutomaticOpen(true);
        }
      }, openDelayMs);
      return;
    }
    if (attentionLatched || !automaticOpen()) return;
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      if (options.intent() === 'settled' && typeof options.manualOpen() !== 'boolean') {
        setAutomaticOpen(false);
      }
    }, settleHoldMs);
  });

  onCleanup(clearScheduled);

  const open = createMemo(() => {
    const manualOpen = options.manualOpen();
    return typeof manualOpen === 'boolean' ? manualOpen : automaticOpen();
  });
  const retainOpen = () => {
    if (open()) options.onManualOpenChange(true);
  };

  return {
    open,
    toggle: () => options.onManualOpenChange(!open()),
    retainOpen,
  };
}

export type FlowerActivityDisclosureState = 'closed' | 'opening' | 'open' | 'closing';

export type FlowerActivityDisclosureLayoutMotion = 'idle' | 'resizing';

export type FlowerActivityDisclosureMotion = Readonly<{
  mounted: Accessor<boolean>;
  state: Accessor<FlowerActivityDisclosureState>;
  layoutMotion: Accessor<FlowerActivityDisclosureLayoutMotion>;
  height: Accessor<string>;
  bindViewport: (node: HTMLDivElement) => void;
  bindContent: (node: HTMLDivElement) => void;
  onTransitionEnd: (event: TransitionEvent) => void;
}>;

export type FlowerActivityDisclosureMotionOptions = Readonly<{
  animateContentResize?: boolean;
  reducedMotion?: Accessor<boolean>;
  openDurationMs?: number;
  resizeDurationMs?: number;
  closeDurationMs?: number;
  onBeforeClose?: () => void;
  onLayoutFrame?: () => void;
}>;

function disclosureNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function createFlowerActivityDisclosureMotion(
  open: Accessor<boolean>,
  options: FlowerActivityDisclosureMotionOptions = {},
): FlowerActivityDisclosureMotion {
  const animateContentResize = options.animateContentResize === true;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const openDurationMs = Math.max(0, options.openDurationMs ?? FLOWER_ACTIVITY_OPEN_DURATION_MS);
  const resizeDurationMs = Math.max(0, options.resizeDurationMs ?? FLOWER_ACTIVITY_RESIZE_DURATION_MS);
  const closeDurationMs = Math.max(0, options.closeDurationMs ?? FLOWER_ACTIVITY_CLOSE_DURATION_MS);
  const [mounted, setMounted] = createSignal(false);
  const [state, setState] = createSignal<FlowerActivityDisclosureState>('closed');
  const [layoutMotion, setLayoutMotion] = createSignal<FlowerActivityDisclosureLayoutMotion>('idle');
  const [height, setHeight] = createSignal('0px');
  let viewport: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let measureFrame: number | undefined;
  let transitionFrame: number | undefined;
  let layoutFrame: number | undefined;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let layoutEndsAt = 0;

  const clearFrame = (value: number | undefined): undefined => {
    if (value !== undefined) {
      window.cancelAnimationFrame(value);
    }
    return undefined;
  };
  const clearTimer = (value: number | undefined): undefined => {
    if (value !== undefined) {
      window.clearTimeout(value);
    }
    return undefined;
  };
  const stopLayoutFrames = () => {
    layoutFrame = clearFrame(layoutFrame);
    layoutEndsAt = 0;
    setLayoutMotion('idle');
  };
  const clearScheduled = () => {
    measureFrame = clearFrame(measureFrame);
    transitionFrame = clearFrame(transitionFrame);
    openTimer = clearTimer(openTimer);
    closeTimer = clearTimer(closeTimer);
  };

  const notifyLayoutUntil = (durationMs: number) => {
    options.onLayoutFrame?.();
    if (durationMs <= 0) {
      stopLayoutFrames();
      return;
    }
    layoutEndsAt = Math.max(layoutEndsAt, disclosureNow() + durationMs);
    setLayoutMotion('resizing');
    if (layoutFrame !== undefined) return;
    const tick = (timestamp: number) => {
      layoutFrame = undefined;
      options.onLayoutFrame?.();
      if (timestamp < layoutEndsAt) {
        layoutFrame = window.requestAnimationFrame(tick);
        return;
      }
      layoutEndsAt = 0;
      setLayoutMotion('idle');
    };
    layoutFrame = window.requestAnimationFrame(tick);
  };

  const measuredContentHeight = (): number => {
    if (!content) return 0;
    const rectHeight = content.getBoundingClientRect().height;
    if (rectHeight > 0) return rectHeight;
    if (content.offsetHeight > 0) return content.offsetHeight;
    return Math.max(0, content.scrollHeight);
  };

  const measuredViewportHeight = (): number => {
    if (!viewport) return measuredContentHeight();
    const rectHeight = viewport.getBoundingClientRect().height;
    if (rectHeight > 0) return rectHeight;
    const parsedHeight = Number.parseFloat(height());
    return Number.isFinite(parsedHeight) ? Math.max(0, parsedHeight) : measuredContentHeight();
  };

  const observerAvailable = (): boolean => typeof ResizeObserver !== 'undefined';
  const instant = (): boolean => reducedMotion();
  const shouldHoldMeasuredHeight = (): boolean => animateContentResize && observerAvailable() && !instant();

  const finishOpen = () => {
    if (!open() || !mounted()) return;
    openTimer = clearTimer(openTimer);
    setState('open');
    if (!shouldHoldMeasuredHeight()) {
      setHeight('auto');
    }
    options.onLayoutFrame?.();
  };
  const finishClose = () => {
    if (open()) return;
    closeTimer = clearTimer(closeTimer);
    stopLayoutFrames();
    setMounted(false);
    setState('closed');
    setHeight('0px');
  };

  const scheduleMeasuredHeight = (durationMs: number) => {
    measureFrame = clearFrame(measureFrame);
    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = undefined;
      if (!open() || !mounted() || state() === 'closing') return;
      const nextHeight = measuredContentHeight();
      if (instant()) {
        setHeight(shouldHoldMeasuredHeight() ? `${nextHeight}px` : 'auto');
        setState('open');
        options.onLayoutFrame?.();
        return;
      }
      const currentHeight = measuredViewportHeight();
      if (Math.abs(currentHeight - nextHeight) < 0.5 && height() !== '0px' && height() !== 'auto') return;
      setHeight(`${nextHeight}px`);
      notifyLayoutUntil(durationMs);
      if (state() === 'opening') {
        openTimer = clearTimer(openTimer);
        openTimer = window.setTimeout(finishOpen, durationMs + 80);
      }
    });
  };

  const beginOpen = () => {
    clearScheduled();
    stopLayoutFrames();
    const wasMounted = mounted();
    const currentHeight = wasMounted ? measuredViewportHeight() : 0;
    setMounted(true);
    if (instant()) {
      setState('open');
      setHeight('auto');
      options.onLayoutFrame?.();
      return;
    }
    setHeight(`${currentHeight}px`);
    setState('opening');
    transitionFrame = window.requestAnimationFrame(() => {
      transitionFrame = undefined;
      scheduleMeasuredHeight(openDurationMs);
    });
  };

  const beginClose = () => {
    clearScheduled();
    options.onBeforeClose?.();
    if (!mounted()) {
      finishClose();
      return;
    }
    if (instant()) {
      finishClose();
      return;
    }
    const currentHeight = measuredViewportHeight();
    setHeight(`${currentHeight}px`);
    setState('closing');
    notifyLayoutUntil(closeDurationMs);
    transitionFrame = window.requestAnimationFrame(() => {
      transitionFrame = undefined;
      if (!open()) setHeight('0px');
    });
    closeTimer = window.setTimeout(finishClose, closeDurationMs + 80);
  };

  createEffect(() => {
    const shouldOpen = open();
    reducedMotion();
    if (shouldOpen) {
      if (!mounted() || state() === 'closing') {
        beginOpen();
        return;
      }
      if (instant()) {
        clearScheduled();
        stopLayoutFrames();
        setState('open');
        setHeight('auto');
      } else if (animateContentResize && height() === 'auto') {
        scheduleMeasuredHeight(0);
      }
      return;
    }
    if (mounted() || state() !== 'closed') {
      beginClose();
    }
  });

  const bindContent = (node: HTMLDivElement) => {
    resizeObserver?.disconnect();
    content = node;
    if (!observerAvailable()) return;
    resizeObserver = new ResizeObserver(() => {
      if (!open() || !mounted() || state() === 'closing') return;
      if (state() === 'opening') {
        scheduleMeasuredHeight(openDurationMs);
        return;
      }
      if (animateContentResize) {
        scheduleMeasuredHeight(resizeDurationMs);
      }
    });
    resizeObserver.observe(node);
  };

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== viewport || event.propertyName !== 'height') return;
    if (state() === 'closing') {
      finishClose();
      return;
    }
    if (state() === 'opening') {
      finishOpen();
      return;
    }
    if (state() === 'open') {
      stopLayoutFrames();
    }
  };

  onCleanup(() => {
    clearScheduled();
    stopLayoutFrames();
    resizeObserver?.disconnect();
  });

  return {
    mounted,
    state,
    layoutMotion,
    height,
    bindViewport: (node) => {
      viewport = node;
    },
    bindContent,
    onTransitionEnd,
  };
}
