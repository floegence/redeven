import { describe, expect, it } from 'vitest';

import { createFlowerScrollTailController } from './flowerScrollTail';

type RafCallback = (timestamp: number) => void;

function createRafHarness() {
  const queue = new Map<number, RafCallback>();
  let nextID = 1;
  let timestamp = 0;
  return {
    requestAnimationFrame(callback: RafCallback): number {
      const id = nextID++;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      queue.delete(id);
    },
    flushAll(): void {
      while (queue.size > 0) {
        const [id, callback] = queue.entries().next().value as [number, RafCallback];
        queue.delete(id);
        timestamp += 16;
        callback(timestamp);
      }
    },
  };
}

function createViewport(initialScrollHeight = 500) {
  let scrollHeight = initialScrollHeight;
  let scrollTop = Math.max(0, initialScrollHeight - 100);
  const viewport = {
    get clientHeight() {
      return 100;
    },
    get scrollHeight() {
      return scrollHeight;
    },
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = Number(value);
    },
  } as unknown as HTMLDivElement;
  return {
    viewport,
    scrollTop: () => scrollTop,
    setScrollHeight: (value: number) => {
      scrollHeight = value;
    },
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}

function createController() {
  const raf = createRafHarness();
  const controller = createFlowerScrollTailController({
    reducedMotionPreferred: () => true,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
  });
  return { controller, raf };
}

describe('Flower scroll tail controller', () => {
  it('follows assistant and tool content growth while following latest', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);

    metrics.setScrollHeight(620);
    controller.measureAfterLayout();
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(520);
    controller.dispose();
  });

  it('keeps following even when one update exceeds the near-bottom threshold', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);

    metrics.setScrollHeight(900);
    controller.measureAfterLayout();
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(800);
    expect(controller.nearBottom()).toBe(true);
    controller.dispose();
  });

  it('does not move a paused viewport when new content arrives', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    metrics.setScrollTop(220);
    controller.onWheel({ deltaY: -1 } as WheelEvent);

    metrics.setScrollHeight(900);
    controller.measureAfterLayout();
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(220);
    expect(controller.nearBottom()).toBe(false);
    controller.dispose();
  });

  it('resumes following after the user returns to the bottom', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    metrics.setScrollTop(220);
    controller.onWheel({ deltaY: -1 } as WheelEvent);

    metrics.setScrollHeight(900);
    metrics.setScrollTop(800);
    controller.onScroll();
    metrics.setScrollHeight(980);
    controller.measureAfterLayout();
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(880);
    controller.dispose();
  });

  it('coalesces rapid layout notifications and lands on the newest bottom', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);

    metrics.setScrollHeight(620);
    controller.measureAfterLayout();
    metrics.setScrollHeight(760);
    controller.measureAfterLayout();
    metrics.setScrollHeight(840);
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(740);
    controller.dispose();
  });
});
