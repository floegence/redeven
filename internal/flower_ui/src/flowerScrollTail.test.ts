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
    pending: () => queue.size,
    flushFrame(): void {
      const callbacks = [...queue.values()];
      queue.clear();
      timestamp += 16;
      callbacks.forEach(callback => callback(timestamp));
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
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, width: 500, height: 100 }),
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
  it('suppresses late arrival animations until the destination is ready', () => {
    const raf = createRafHarness();
    let preparing = false;
    const controller = createFlowerScrollTailController({ preparing: () => preparing, reducedMotionPreferred: () => false,
      requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    controller.prepareArrival();
    preparing = true;
    metrics.setScrollHeight(1000);
    expect(controller.prepareArrival()).toBe(0);
    controller.scheduleTailScroll({ smooth: true });
    raf.flushFrame();
    expect(metrics.scrollTop()).toBe(900);
    preparing = false;
    metrics.setScrollHeight(1200);
    expect(controller.prepareArrival()).toBe(220);
    raf.flushFrame(); raf.flushFrame();
    expect(metrics.scrollTop()).toBeGreaterThanOrEqual(900);
    expect(metrics.scrollTop()).toBeLessThan(1100);
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(1100);
    controller.dispose();
  });
  it('preserves native wheel movement before its scroll event while correcting late content growth', () => {
    const { controller, raf } = createController();
    const metrics = createViewport(2000);
    let documentTop = 1920;
    const title = { isConnected: true, getBoundingClientRect: () => ({ top: documentTop - metrics.scrollTop(), height: 20 }) } as HTMLElement;
    Object.assign(metrics.viewport, { contains: (value: unknown) => value === title });
    controller.bind(metrics.viewport);
    controller.onWheel({ target: metrics.viewport, deltaY: -900 } as unknown as WheelEvent);
    controller.preserveLayoutAnchor(title);
    metrics.setScrollTop(1000);
    documentTop += 120;
    metrics.setScrollHeight(2120);
    controller.flushLayout(false);
    expect(metrics.scrollTop()).toBe(1120);
    controller.onScroll();
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(1120);
    controller.dispose();
  });
  it('preserves scheduled readiness notifications during before-paint anchor correction', () => {
    const raf = createRafHarness();
    let notifications = 0;
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => true,
      onLayout: () => { notifications++; }, requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    controller.bind(createViewport().viewport);
    controller.measureAfterLayout();
    controller.flushLayout(false);
    expect(notifications).toBe(0);
    expect(raf.pending()).toBe(1);
    raf.flushAll();
    expect(notifications).toBe(1);
    controller.dispose();
  });
  it('reports directional input at an immovable edge without treating layout as input', () => {
    const raf = createRafHarness();
    const intents: string[] = [];
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => true,
      onScrollIntent: direction => intents.push(direction),
      requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport(80);
    controller.bind(metrics.viewport);
    controller.onWheel({ target: metrics.viewport, deltaY: -100 } as unknown as WheelEvent);
    expect(intents).toEqual(['before']);
    metrics.setScrollHeight(700);
    controller.measureAfterLayout();
    raf.flushAll();
    controller.onScroll();
    expect(intents).toEqual(['before']);
    controller.onWheel({ target: metrics.viewport, deltaY: 100 } as unknown as WheelEvent);
    expect(intents).toEqual(['before', 'after']);
    controller.dispose();
  });
  it('does not follow the end of a history window that has later content', () => {
    const raf = createRafHarness();
    let hasAfter = true;
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => true,
      canFollowLatest: () => !hasAfter, requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    controller.stopFollowing();
    const wheel = { target: metrics.viewport, deltaY: 100, defaultPrevented: false, ctrlKey: false } as unknown as WheelEvent;
    controller.onWheel(wheel);
    controller.onScroll();
    expect(controller.followingLatest()).toBe(false);
    metrics.setScrollHeight(800);
    controller.measureAfterLayout();
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(400);
    hasAfter = false;
    metrics.setScrollTop(700);
    controller.onWheel(wheel);
    expect(controller.followingLatest()).toBe(true);
    controller.dispose();
  });

  it.each([false, true])('clears prior arrival motion before starting a new destination: started=%s', (started) => {
    const raf = createRafHarness();
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => false,
      requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    metrics.setScrollHeight(700);
    controller.prepareArrival();
    if (started) raf.flushFrame();
    metrics.setScrollHeight(1200);
    metrics.setScrollTop(0);
    controller.startFollowing();
    controller.flushLayout();
    expect(metrics.scrollTop()).toBe(1100);
    expect(raf.pending()).toBe(0);
    controller.dispose();
  });

  it('keeps arrival motion through layout notifications and retargets a burst without restarting', () => {
    const raf = createRafHarness();
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => false,
      requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    metrics.setScrollHeight(600);
    expect(controller.prepareArrival()).toBe(220);
    controller.scheduleTailScroll({ smooth: false });
    raf.flushFrame();
    raf.flushFrame();
    expect(metrics.scrollTop()).toBeGreaterThan(400);
    expect(metrics.scrollTop()).toBeLessThan(500);
    metrics.setScrollHeight(700);
    controller.prepareArrival();
    for (let index = 0; index < 13; index++) {
      controller.scheduleTailScroll({ smooth: false });
      controller.measureAfterLayout();
      raf.flushFrame();
    }
    expect(metrics.scrollTop()).toBe(600);
    expect(raf.pending()).toBe(0);
    controller.dispose();
  });

  it('interrupts arrival scrolling on user input and reduced motion changes', () => {
    const raf = createRafHarness();
    let reduced = false;
    const controller = createFlowerScrollTailController({ reducedMotionPreferred: () => reduced,
      requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame });
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    metrics.setScrollHeight(600);
    controller.prepareArrival();
    raf.flushFrame();
    raf.flushFrame();
    controller.onWheel({ deltaY: -1, target: metrics.viewport } as unknown as WheelEvent);
    const reading = metrics.scrollTop();
    expect(controller.prepareArrival()).toBe(0);
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(reading);
    controller.startFollowing();
    controller.prepareArrival();
    raf.flushFrame();
    reduced = true;
    raf.flushFrame();
    expect(metrics.scrollTop()).toBe(500);
    expect(raf.pending()).toBe(0);
    controller.dispose();
  });

  it('flushes a cached destination before reveal and cancels its redundant scheduled pass', () => {
    const raf = createRafHarness();
    const metrics = createViewport(900);
    metrics.setScrollTop(0);
    const positions: number[] = [];
    const controller = createFlowerScrollTailController({
      reducedMotionPreferred: () => true,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onLayout: () => positions.push(metrics.scrollTop()),
    });
    controller.bind(metrics.viewport);
    controller.measureAfterLayout();
    controller.flushLayout();
    expect(positions).toEqual([800]);
    expect(raf.pending()).toBe(0);
    raf.flushAll();
    expect(positions).toEqual([800]);
    controller.dispose();
  });

  it('keeps empty presentation at its reading position and follows actual content', () => {
    const raf = createRafHarness();
    let hasContent = false;
    const controller = createFlowerScrollTailController({
      canFollowLatest: () => hasContent,
      reducedMotionPreferred: () => true,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const metrics = createViewport(900);
    metrics.setScrollTop(0);
    controller.bind(metrics.viewport);
    controller.measureAfterLayout();
    controller.scheduleTailScroll({ force: true });
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(0);
    metrics.setScrollTop(120);
    controller.scrollToBottom();
    expect(metrics.scrollTop()).toBe(120);
    hasContent = true;
    controller.scheduleTailScroll();
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(800);
    controller.dispose();
  });

  it('shares one geometry pass across 300 layout and tail notifications and stops when idle', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    raf.flushAll();
    let reads = 0;
    let writes = 0;
    Object.defineProperty(metrics.viewport, 'scrollHeight', { get: () => { reads += 1; return 900; } });
    Object.defineProperty(metrics.viewport, 'scrollTop', {
      get: metrics.scrollTop,
      set: (value: number) => { writes += 1; metrics.setScrollTop(value); },
    });
    for (let index = 0; index < 300; index += 1) {
      controller.measureAfterLayout();
      controller.scheduleTailScroll();
    }
    expect(raf.pending()).toBe(1);
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    raf.flushAll();
    expect(reads).toBe(1);
    expect(writes).toBe(1);
    expect(metrics.scrollTop()).toBe(800);
    expect(raf.pending()).toBe(0);
    controller.dispose();
  });

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

  it('keeps following as short content grows into an overflowing transcript', () => {
    const { controller, raf } = createController();
    const metrics = createViewport(100);
    controller.bind(metrics.viewport);

    for (const height of [100, 100, 340, 620]) {
      metrics.setScrollHeight(height);
      controller.measureAfterLayout();
      raf.flushAll();
      expect(controller.followingLatest()).toBe(true);
      expect(metrics.scrollTop()).toBe(Math.max(0, height - 100));
      expect(controller.showLatest()).toBe(false);
    }
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
    controller.onWheel({ deltaY: -1, target: metrics.viewport } as unknown as WheelEvent);

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
    controller.onWheel({ deltaY: -1, target: metrics.viewport } as unknown as WheelEvent);

    metrics.setScrollHeight(900);
    controller.onWheel({ deltaY: 580, target: metrics.viewport } as unknown as WheelEvent);
    metrics.setScrollTop(800);
    controller.onScroll();
    metrics.setScrollHeight(980);
    controller.measureAfterLayout();
    raf.flushAll();

    expect(metrics.scrollTop()).toBe(880);
    controller.dispose();
  });

  it('keeps a user pause across layout-generated scroll events near the bottom', () => {
    const { controller, raf } = createController();
    const metrics = createViewport();
    controller.bind(metrics.viewport);
    controller.stopFollowing();
    metrics.setScrollTop(399);
    controller.onScroll();
    metrics.setScrollHeight(620);
    controller.measureAfterLayout();
    raf.flushAll();
    expect(metrics.scrollTop()).toBe(399);
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


it('preserves a reader through late layout after the initiating mutation finishes', () => {
  const { controller, raf } = createController();
  const metrics = createViewport(2000);
  metrics.setScrollTop(400);
  let documentTop = 420;
  const title = { isConnected: true, getBoundingClientRect: () => ({ top: documentTop - metrics.scrollTop() }) } as HTMLElement;
  Object.assign(metrics.viewport, { contains: (candidate: unknown) => candidate === title });
  controller.bind(metrics.viewport); controller.stopFollowing();
  controller.preserveLayoutAnchor(title);
  documentTop += 120;
  controller.finishDisclosure(title);
  raf.flushAll();
  expect(title.getBoundingClientRect().top).toBe(20);
  documentTop += 700;
  controller.measureAfterLayout(); raf.flushAll();
  expect(title.getBoundingClientRect().top).toBe(20);
  expect(raf.pending()).toBe(0);
  controller.dispose();
});

it('keeps the original anchor when another completion arrives before its offscreen position is corrected', () => {
  const { controller, raf } = createController();
  const metrics = createViewport(2000); metrics.setScrollTop(400);
  let documentTop = 420;
  const title = { isConnected: true, getBoundingClientRect: () => ({ top: documentTop - metrics.scrollTop(), height: 20 }) } as HTMLElement;
  const inserted = { isConnected: true, getBoundingClientRect: () => ({ top: 25, height: 20 }) } as HTMLElement;
  Object.assign(metrics.viewport, { contains: () => true });
  controller.bind(metrics.viewport); controller.stopFollowing();
  controller.preserveLayoutAnchor(title);
  documentTop += 900;
  controller.preserveLayoutAnchor(inserted);
  documentTop += 180;
  controller.flushLayout();
  expect(title.getBoundingClientRect().top).toBe(20);
  raf.flushAll(); expect(raf.pending()).toBe(0); controller.dispose();
});
