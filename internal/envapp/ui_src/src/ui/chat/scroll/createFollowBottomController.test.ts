// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFollowBottomController,
  type FollowBottomRequest,
  type FollowBottomRequestReason,
} from './createFollowBottomController';

type ObserverRecord = {
  callback: ResizeObserverCallback;
  target: Element | null;
};

function createObserverFactory(records: ObserverRecord[]) {
  return (callback: ResizeObserverCallback) => {
    const record: ObserverRecord = {
      callback,
      target: null,
    };
    records.push(record);
    return {
      observe(target: Element) {
        record.target = target;
      },
      disconnect() {
        record.target = null;
      },
    };
  };
}

function createRafHarness() {
  const queue = new Map<number, FrameRequestCallback>();
  let nextID = 1;
  let nextTimestamp = 16;
  const flushOne = (timestamp = nextTimestamp): void => {
    const first = queue.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!first) return;
    const [id, callback] = first;
    queue.delete(id);
    callback(timestamp);
    nextTimestamp = timestamp + 16;
  };
  const flushAll = (): void => {
    while (queue.size > 0) {
      flushOne();
    }
  };

  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const id = nextID;
      nextID += 1;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      queue.delete(id);
    },
    flushOne,
    flushAll,
  };
}

function defineElementSize(
  element: HTMLElement,
  size: Readonly<{ scrollHeight: () => number; clientHeight: () => number }>,
): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: size.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: size.clientHeight,
  });
}

function installContainerRect(container: HTMLElement, top: number, height: number): void {
  container.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    width: 320,
    height,
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

function installRowRect(
  row: HTMLElement,
  container: HTMLElement,
  metrics: Readonly<{ top: () => number; height: () => number }>,
): void {
  row.getBoundingClientRect = () => {
    const containerRect = container.getBoundingClientRect();
    const top = containerRect.top + metrics.top() - container.scrollTop;
    const height = metrics.height();
    return {
      x: 0,
      y: top,
      width: 320,
      height,
      top,
      bottom: top + height,
      left: 0,
      right: 320,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
}

function followRequest(
  seq: number,
  reason: FollowBottomRequestReason,
  options?: Partial<Pick<FollowBottomRequest, 'source' | 'behavior'>>,
): FollowBottomRequest {
  return {
    seq,
    reason,
    source: options?.source ?? 'system',
    behavior: options?.behavior ?? 'auto',
  };
}

function expectedBottomScrollTop(scrollHeight: number, clientHeight = 120): number {
  return Math.max(0, scrollHeight - clientHeight);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createFollowBottomController', () => {
  it('reasserts bottom follow instead of pausing on non-user scroll events', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(16);
        return 1;
      },
      cancelAnimationFrame() {
        // No-op for test harness.
      },
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 360;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'thread_switch'));

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    expect(controller.mode()).toBe('following');

    scrollContainer.scrollTop = 120;
    controller.handleScroll();

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    controller.dispose();
  });

  it('pauses follow mode only after a recent user scroll intent', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(16);
        return 1;
      },
      cancelAnimationFrame() {
        // No-op for test harness.
      },
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    defineElementSize(scrollContainer, {
      scrollHeight: () => 360,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'thread_switch'));

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 120;
    controller.handleScroll();

    expect(controller.mode()).toBe('paused');
    expect(scrollContainer.scrollTop).toBe(120);
    controller.dispose();
  });

  it('pauses immediately on the first small upward user scroll after a thread-switch follow request', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 240;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'thread_switch'));
    raf.flushOne();

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 104;
    controller.handleScroll();

    expect(controller.mode()).toBe('paused');
    expect(scrollContainer.scrollTop).toBe(104);

    scrollHeight = 320;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);
    raf.flushAll();

    expect(controller.mode()).toBe('paused');
    expect(scrollContainer.scrollTop).toBe(104);
    controller.dispose();
  });

  it('keeps handling resize and explicit follow intents when requestAnimationFrame is synchronous', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(16);
        return 1;
      },
      cancelAnimationFrame() {
        // No-op for test harness.
      },
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 240;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'bootstrap'));

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));

    scrollHeight = 360;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 40;
    controller.handleScroll();
    expect(controller.mode()).toBe('paused');

    scrollHeight = 420;
    controller.requestFollowBottom(followRequest(2, 'send', {
      source: 'user',
      behavior: 'smooth',
    }));

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    controller.dispose();
  });

  it('follows the transcript bottom when an explicit system request arrives', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 320;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);
    scrollContainer.scrollTop = 0;

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'thread_switch'));
    raf.flushAll();

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    expect(controller.distanceToBottomPx()).toBe(0);

    scrollHeight = 420;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);
    raf.flushAll();

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    controller.dispose();
  });

  it('animates user-owned bottom follow across repeated layout growth', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      getPrefersReducedMotion: () => false,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 320;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'send', {
      source: 'user',
      behavior: 'smooth',
    }));

    expect(scrollContainer.scrollTop).toBe(0);

    raf.flushOne();
    expect(scrollContainer.scrollTop).toBeGreaterThan(0);
    expect(scrollContainer.scrollTop).toBeLessThan(expectedBottomScrollTop(scrollHeight));

    raf.flushAll();
    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));

    scrollHeight = 520;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);

    const beforeGrowthAnimation = scrollContainer.scrollTop;
    raf.flushOne();
    expect(scrollContainer.scrollTop).toBeGreaterThan(beforeGrowthAnimation);
    expect(scrollContainer.scrollTop).toBeLessThan(expectedBottomScrollTop(scrollHeight));

    raf.flushAll();
    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    controller.dispose();
  });

  it('cancels animated follow as soon as the user pauses the transcript', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      getPrefersReducedMotion: () => false,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    defineElementSize(scrollContainer, {
      scrollHeight: () => 420,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'send', {
      source: 'user',
      behavior: 'smooth',
    }));

    raf.flushOne();
    const animatedScrollTop = scrollContainer.scrollTop;
    expect(animatedScrollTop).toBeGreaterThan(0);

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 80;
    controller.handleScroll();
    expect(controller.mode()).toBe('paused');

    raf.flushAll();
    expect(scrollContainer.scrollTop).toBe(80);
    controller.dispose();
  });

  it('downgrades smooth follow to instant when reduced motion is enabled', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      getPrefersReducedMotion: () => true,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    const scrollHeight = 420;
    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);
    controller.requestFollowBottom(followRequest(1, 'send', {
      source: 'user',
      behavior: 'smooth',
    }));

    raf.flushAll();

    expect(scrollContainer.scrollTop).toBe(expectedBottomScrollTop(scrollHeight));
    expect(controller.distanceToBottomPx()).toBe(0);
    controller.dispose();
  });

  it('preserves the paused viewport anchor across async content growth', () => {
    const observerRecords: ObserverRecord[] = [];
    const raf = createRafHarness();
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      followThresholdPx: 24,
    });

    const scrollContainer = document.createElement('div');
    const contentRoot = document.createElement('div');
    const row1 = document.createElement('div');
    const row2 = document.createElement('div');
    const row3 = document.createElement('div');
    row1.setAttribute('data-follow-bottom-anchor-id', 'item:1');
    row2.setAttribute('data-follow-bottom-anchor-id', 'item:2');
    row3.setAttribute('data-follow-bottom-anchor-id', 'item:3');
    contentRoot.append(row1, row2, row3);
    scrollContainer.append(contentRoot);
    document.body.append(scrollContainer);

    let scrollHeight = 300;
    const metrics = {
      row1: { top: 0, height: 80 },
      row2: { top: 80, height: 80 },
      row3: { top: 160, height: 80 },
    };

    defineElementSize(scrollContainer, {
      scrollHeight: () => scrollHeight,
      clientHeight: () => 120,
    });
    installContainerRect(scrollContainer, 100, 120);
    installRowRect(row1, scrollContainer, {
      top: () => metrics.row1.top,
      height: () => metrics.row1.height,
    });
    installRowRect(row2, scrollContainer, {
      top: () => metrics.row2.top,
      height: () => metrics.row2.height,
    });
    installRowRect(row3, scrollContainer, {
      top: () => metrics.row3.top,
      height: () => metrics.row3.height,
    });

    controller.setScrollContainer(scrollContainer);
    controller.setContentRoot(contentRoot);

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 100;
    controller.handleScroll();

    expect(controller.mode()).toBe('paused');
    expect(controller.distanceToBottomPx()).toBe(80);

    metrics.row2.top += 40;
    metrics.row3.top += 40;
    scrollHeight = 340;

    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);
    raf.flushAll();

    expect(controller.mode()).toBe('paused');
    expect(scrollContainer.scrollTop).toBe(140);
    expect(controller.distanceToBottomPx()).toBe(80);
    controller.dispose();
  });
});
