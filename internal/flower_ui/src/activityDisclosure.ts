import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

export const FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS = 300;
export const FLOWER_ACTIVITY_SETTLE_HOLD_MS = 1000;
export const FLOWER_ACTIVITY_DISCLOSURE_DURATION_MS = 220;

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

export type FlowerActivityDisclosurePresence = Readonly<{
  mounted: Accessor<boolean>;
  state: Accessor<FlowerActivityDisclosureState>;
}>;

export type FlowerActivityDisclosureOptions = Readonly<{
  durationMs?: number;
  onBeforeClose?: () => void;
}>;

export function createFlowerActivityDisclosurePresence(
  open: Accessor<boolean>,
  options: FlowerActivityDisclosureOptions = {},
): FlowerActivityDisclosurePresence {
  const durationMs = Math.max(0, options.durationMs ?? FLOWER_ACTIVITY_DISCLOSURE_DURATION_MS);
  const [mounted, setMounted] = createSignal(open());
  const [state, setState] = createSignal<FlowerActivityDisclosureState>(open() ? 'open' : 'closed');
  let timer: number | undefined;
  let frame: number | undefined;

  const clearScheduled = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  createEffect(() => {
    const shouldOpen = open();
    clearScheduled();
    if (shouldOpen) {
      setMounted(true);
      setState('opening');
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (open()) setState('open');
      });
      return;
    }
    if (!mounted()) {
      setState('closed');
      return;
    }
    options.onBeforeClose?.();
    if (durationMs <= 0) {
      setMounted(false);
      setState('closed');
      return;
    }
    setState('closing');
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!open()) {
        setMounted(false);
        setState('closed');
      }
    }, durationMs);
  });

  onCleanup(clearScheduled);

  return { mounted, state };
}
