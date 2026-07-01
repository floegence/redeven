import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

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
  const durationMs = Math.max(0, options.durationMs ?? 180);
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
