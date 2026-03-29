// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFollowBottomController,
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
  const queue: FrameRequestCallback[] = [];
  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      queue.push(callback);
      return queue.length;
    },
    cancelAnimationFrame(): void {
      // No-op for test harness.
    },
    flushAll(): void {
      while (queue.length > 0) {
        const callback = queue.shift();
        callback?.(0);
      }
    },
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createFollowBottomController', () => {
  it('reasserts bottom follow instead of pausing on non-user scroll events', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(0);
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
    controller.requestFollowBottom({ seq: 1, reason: 'thread_switch' });

    expect(scrollContainer.scrollTop).toBe(360);
    expect(controller.mode()).toBe('following');

    scrollContainer.scrollTop = 120;
    controller.handleScroll();

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(360);
    controller.dispose();
  });

  it('pauses follow mode only after a recent user scroll intent', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(0);
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
    controller.requestFollowBottom({ seq: 1, reason: 'thread_switch' });

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 120;
    controller.handleScroll();

    expect(controller.mode()).toBe('paused');
    expect(scrollContainer.scrollTop).toBe(120);
    controller.dispose();
  });

  it('keeps handling resize and explicit follow intents when requestAnimationFrame is synchronous', () => {
    const observerRecords: ObserverRecord[] = [];
    const controller = createFollowBottomController({
      createResizeObserver: createObserverFactory(observerRecords),
      requestAnimationFrame(callback) {
        callback(0);
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
    controller.requestFollowBottom({ seq: 1, reason: 'bootstrap' });

    expect(scrollContainer.scrollTop).toBe(240);

    scrollHeight = 360;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);

    expect(scrollContainer.scrollTop).toBe(360);

    scrollContainer.dispatchEvent(new Event('wheel'));
    scrollContainer.scrollTop = 40;
    controller.handleScroll();
    expect(controller.mode()).toBe('paused');

    scrollHeight = 420;
    controller.requestFollowBottom({ seq: 2, reason: 'send' });

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(420);
    controller.dispose();
  });

  it('follows the transcript bottom when an explicit request arrives', () => {
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
    controller.requestFollowBottom({ seq: 1, reason: 'thread_switch' });
    raf.flushAll();

    expect(controller.mode()).toBe('following');
    expect(scrollContainer.scrollTop).toBe(scrollHeight);
    expect(controller.distanceToBottomPx()).toBe(0);

    scrollHeight = 420;
    const contentObserver = observerRecords.find((record) => record.target === contentRoot);
    contentObserver?.callback([], {} as ResizeObserver);
    raf.flushAll();

    expect(scrollContainer.scrollTop).toBe(scrollHeight);
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
