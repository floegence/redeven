import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js';

export const FLOWER_ACTIVITY_OPEN_DURATION_MS = 180;
export const FLOWER_ACTIVITY_CLOSE_DURATION_MS = 140;

export type FlowerActivityDisclosureController = Readonly<{
  open: Accessor<boolean>;
  toggle: () => void;
}>;

export type FlowerActivityDisclosureControllerOptions = Readonly<{
  manualOpen: Accessor<boolean | null | undefined>;
  needsAttention?: Accessor<boolean>;
  onManualOpenChange: (open: boolean) => void;
}>;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createFlowerActivityDisclosureController(
  options: FlowerActivityDisclosureControllerOptions,
): FlowerActivityDisclosureController {
  const open = createMemo(() => options.manualOpen() ?? options.needsAttention?.() ?? false);

  return {
    open,
    toggle: () => options.onManualOpenChange(!open()),
  };
}

export type FlowerActivityDisclosureState = 'closed' | 'opening' | 'open' | 'closing';

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
  now: () => number;
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
  height: Accessor<string>;
  bindViewport: (node: HTMLDivElement) => void;
  bindContent: (node: HTMLDivElement) => void;
}>;

export type FlowerActivityDisclosureMotionOptions = Readonly<{
  reducedMotion?: Accessor<boolean>;
  openDurationMs?: number;
  closeDurationMs?: number;
  onBeforeClose?: () => void;
  onLayoutFrame?: () => void;
  onMotionEnd?: () => void;
  platform?: FlowerActivityDisclosureMotionPlatform;
}>;

const OPEN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CLOSE_EASING = 'ease-in-out';
const CLOSED_TRANSFORM = 'translateY(-2px)';
const OPEN_TRANSFORM = 'translateY(0px)';

function browserMotionPlatform(): FlowerActivityDisclosureMotionPlatform {
  return {
    now: () => performance.now(),
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
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const openDurationMs = Math.max(0, options.openDurationMs ?? FLOWER_ACTIVITY_OPEN_DURATION_MS);
  const closeDurationMs = Math.max(0, options.closeDurationMs ?? FLOWER_ACTIVITY_CLOSE_DURATION_MS);
  const platform = options.platform ?? browserMotionPlatform();
  const [mounted, setMounted] = createSignal(false);
  const [state, setState] = createSignal<FlowerActivityDisclosureState>('closed');
  const [height, setHeight] = createSignal('0px');
  let viewport: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let disconnectResize: (() => void) | undefined;
  let measureFrame: number | undefined;
  let animation: FlowerActivityDisclosureAnimation | undefined;
  let openingDeadline = 0;
  let openingStart: FlowerActivityDisclosurePresentation | undefined;

  const stopMeasuring = () => {
    if (measureFrame !== undefined) platform.cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
    disconnectResize?.();
    disconnectResize = undefined;
  };
  const cancelAnimation = () => { animation?.cancel(); animation = undefined; };
  const presentation = () => viewport ? platform.readPresentation(viewport)
    : { height: 0, opacity: 0, transform: CLOSED_TRANSFORM };
  const finishOpen = () => {
    if (!open()) return;
    stopMeasuring();
    setHeight('auto');
    setState('open');
    options.onLayoutFrame?.();
    options.onMotionEnd?.();
  };
  const finishClose = () => {
    if (open()) return;
    setMounted(false);
    setState('closed');
    setHeight('0px');
    options.onLayoutFrame?.();
    options.onMotionEnd?.();
  };
  const animate = (start: FlowerActivityDisclosurePresentation, target: number, duration: number, closing: boolean) => {
    cancelAnimation();
    if (reducedMotion() || duration <= 0 || !viewport) {
      if (closing) finishClose(); else finishOpen();
      return;
    }
    const owner = platform.animate(viewport, [
      { height: `${start.height}px`, opacity: String(start.opacity), transform: start.transform },
      { height: `${target}px`, opacity: closing ? '0' : '1', transform: closing ? CLOSED_TRANSFORM : OPEN_TRANSFORM },
    ], { duration, easing: closing ? CLOSE_EASING : OPEN_EASING });
    animation = owner;
    setHeight(`${target}px`);
    options.onLayoutFrame?.();
    void owner.finished.then(() => {
      if (animation !== owner) return;
      animation = undefined;
      if (closing) finishClose(); else finishOpen();
    }, () => undefined);
  };
  const scheduleOpeningMeasure = () => {
    if (measureFrame !== undefined || state() !== 'opening') return;
    measureFrame = platform.requestAnimationFrame(() => {
      measureFrame = undefined;
      if (!open() || !content || state() !== 'opening') return;
      const nextHeight = Math.max(0, content.getBoundingClientRect().height);
      if (animation && Math.abs(nextHeight - Number.parseFloat(height())) <= 0.5) return;
      const start = openingStart ?? presentation();
      openingStart = undefined;
      // Retargeting consumes the remaining time of this interaction. Streaming
      // content cannot extend the deadline or animate a settled open panel.
      animate(start, nextHeight, Math.max(0, openingDeadline - platform.now()), false);
    });
  };
  const observeOpening = () => {
    disconnectResize?.();
    disconnectResize = content && state() === 'opening'
      ? platform.observeResize(content, scheduleOpeningMeasure) : undefined;
  };
  createEffect(on([open, reducedMotion], ([shouldOpen, reduced]) => {
    if (shouldOpen) {
      if (mounted() && state() === 'open') return;
      if (reduced) {
        cancelAnimation();
        setMounted(true);
        finishOpen();
        return;
      }
      openingStart = mounted() ? presentation() : { height: 0, opacity: 0, transform: CLOSED_TRANSFORM };
      cancelAnimation();
      stopMeasuring();
      openingDeadline = platform.now() + openDurationMs;
      setHeight(`${openingStart.height}px`);
      setMounted(true);
      setState('opening');
      observeOpening();
      scheduleOpeningMeasure();
    } else if (mounted()) {
      options.onBeforeClose?.();
      stopMeasuring();
      const start = presentation();
      setState('closing');
      animate(start, 0, reduced ? 0 : closeDurationMs, true);
    }
  }));
  onCleanup(() => { stopMeasuring(); cancelAnimation(); });
  return {
    mounted, state, height,
    bindViewport: (node) => { viewport = node; },
    bindContent: (node) => {
      content = node;
      observeOpening();
      scheduleOpeningMeasure();
    },
  };
}
