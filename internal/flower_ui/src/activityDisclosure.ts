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

export type FlowerActivityDisclosureSettlePolicy =
  | Readonly<{ anchor: 'intent'; holdMs?: number }>
  | Readonly<{ anchor: 'presentation'; holdMs?: number }>;

export type FlowerActivityDisclosureController = Readonly<{
  open: Accessor<boolean>;
  toggle: () => void;
  retainOpen: () => void;
  markSettledPresentation: () => void;
}>;

export type FlowerActivityDisclosureControllerOptions = Readonly<{
  intent: Accessor<FlowerActivityDisclosureIntent>;
  manualOpen: Accessor<boolean | null | undefined>;
  onManualOpenChange: (open: boolean) => void;
  reducedMotion?: Accessor<boolean>;
  openDelayMs?: number;
  settle?: FlowerActivityDisclosureSettlePolicy;
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
  const settlePolicy = options.settle ?? { anchor: 'intent' as const };
  const settleHoldMs = Math.max(0, settlePolicy.holdMs ?? FLOWER_ACTIVITY_SETTLE_HOLD_MS);
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const initialIntent = options.intent();
  const [automaticOpen, setAutomaticOpen] = createSignal(initialIntent === 'attention');
  const [settledPresentationRevision, setSettledPresentationRevision] = createSignal(0);
  let presentationBaseline = 0;
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
  const scheduleSettle = () => {
    clearSettleTimer();
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      if (options.intent() === 'settled' && typeof options.manualOpen() !== 'boolean') {
        setAutomaticOpen(false);
      }
    }, settleHoldMs);
  };

  createEffect(() => {
    const intent = options.intent();
    const manualOpen = options.manualOpen();
    const motionReduced = reducedMotion();
    const presentationRevision = settledPresentationRevision();
    clearOpenTimer();

    if (typeof manualOpen === 'boolean') {
      clearSettleTimer();
      return;
    }
    if (intent === 'attention') {
      clearSettleTimer();
      attentionLatched = true;
      setAutomaticOpen(true);
      return;
    }
    if (intent === 'active') {
      clearSettleTimer();
      presentationBaseline = presentationRevision;
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
    if (attentionLatched || !automaticOpen()) {
      clearSettleTimer();
      return;
    }
    if (settlePolicy.anchor === 'presentation' && presentationRevision <= presentationBaseline) {
      clearSettleTimer();
      return;
    }
    scheduleSettle();
  });

  onCleanup(() => {
    clearOpenTimer();
    clearSettleTimer();
  });

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
    markSettledPresentation: () => {
      if (settlePolicy.anchor === 'presentation') {
        setSettledPresentationRevision((revision) => revision + 1);
      }
    },
  };
}

export type FlowerActivityDisclosureState = 'closed' | 'opening' | 'open' | 'closing';

export type FlowerActivityDisclosureLayoutMotion = 'idle' | 'resizing';

export type FlowerActivityDisclosureAnimation = Readonly<{
  finished: Promise<unknown>;
  playState: AnimationPlayState;
  cancel: () => void;
}>;

export type FlowerActivityDisclosurePresentation = Readonly<{
  height: number;
  opacity: number;
  transform: string;
}>;

export type FlowerActivityDisclosureMotionPlatform = Readonly<{
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  observeResize: (node: Element, callback: () => void) => () => void;
  readPresentation: (node: HTMLElement) => FlowerActivityDisclosurePresentation;
  animate: (
    node: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => FlowerActivityDisclosureAnimation;
}>;

export type FlowerActivityDisclosureMotion = Readonly<{
  mounted: Accessor<boolean>;
  state: Accessor<FlowerActivityDisclosureState>;
  layoutMotion: Accessor<FlowerActivityDisclosureLayoutMotion>;
  height: Accessor<string>;
  bindViewport: (node: HTMLDivElement) => void;
  bindContent: (node: HTMLDivElement) => void;
}>;

export type FlowerActivityDisclosureMotionOptions = Readonly<{
  animateContentResize?: boolean;
  reducedMotion?: Accessor<boolean>;
  openDurationMs?: number;
  resizeDurationMs?: number;
  closeDurationMs?: number;
  onBeforeClose?: () => void;
  onLayoutFrame?: () => void;
  platform?: FlowerActivityDisclosureMotionPlatform;
}>;

const OPEN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CLOSE_EASING = 'ease-in-out';
const CLOSED_TRANSFORM = 'translateY(-2px)';
const OPEN_TRANSFORM = 'translateY(0px)';

function browserMotionPlatform(): FlowerActivityDisclosureMotionPlatform {
  return {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    observeResize: (node, callback) => {
      const observer = new ResizeObserver(callback);
      observer.observe(node);
      return () => observer.disconnect();
    },
    readPresentation: (node) => {
      const style = window.getComputedStyle(node);
      return {
        height: Math.max(0, node.getBoundingClientRect().height),
        opacity: Number.parseFloat(style.opacity) || 0,
        transform: style.transform === 'none' ? OPEN_TRANSFORM : style.transform,
      };
    },
    animate: (node, keyframes, animationOptions) => node.animate(keyframes, animationOptions),
  };
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
  const platform = options.platform ?? browserMotionPlatform();
  const [mounted, setMounted] = createSignal(false);
  const [state, setState] = createSignal<FlowerActivityDisclosureState>('closed');
  const [layoutMotion, setLayoutMotion] = createSignal<FlowerActivityDisclosureLayoutMotion>('idle');
  const [height, setHeight] = createSignal('0px');
  let viewport: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let disconnectResize: (() => void) | undefined;
  let measureFrame: number | undefined;
  let layoutFrame: number | undefined;
  let animation: FlowerActivityDisclosureAnimation | undefined;
  let animationRevision = 0;

  const clearFrame = (handle: number | undefined): undefined => {
    if (handle !== undefined) platform.cancelAnimationFrame(handle);
    return undefined;
  };
  const stopLayoutFrames = () => {
    layoutFrame = clearFrame(layoutFrame);
    setLayoutMotion('idle');
  };
  const cancelAnimation = () => {
    animationRevision += 1;
    animation?.cancel();
    animation = undefined;
    stopLayoutFrames();
  };
  const currentPresentation = (): FlowerActivityDisclosurePresentation => (
    viewport
      ? platform.readPresentation(viewport)
      : { height: 0, opacity: 0, transform: CLOSED_TRANSFORM }
  );
  const measuredContentHeight = (): number => (
    content ? Math.max(0, content.getBoundingClientRect().height) : 0
  );
  const notifyLayoutWhile = (owner: FlowerActivityDisclosureAnimation) => {
    options.onLayoutFrame?.();
    setLayoutMotion('resizing');
    const tick = () => {
      layoutFrame = undefined;
      options.onLayoutFrame?.();
      if (animation === owner && owner.playState === 'running') {
        layoutFrame = platform.requestAnimationFrame(tick);
      }
    };
    layoutFrame = platform.requestAnimationFrame(tick);
  };
  const commitHeight = (nextHeight: number) => {
    setHeight(`${Math.max(0, nextHeight)}px`);
    options.onLayoutFrame?.();
  };
  const runAnimation = (
    targetState: FlowerActivityDisclosureState,
    targetHeight: number,
    durationMs: number,
    easing: string,
    onFinish: () => void,
    initialPresentation?: FlowerActivityDisclosurePresentation,
  ) => {
    const start = initialPresentation ?? currentPresentation();
    cancelAnimation();
    const revision = animationRevision;
    const targetOpen = targetState !== 'closing' && targetState !== 'closed';
    setState(targetState);
    commitHeight(targetHeight);
    if (reducedMotion() || durationMs === 0 || !viewport) {
      onFinish();
      return;
    }
    const nextAnimation = platform.animate(
      viewport,
      [
        {
          height: `${start.height}px`,
          opacity: String(start.opacity),
          transform: start.transform,
        },
        {
          height: `${Math.max(0, targetHeight)}px`,
          opacity: targetOpen ? '1' : '0',
          transform: targetOpen ? OPEN_TRANSFORM : CLOSED_TRANSFORM,
        },
      ],
      { duration: durationMs, easing },
    );
    animation = nextAnimation;
    notifyLayoutWhile(nextAnimation);
    void nextAnimation.finished.then(
      () => {
        if (animation !== nextAnimation || animationRevision !== revision) return;
        animation = undefined;
        stopLayoutFrames();
        onFinish();
      },
      () => undefined,
    );
  };
  const finishOpen = () => {
    if (!open() || !mounted()) return;
    setState('open');
    setLayoutMotion('idle');
    options.onLayoutFrame?.();
  };
  const finishClose = () => {
    if (open()) return;
    stopLayoutFrames();
    setMounted(false);
    setState('closed');
    setHeight('0px');
  };
  const syncMeasuredHeight = () => {
    if (!open() || !mounted() || !content) return;
    cancelAnimation();
    commitHeight(measuredContentHeight());
    setState('open');
  };
  const scheduleMeasuredHeight = (durationMs: number) => {
    measureFrame = clearFrame(measureFrame);
    measureFrame = platform.requestAnimationFrame(() => {
      measureFrame = undefined;
      if (!open() || !mounted() || state() === 'closing' || !content) return;
      const nextHeight = measuredContentHeight();
      if (reducedMotion() || (!animateContentResize && state() === 'open')) {
        syncMeasuredHeight();
        return;
      }
      const targetState = state() === 'opening' ? 'opening' : 'open';
      const duration = targetState === 'opening' ? openDurationMs : durationMs;
      runAnimation(targetState, nextHeight, duration, OPEN_EASING, finishOpen);
    });
  };
  const beginOpen = () => {
    const wasMounted = mounted();
    const start = wasMounted
      ? currentPresentation()
      : { height: 0, opacity: 0, transform: CLOSED_TRANSFORM };
    cancelAnimation();
    measureFrame = clearFrame(measureFrame);
    if (wasMounted) setHeight(`${start.height}px`);
    setMounted(true);
    setState(reducedMotion() ? 'open' : 'opening');
    if (content && reducedMotion()) {
      syncMeasuredHeight();
      return;
    }
    measureFrame = platform.requestAnimationFrame(() => {
      measureFrame = undefined;
      if (!open() || !mounted() || !content) return;
      const nextHeight = measuredContentHeight();
      if (reducedMotion()) {
        commitHeight(nextHeight);
        finishOpen();
        return;
      }
      runAnimation('opening', nextHeight, openDurationMs, OPEN_EASING, finishOpen, start);
    });
  };
  const beginClose = () => {
    options.onBeforeClose?.();
    measureFrame = clearFrame(measureFrame);
    if (!mounted()) {
      finishClose();
      return;
    }
    if (reducedMotion()) {
      cancelAnimation();
      finishClose();
      return;
    }
    const start = currentPresentation();
    setHeight(`${start.height}px`);
    runAnimation('closing', 0, closeDurationMs, CLOSE_EASING, finishClose, start);
  };

  createEffect(() => {
    const shouldOpen = open();
    const motionReduced = reducedMotion();
    if (shouldOpen) {
      if (!mounted() || state() === 'closing') {
        beginOpen();
        return;
      }
      if (motionReduced) syncMeasuredHeight();
      return;
    }
    if (mounted() || state() !== 'closed') beginClose();
  });

  const bindContent = (node: HTMLDivElement) => {
    disconnectResize?.();
    content = node;
    disconnectResize = platform.observeResize(node, () => {
      if (!open() || !mounted() || state() === 'closing') return;
      if (state() === 'opening') {
        scheduleMeasuredHeight(openDurationMs);
        return;
      }
      if (animateContentResize) {
        scheduleMeasuredHeight(resizeDurationMs);
      } else {
        syncMeasuredHeight();
      }
    });
    if (open() && mounted()) {
      if (reducedMotion()) syncMeasuredHeight();
      else scheduleMeasuredHeight(state() === 'opening' ? openDurationMs : resizeDurationMs);
    }
  };

  onCleanup(() => {
    measureFrame = clearFrame(measureFrame);
    cancelAnimation();
    disconnectResize?.();
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
  };
}
