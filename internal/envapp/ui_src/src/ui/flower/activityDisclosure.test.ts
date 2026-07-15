// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFlowerActivityDisclosureController,
  createFlowerActivityDisclosureMotion,
  FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS,
  FLOWER_ACTIVITY_CLOSE_DURATION_MS,
  FLOWER_ACTIVITY_OPEN_DURATION_MS,
  FLOWER_ACTIVITY_RESIZE_DURATION_MS,
  FLOWER_ACTIVITY_SETTLE_HOLD_MS,
  flowerActivityDisclosureIntent,
  type FlowerActivityDisclosureController,
  type FlowerActivityDisclosureIntent,
  type FlowerActivityDisclosureMotion,
} from '../../../../../flower_ui/src/activityDisclosure';

type ControllerHarness = Readonly<{
  control: FlowerActivityDisclosureController;
  dispose: () => void;
  setIntent: (intent: FlowerActivityDisclosureIntent) => void;
  setManualOpen: (open: boolean | undefined) => void;
}>;

function createControllerHarness(
  initialIntent: FlowerActivityDisclosureIntent,
  reducedMotion = false,
): ControllerHarness {
  const [intent, setIntent] = createSignal(initialIntent);
  const [manualOpen, setManualOpen] = createSignal<boolean | undefined>(undefined);
  let dispose: () => void = () => undefined;
  let control!: FlowerActivityDisclosureController;
  createRoot((rootDispose) => {
    dispose = rootDispose;
    control = createFlowerActivityDisclosureController({
      intent,
      manualOpen,
      onManualOpenChange: setManualOpen,
      reducedMotion: () => reducedMotion,
    });
  });
  return { control, dispose, setIntent, setManualOpen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('flowerActivityDisclosureIntent', () => {
  it('separates routine active work from actionable attention states', () => {
    expect(flowerActivityDisclosureIntent({ status: 'pending', needs_attention: true })).toBe('active');
    expect(flowerActivityDisclosureIntent({ status: 'running', attention_reasons: ['running'] })).toBe('active');
    expect(flowerActivityDisclosureIntent({ status: 'running', severity: 'blocking' })).toBe('attention');
    expect(flowerActivityDisclosureIntent({ status: 'success', needs_attention: true })).toBe('attention');
    expect(flowerActivityDisclosureIntent({ status: 'canceled' })).toBe('settled');
  });
});

describe('createFlowerActivityDisclosureController', () => {
  it('does not reveal activity that settles before the automatic open delay', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS - 1);
    expect(harness.control.open()).toBe(false);

    harness.setIntent('settled');
    await vi.runAllTimersAsync();
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('reveals sustained work and holds its completed state before closing', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);
    expect(harness.control.open()).toBe(true);

    harness.setIntent('settled');
    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_SETTLE_HOLD_MS - 1);
    expect(harness.control.open()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('cancels a scheduled close when the same item becomes active again', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);
    harness.setIntent('settled');
    await vi.advanceTimersByTimeAsync(500);
    harness.setIntent('active');
    await vi.advanceTimersByTimeAsync(1000);

    expect(harness.control.open()).toBe(true);
    harness.dispose();
  });

  it('opens attention states immediately and keeps them latched', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('attention');

    expect(harness.control.open()).toBe(true);
    harness.setIntent('settled');
    await vi.advanceTimersByTimeAsync(5000);

    expect(harness.control.open()).toBe(true);
    harness.dispose();
  });

  it('lets explicit user choices override every later lifecycle transition', async () => {
    vi.useFakeTimers();
    const manuallyOpened = createControllerHarness('active');

    manuallyOpened.control.toggle();
    expect(manuallyOpened.control.open()).toBe(true);
    manuallyOpened.setIntent('settled');
    await vi.advanceTimersByTimeAsync(5000);
    expect(manuallyOpened.control.open()).toBe(true);
    manuallyOpened.dispose();

    const manuallyClosed = createControllerHarness('active');
    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);
    manuallyClosed.control.toggle();
    expect(manuallyClosed.control.open()).toBe(false);
    manuallyClosed.setIntent('attention');
    await vi.advanceTimersByTimeAsync(5000);
    expect(manuallyClosed.control.open()).toBe(false);
    manuallyClosed.dispose();
  });

  it('pins automatic disclosure when the user interacts with its details', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);
    harness.setIntent('settled');
    await vi.advanceTimersByTimeAsync(500);
    harness.control.retainOpen();
    await vi.advanceTimersByTimeAsync(1000);

    expect(harness.control.open()).toBe(true);
    harness.dispose();
  });

  it('suppresses routine automatic expansion when reduced motion is preferred', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active', true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.control.open()).toBe(false);

    harness.setIntent('attention');
    expect(harness.control.open()).toBe(true);
    harness.dispose();
  });

  it('clears pending timers when its owning item unmounts', () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    expect(vi.getTimerCount()).toBe(1);
    harness.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps controllers isolated by their owning activity item', async () => {
    vi.useFakeTimers();
    const first = createControllerHarness('active');
    const second = createControllerHarness('active');

    first.control.toggle();
    await vi.advanceTimersByTimeAsync(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS);

    expect(first.control.open()).toBe(true);
    expect(second.control.open()).toBe(true);
    second.control.toggle();
    expect(first.control.open()).toBe(true);
    expect(second.control.open()).toBe(false);
    first.dispose();
    second.dispose();
  });
});

type ResizeObserverRecord = Readonly<{
  callback: ResizeObserverCallback;
  elements: Set<Element>;
}>;

function createRafHarness() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  let nextTimestamp = performance.now() + 16;
  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      callbacks.delete(handle);
    },
    flushNext(): void {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1](nextTimestamp);
      nextTimestamp += 16;
    },
    flushAll(limit = 200): void {
      let remaining = limit;
      while (callbacks.size > 0 && remaining > 0) {
        this.flushNext();
        remaining -= 1;
      }
      if (callbacks.size > 0) throw new Error('RAF queue did not settle');
    },
    count: () => callbacks.size,
  };
}

function installResizeObserverHarness(records: ResizeObserverRecord[]) {
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: ResizeObserverRecord;

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, elements: new Set<Element>() };
      records.push(this.record);
    }

    observe = (element: Element) => {
      this.record.elements.add(element);
    };

    unobserve = (element: Element) => {
      this.record.elements.delete(element);
    };

    disconnect = () => {
      this.record.elements.clear();
    };
  });
}

function triggerResize(records: ResizeObserverRecord[], target: Element, height: number): void {
  const record = records.find((candidate) => candidate.elements.has(target));
  if (!record) throw new Error('ResizeObserver target not found');
  record.callback([{
    target,
    contentRect: {
      width: 0,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      toJSON: () => ({}),
    },
  } as ResizeObserverEntry], {} as ResizeObserver);
}

type MotionHarness = Readonly<{
  motion: FlowerActivityDisclosureMotion;
  viewport: HTMLDivElement;
  content: HTMLDivElement;
  dispose: () => void;
  setOpen: (open: boolean) => void;
  setReducedMotion: (reduced: boolean) => void;
  setContentHeight: (height: number) => void;
}>;

function createMotionHarness(initialOpen = false, initialReducedMotion = false): MotionHarness {
  const [open, setOpen] = createSignal(initialOpen);
  const [reducedMotion, setReducedMotion] = createSignal(initialReducedMotion);
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  viewport.appendChild(content);
  document.body.appendChild(viewport);
  let contentHeight = 120;
  let dispose: () => void = () => undefined;
  let motion!: FlowerActivityDisclosureMotion;

  Object.defineProperty(content, 'offsetHeight', { configurable: true, get: () => contentHeight });
  Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => contentHeight });
  content.getBoundingClientRect = () => ({
    width: 320,
    height: contentHeight,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 320,
    bottom: contentHeight,
    toJSON: () => ({}),
  });
  viewport.getBoundingClientRect = () => {
    const rawHeight = motion?.height() ?? '0px';
    const measuredHeight = rawHeight === 'auto' ? contentHeight : Number.parseFloat(rawHeight) || 0;
    return {
      width: 320,
      height: measuredHeight,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: measuredHeight,
      toJSON: () => ({}),
    };
  };

  createRoot((rootDispose) => {
    dispose = rootDispose;
    motion = createFlowerActivityDisclosureMotion(open, {
      animateContentResize: true,
      reducedMotion,
    });
    motion.bindViewport(viewport);
    motion.bindContent(content);
  });

  return {
    motion,
    viewport,
    content,
    dispose,
    setOpen,
    setReducedMotion,
    setContentHeight: (height) => {
      contentHeight = height;
    },
  };
}

describe('createFlowerActivityDisclosureMotion', () => {
  it('uses the calm motion timing contract', () => {
    expect(FLOWER_ACTIVITY_AUTO_OPEN_DELAY_MS).toBe(400);
    expect(FLOWER_ACTIVITY_OPEN_DURATION_MS).toBe(360);
    expect(FLOWER_ACTIVITY_RESIZE_DURATION_MS).toBe(280);
    expect(FLOWER_ACTIVITY_SETTLE_HOLD_MS).toBe(1200);
    expect(FLOWER_ACTIVITY_CLOSE_DURATION_MS).toBe(300);
  });

  it('measures opening height and retargets consecutive content changes', () => {
    vi.useFakeTimers();
    const resizeRecords: ResizeObserverRecord[] = [];
    const raf = createRafHarness();
    installResizeObserverHarness(resizeRecords);
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);
    const harness = createMotionHarness();

    harness.setOpen(true);
    expect(harness.motion.mounted()).toBe(true);
    expect(harness.motion.state()).toBe('opening');
    expect(harness.motion.height()).toBe('0px');

    raf.flushNext();
    raf.flushNext();
    expect(harness.motion.height()).toBe('120px');

    harness.motion.onTransitionEnd({
      target: harness.viewport,
      propertyName: 'height',
    } as unknown as TransitionEvent);
    expect(harness.motion.state()).toBe('open');
    raf.flushAll();

    harness.setContentHeight(210);
    triggerResize(resizeRecords, harness.content, 210);
    raf.flushNext();
    expect(harness.motion.height()).toBe('210px');
    expect(harness.motion.layoutMotion()).toBe('resizing');
    raf.flushAll();

    harness.setContentHeight(268);
    triggerResize(resizeRecords, harness.content, 268);
    raf.flushAll();
    expect(harness.motion.height()).toBe('268px');

    harness.setContentHeight(156);
    triggerResize(resizeRecords, harness.content, 156);
    raf.flushAll();
    expect(harness.motion.height()).toBe('156px');
    harness.dispose();
  });

  it('keeps closing content mounted, supports reopening, and unmounts after height transition', () => {
    vi.useFakeTimers();
    const resizeRecords: ResizeObserverRecord[] = [];
    const raf = createRafHarness();
    installResizeObserverHarness(resizeRecords);
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);
    const harness = createMotionHarness(true);
    raf.flushNext();
    raf.flushNext();
    harness.motion.onTransitionEnd({ target: harness.viewport, propertyName: 'height' } as unknown as TransitionEvent);

    harness.setOpen(false);
    expect(harness.motion.state()).toBe('closing');
    expect(harness.motion.mounted()).toBe(true);
    raf.flushAll();
    expect(harness.motion.height()).toBe('0px');

    harness.setOpen(true);
    expect(harness.motion.state()).toBe('opening');
    expect(harness.motion.mounted()).toBe(true);
    raf.flushAll();
    harness.motion.onTransitionEnd({ target: harness.viewport, propertyName: 'height' } as unknown as TransitionEvent);
    expect(harness.motion.state()).toBe('open');

    harness.setOpen(false);
    raf.flushAll();
    harness.motion.onTransitionEnd({ target: harness.viewport, propertyName: 'height' } as unknown as TransitionEvent);
    expect(harness.motion.state()).toBe('closed');
    expect(harness.motion.mounted()).toBe(false);
    harness.dispose();
  });

  it('uses instant auto-height layout for reduced motion and without ResizeObserver', () => {
    vi.useFakeTimers();
    const raf = createRafHarness();
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);
    vi.stubGlobal('ResizeObserver', undefined);
    const fallback = createMotionHarness();

    fallback.setOpen(true);
    raf.flushNext();
    raf.flushNext();
    fallback.motion.onTransitionEnd({ target: fallback.viewport, propertyName: 'height' } as unknown as TransitionEvent);
    expect(fallback.motion.height()).toBe('auto');
    fallback.dispose();

    const reducedRecords: ResizeObserverRecord[] = [];
    installResizeObserverHarness(reducedRecords);
    const reduced = createMotionHarness(false, true);
    reduced.setOpen(true);
    expect(reduced.motion.state()).toBe('open');
    expect(reduced.motion.height()).toBe('auto');
    reduced.setOpen(false);
    expect(reduced.motion.state()).toBe('closed');
    expect(reduced.motion.mounted()).toBe(false);
    reduced.dispose();
  });

  it('cleans observers, timers, and animation frames on disposal', () => {
    vi.useFakeTimers();
    const resizeRecords: ResizeObserverRecord[] = [];
    const raf = createRafHarness();
    installResizeObserverHarness(resizeRecords);
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);
    const harness = createMotionHarness();

    harness.setOpen(true);
    raf.flushNext();
    raf.flushNext();
    expect(raf.count()).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    harness.dispose();

    expect(raf.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(resizeRecords.every((record) => record.elements.size === 0)).toBe(true);
  });
});
