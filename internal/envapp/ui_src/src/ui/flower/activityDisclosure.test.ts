// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFlowerActivityDisclosureController,
  createFlowerActivityDisclosureMotion,
  FLOWER_ACTIVITY_CLOSE_DURATION_MS,
  FLOWER_ACTIVITY_OPEN_DURATION_MS,
  FLOWER_ACTIVITY_RESIZE_DURATION_MS,
  type FlowerActivityDisclosureAnimation,
  type FlowerActivityDisclosureController,
  type FlowerActivityDisclosureMotion,
  type FlowerActivityDisclosureMotionPlatform,
  type FlowerActivityDisclosurePresentation,
} from '../../../../../flower_ui/src/activityDisclosure';

type ControllerHarness = Readonly<{
  control: FlowerActivityDisclosureController;
  dispose: () => void;
  setManualOpen: (open: boolean | undefined) => void;
}>;

function createControllerHarness(): ControllerHarness {
  const [manualOpen, setManualOpen] = createSignal<boolean | undefined>(undefined);
  let dispose: () => void = () => undefined;
  let control!: FlowerActivityDisclosureController;
  createRoot((rootDispose) => {
    dispose = rootDispose;
    control = createFlowerActivityDisclosureController({
      manualOpen,
      onManualOpenChange: setManualOpen,
    });
  });
  return { control, dispose, setManualOpen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('createFlowerActivityDisclosureController', () => {
  it('keeps details closed until the user opens them', () => {
    const harness = createControllerHarness();
    expect(harness.control.open()).toBe(false);
    harness.control.toggle();
    expect(harness.control.open()).toBe(true);
    harness.control.toggle();
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('uses the externally persisted manual choice as its only state', () => {
    const harness = createControllerHarness();
    harness.control.toggle();
    expect(harness.control.open()).toBe(true);
    harness.setManualOpen(false);
    expect(harness.control.open()).toBe(false);
    harness.dispose();
  });

  it('opens actionable facts by default and preserves a manual collapse through updates', () => {
    createRoot((dispose) => {
      const [manualOpen, setManualOpen] = createSignal<boolean>();
      const [needsAttention, setNeedsAttention] = createSignal(false);
      const control = createFlowerActivityDisclosureController({ manualOpen, needsAttention, onManualOpenChange: setManualOpen });
      expect(control.open()).toBe(false);
      setNeedsAttention(true);
      expect(control.open()).toBe(true);
      control.toggle();
      setNeedsAttention(false);
      setNeedsAttention(true);
      expect(control.open()).toBe(false);
      dispose();
    });
  });

  it('does not schedule background timers for a closed activity row', () => {
    vi.useFakeTimers();
    const harness = createControllerHarness();
    expect(vi.getTimerCount()).toBe(0);
    harness.dispose();
  });
});

class ControlledDisclosureAnimation implements FlowerActivityDisclosureAnimation {
  private resolveFinished!: () => void;
  private rejectFinished!: () => void;
  private state: AnimationPlayState = 'running';
  readonly finished = new Promise<void>((resolve, reject) => {
    this.resolveFinished = resolve;
    this.rejectFinished = reject;
  });

  constructor(
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
    private readonly onFinish: (keyframe: Keyframe) => void,
  ) {}

  get playState(): AnimationPlayState {
    return this.state;
  }

  finish(): void {
    if (this.state !== 'running') return;
    this.state = 'finished';
    this.onFinish(this.keyframes[this.keyframes.length - 1] ?? {});
    this.resolveFinished();
  }

  cancel(): void {
    if (this.state !== 'running') return;
    this.state = 'idle';
    this.rejectFinished();
  }
}

function createMotionPlatformHarness() {
  const frames = new Map<number, FrameRequestCallback>();
  const resizeCallbacks = new Map<Element, () => void>();
  const animations: ControlledDisclosureAnimation[] = [];
  let nextFrame = 1;
  let timestamp = 16;
  let presentation: FlowerActivityDisclosurePresentation = {
    height: 0,
    opacity: 0,
    transform: 'translateY(-2px)',
  };

  const platform: FlowerActivityDisclosureMotionPlatform = {
    requestAnimationFrame(callback) {
      const handle = nextFrame;
      nextFrame += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
    observeResize(node, callback) {
      resizeCallbacks.set(node, callback);
      return () => resizeCallbacks.delete(node);
    },
    readPresentation() {
      return presentation;
    },
    animate(_node, keyframes, animationOptions) {
      const animation = new ControlledDisclosureAnimation(keyframes, animationOptions, (keyframe) => {
        presentation = {
          height: Number.parseFloat(String(keyframe.height ?? 0)) || 0,
          opacity: Number.parseFloat(String(keyframe.opacity ?? 0)) || 0,
          transform: String(keyframe.transform ?? 'translateY(0px)'),
        };
      });
      animations.push(animation);
      return animation;
    },
  };

  return {
    platform,
    animations,
    flushFrame() {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1](timestamp);
      timestamp += 16;
    },
    triggerResize(node: Element) {
      const callback = resizeCallbacks.get(node);
      if (!callback) throw new Error('ResizeObserver target not found');
      callback();
    },
    setPresentation(next: FlowerActivityDisclosurePresentation) {
      presentation = next;
    },
    flushUntilAnimationCount(count: number) {
      let remaining = 20;
      while (animations.length < count && frames.size > 0 && remaining > 0) {
        this.flushFrame();
        remaining -= 1;
      }
      if (animations.length < count) throw new Error(`Expected ${count} animations, received ${animations.length}`);
    },
    pendingFrames: () => frames.size,
    observedElements: () => resizeCallbacks.size,
  };
}

type MotionHarness = Readonly<{
  motion: FlowerActivityDisclosureMotion;
  viewport: HTMLDivElement;
  content: HTMLDivElement;
  dispose: () => void;
  setOpen: (open: boolean) => void;
  setReducedMotion: (reduced: boolean) => void;
  setContentHeight: (height: number) => void;
  platform: ReturnType<typeof createMotionPlatformHarness>;
}>;

function createMotionHarness(initialOpen = false, initialReducedMotion = false): MotionHarness {
  const [open, setOpen] = createSignal(initialOpen);
  const [reducedMotion, setReducedMotion] = createSignal(initialReducedMotion);
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  viewport.appendChild(content);
  document.body.appendChild(viewport);
  let contentHeight = 120;
  const platform = createMotionPlatformHarness();
  let dispose: () => void = () => undefined;
  let motion!: FlowerActivityDisclosureMotion;

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
  createRoot((rootDispose) => {
    dispose = rootDispose;
    motion = createFlowerActivityDisclosureMotion(open, {
      reducedMotion,
      platform: platform.platform,
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
    platform,
  };
}

describe('createFlowerActivityDisclosureMotion', () => {
  it('uses the calm motion timing contract', () => {
    expect(FLOWER_ACTIVITY_OPEN_DURATION_MS).toBe(360);
    expect(FLOWER_ACTIVITY_RESIZE_DURATION_MS).toBe(280);
    expect(FLOWER_ACTIVITY_CLOSE_DURATION_MS).toBe(300);
  });

  it('measures opening height and retargets consecutive content changes', async () => {
    const harness = createMotionHarness();

    harness.setOpen(true);
    expect(harness.motion.mounted()).toBe(true);
    expect(harness.motion.state()).toBe('opening');
    expect(harness.motion.height()).toBe('0px');

    harness.platform.flushFrame();
    expect(harness.motion.height()).toBe('120px');
    expect(harness.platform.animations[0]?.options.duration).toBe(FLOWER_ACTIVITY_OPEN_DURATION_MS);
    harness.platform.animations[0]?.finish();
    await Promise.resolve();
    expect(harness.motion.state()).toBe('open');

    harness.platform.triggerResize(harness.content);
    harness.platform.flushFrame();
    expect(harness.platform.animations).toHaveLength(1);

    harness.setContentHeight(210);
    harness.platform.triggerResize(harness.content);
    harness.platform.flushFrame();
    expect(harness.motion.height()).toBe('210px');
    expect(harness.motion.layoutMotion()).toBe('resizing');
    expect(harness.platform.animations[1]?.options.duration).toBe(FLOWER_ACTIVITY_RESIZE_DURATION_MS);

    harness.platform.setPresentation({ height: 168, opacity: 1, transform: 'translateY(0px)' });
    harness.setContentHeight(268);
    harness.platform.triggerResize(harness.content);
    harness.platform.flushUntilAnimationCount(3);
    expect(harness.platform.animations[1]?.playState).toBe('idle');
    expect(harness.platform.animations[2]?.keyframes[0]?.height).toBe('168px');
    harness.platform.animations[2]?.finish();
    await Promise.resolve();
    expect(harness.motion.height()).toBe('268px');

    harness.setContentHeight(156);
    harness.platform.triggerResize(harness.content);
    harness.platform.flushUntilAnimationCount(4);
    harness.platform.animations[3]?.finish();
    await Promise.resolve();
    expect(harness.motion.height()).toBe('156px');
    harness.dispose();
  });

  it('keeps closing content mounted, supports reopening, and unmounts after animation completion', async () => {
    const harness = createMotionHarness(true);
    harness.platform.flushFrame();
    harness.platform.animations[0]?.finish();
    await Promise.resolve();

    harness.setOpen(false);
    expect(harness.motion.state()).toBe('closing');
    expect(harness.motion.mounted()).toBe(true);
    expect(harness.motion.height()).toBe('0px');

    harness.platform.setPresentation({ height: 72, opacity: 0.6, transform: 'translateY(-1px)' });
    harness.setOpen(true);
    expect(harness.motion.state()).toBe('opening');
    expect(harness.motion.mounted()).toBe(true);
    expect(harness.platform.animations[1]?.playState).toBe('idle');
    harness.platform.flushFrame();
    expect(harness.platform.animations[2]?.keyframes[0]?.height).toBe('72px');
    harness.platform.animations[2]?.finish();
    await Promise.resolve();
    expect(harness.motion.state()).toBe('open');

    harness.setOpen(false);
    expect(harness.platform.animations[3]?.options.duration).toBe(FLOWER_ACTIVITY_CLOSE_DURATION_MS);
    harness.platform.animations[3]?.finish();
    await Promise.resolve();
    expect(harness.motion.state()).toBe('closed');
    expect(harness.motion.mounted()).toBe(false);
    harness.dispose();
  });

  it('commits measured pixel height without animation for reduced motion', () => {
    const reduced = createMotionHarness(false, true);
    reduced.setOpen(true);
    expect(reduced.motion.state()).toBe('open');
    expect(reduced.motion.height()).toBe('120px');
    expect(reduced.platform.animations).toHaveLength(0);
    reduced.setOpen(false);
    expect(reduced.motion.state()).toBe('closed');
    expect(reduced.motion.mounted()).toBe(false);
    reduced.dispose();
  });

  it('cleans observers, animations, and animation frames on disposal', () => {
    const harness = createMotionHarness();

    harness.setOpen(true);
    harness.platform.flushFrame();
    expect(harness.platform.pendingFrames()).toBeGreaterThan(0);
    expect(harness.platform.animations[0]?.playState).toBe('running');
    harness.dispose();

    expect(harness.platform.pendingFrames()).toBe(0);
    expect(harness.platform.animations[0]?.playState).toBe('idle');
    expect(harness.platform.observedElements()).toBe(0);
  });
});
