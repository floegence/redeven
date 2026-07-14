// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFlowerActivityDisclosureController,
  flowerActivityDisclosureIntent,
  type FlowerActivityDisclosureController,
  type FlowerActivityDisclosureIntent,
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

    await vi.advanceTimersByTimeAsync(299);
    expect(harness.control.open()).toBe(false);

    harness.setIntent('settled');
    await vi.runAllTimersAsync();
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('reveals sustained work and holds its completed state before closing', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(300);
    expect(harness.control.open()).toBe(true);

    harness.setIntent('settled');
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.control.open()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('cancels a scheduled close when the same item becomes active again', async () => {
    vi.useFakeTimers();
    const harness = createControllerHarness('active');

    await vi.advanceTimersByTimeAsync(300);
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
    await vi.advanceTimersByTimeAsync(300);
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

    await vi.advanceTimersByTimeAsync(300);
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
    await vi.advanceTimersByTimeAsync(300);

    expect(first.control.open()).toBe(true);
    expect(second.control.open()).toBe(true);
    second.control.toggle();
    expect(first.control.open()).toBe(true);
    expect(second.control.open()).toBe(false);
    first.dispose();
    second.dispose();
  });
});
