import { describe, expect, it } from 'vitest';

import {
  FlowerCompanionTailMotionController,
  reliableFlowerTailAppend,
} from './flowerCompanionTailMotion';

function fixture(options: Readonly<{ reduced?: boolean; viewportWidth?: number; clampGap?: number }> = {}) {
  let content = '';
  let scrollLeft = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let frameID = 0;
  let frameTime = 0;
  let reduced = Boolean(options.reduced);
  let trimmedWidth = 0;
  const viewport = {
    get clientWidth() { return options.viewportWidth ?? 100; },
    get scrollWidth() { return Array.from(content).length * 10; },
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(value: number) {
      const maximum = Math.max(0, Array.from(content).length * 10 - (options.viewportWidth ?? 100));
      scrollLeft = Math.min(value, Math.max(0, maximum - (options.clampGap ?? 0)));
    },
  } as HTMLElement;
  const value = {
    get textContent() { return content; },
    set textContent(next: string | null) { content = next ?? ''; },
  } as HTMLElement;
  const controller = new FlowerCompanionTailMotionController({ viewport, value }, {
    requestFrame: (callback) => {
      const id = ++frameID;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    measurePrefix: (count) => {
      trimmedWidth += count * 10;
      return count * 10;
    },
    reducedMotion: () => reduced,
  });
  const runFrame = (elapsedMs = 1000 / 60) => {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) return false;
    frames.delete(entry[0]);
    frameTime += elapsedMs;
    entry[1](frameTime);
    return true;
  };
  return {
    controller,
    frames,
    runFrame,
    content: () => content,
    scrollLeft: () => scrollLeft,
    visualOffset: () => scrollLeft + trimmedWidth,
    setReduced: (next: boolean) => { reduced = next; },
    maximum: () => Math.max(0, Array.from(content).length * 10 - (options.viewportWidth ?? 100)),
  };
}

describe('reliableFlowerTailAppend', () => {
  it('accepts ordinary append and reconstructs a 320-character rolling window', () => {
    expect(reliableFlowerTailAppend('hello', 'hello world')).toBe(' world');
    const previous = `${'a'.repeat(160)}${'b'.repeat(160)}`;
    const next = `${previous.slice(1)}c`;
    expect(reliableFlowerTailAppend(previous, next)).toBe('c');
  });

  it('rejects short coincidental overlap, rewrite, and shrink', () => {
    expect(reliableFlowerTailAppend('alpha-x', 'x-rewritten')).toBeNull();
    expect(reliableFlowerTailAppend('longer value', 'short')).toBeNull();
    expect(reliableFlowerTailAppend('abc', 'abd')).toBeNull();
  });
});

describe('FlowerCompanionTailMotionController', () => {
  it('snaps the first projection and follows a short append with one frame loop', () => {
    const view = fixture();
    view.controller.update({ identity: 'stream', text: '01234567890123456789' });
    expect(view.scrollLeft()).toBe(view.maximum());

    view.controller.update({ identity: 'stream', text: '01234567890123456789ab' });
    expect(view.frames.size).toBe(1);
    const firstPosition = view.scrollLeft();
    view.controller.update({ identity: 'stream', text: '01234567890123456789abcd' });
    expect(view.frames.size).toBe(1);
    expect(view.runFrame()).toBe(true);
    expect(view.scrollLeft()).toBeGreaterThan(firstPosition);
    while (view.runFrame()) {
      // Drain the single follower.
    }
    expect(view.scrollLeft()).toBeCloseTo(view.maximum(), 5);
  });

  it('snaps rewrites and identity changes without leaving a stale callback', () => {
    const view = fixture();
    view.controller.update({ identity: 'stream-a', text: 'a'.repeat(20) });
    view.controller.update({ identity: 'stream-a', text: `${'a'.repeat(20)}b` });
    expect(view.frames.size).toBe(1);
    view.controller.update({ identity: 'stream-b', text: 'replacement text that is long' });
    expect(view.frames.size).toBe(0);
    expect(view.content()).toBe('replacement text that is long');
    expect(view.scrollLeft()).toBe(view.maximum());
  });

  it('keeps continuous output bounded during an unsettled stream', () => {
    const view = fixture({ viewportWidth: 3_000 });
    let projection = 'x'.repeat(320);
    view.controller.update({ identity: 'stream', text: projection });
    const positions: number[] = [];
    for (let index = 0; index < 520; index += 1) {
      projection = `${projection.slice(1)}${index % 10}`;
      view.controller.update({ identity: 'stream', text: projection });
      view.runFrame();
      positions.push(view.visualOffset());
    }
    expect(Array.from(view.content()).length).toBeLessThanOrEqual(800);
    expect(view.visualOffset()).toBeGreaterThan(view.scrollLeft());
    expect(positions.every((position, index) => index === 0 || position >= positions[index - 1])).toBe(true);
    expect(view.scrollLeft()).toBeLessThanOrEqual(view.maximum());
    while (view.runFrame()) {
      // Settle the follower and its final compacting trim.
    }
    expect(Array.from(view.content()).length).toBeLessThanOrEqual(480);
    expect(view.content().endsWith(projection)).toBe(true);
    expect(view.scrollLeft()).toBeCloseTo(view.maximum(), 5);
  });

  it('snaps resize, in-flight reduced motion, and stale callbacks to the latest edge', () => {
    const view = fixture();
    view.controller.update({ identity: 'stream', text: 'a'.repeat(20) });
    view.controller.update({ identity: 'stream', text: `${'a'.repeat(20)}b` });
    const stale = view.frames.values().next().value as FrameRequestCallback;
    view.controller.resize();
    expect(view.frames.size).toBe(0);
    const resizedPosition = view.scrollLeft();
    stale(200);
    expect(view.scrollLeft()).toBe(resizedPosition);

    view.controller.update({ identity: 'stream', text: `${'a'.repeat(20)}bc` });
    expect(view.frames.size).toBe(1);
    view.setReduced(true);
    view.controller.reducedMotionChanged();
    expect(view.frames.size).toBe(0);
    expect(view.scrollLeft()).toBe(view.maximum());
  });

  it('uses elapsed time so different refresh rates converge over similar wall time', () => {
    const positions: number[] = [];
    for (const interval of [1000 / 30, 1000 / 60, 1000 / 120]) {
      const view = fixture();
      view.controller.update({ identity: 'stream', text: 'a'.repeat(20) });
      view.controller.update({ identity: 'stream', text: `${'a'.repeat(20)}abcdefghij` });
      for (let elapsed = 0; elapsed < 360; elapsed += interval) view.runFrame(interval);
      positions.push(view.scrollLeft());
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
  });

  it('settles when browser scroll quantization clamps the reachable end', () => {
    const view = fixture({ clampGap: 4 });
    const initial = 'a'.repeat(20);
    view.controller.update({ identity: 'stream', text: initial });
    view.controller.update({ identity: 'stream', text: `${initial}b` });
    let frameCount = 0;
    while (view.runFrame() && frameCount < 100) frameCount += 1;
    expect(frameCount).toBeLessThan(100);
    expect(view.frames.size).toBe(0);
    expect(view.maximum() - view.scrollLeft()).toBe(4);
  });

  it('snaps in reduced motion and cancels pending work on disposal', () => {
    const reduced = fixture({ reduced: true });
    reduced.controller.update({ identity: 'stream', text: 'a'.repeat(20) });
    reduced.controller.update({ identity: 'stream', text: `${'a'.repeat(20)}b` });
    expect(reduced.frames.size).toBe(0);
    expect(reduced.scrollLeft()).toBe(reduced.maximum());

    const moving = fixture();
    moving.controller.update({ identity: 'stream', text: 'a'.repeat(20) });
    moving.controller.update({ identity: 'stream', text: `${'a'.repeat(20)}b` });
    expect(moving.frames.size).toBe(1);
    const stale = moving.frames.values().next().value as FrameRequestCallback;
    const positionBeforeDispose = moving.scrollLeft();
    moving.controller.dispose();
    expect(moving.frames.size).toBe(0);
    stale(1_000);
    expect(moving.scrollLeft()).toBe(positionBeforeDispose);
  });
});
