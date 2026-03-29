/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';

let currentMessages: Message[] = [];
let currentScrollRequest: { seq: number; behavior: 'auto' | 'smooth'; source: 'system' | 'user' } | null = null;

const scrollToBottomMock = vi.fn();
const loadMoreHistoryMock = vi.fn();
const setMessageHeightMock = vi.fn();
const getMessageHeightMock = vi.fn(() => 120);
const onScrollMock = vi.fn();
const setItemHeightMock = vi.fn();
let virtualScrollElement: HTMLElement | null = null;

type MockResizeObserverInstance = {
  callback: ResizeObserverCallback;
  elements: Set<Element>;
};

const resizeObserverInstances: MockResizeObserverInstance[] = [];

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    messages: () => currentMessages,
    isWorking: () => false,
    isLoadingHistory: () => false,
    hasMoreHistory: () => false,
    loadMoreHistory: loadMoreHistoryMock,
    config: () => ({ showListWorkingIndicator: false }),
    virtualListConfig: () => ({ defaultItemHeight: 120, overscan: 2, loadThreshold: 2 }),
    getMessageHeight: getMessageHeightMock,
    setMessageHeight: setMessageHeightMock,
    scrollToBottomRequest: () => currentScrollRequest,
    requestScrollToBottom: vi.fn(),
    heightCache: new Map<string, number>(),
  }),
}));

vi.mock('../hooks/useVirtualList', () => ({
  useVirtualList: () => ({
    containerRef: vi.fn(),
    scrollRef: (element: HTMLElement) => {
      virtualScrollElement = element;
    },
    onScroll: onScrollMock,
    virtualItems: () => currentMessages.map((message, index) => ({ index, key: message.id, start: index * 120, size: 120, end: (index + 1) * 120 })),
    visibleRange: () => ({ start: 0, end: Math.max(0, currentMessages.length - 1) }),
    paddingTop: () => 0,
    paddingBottom: () => 0,
    getItemOffset: (index: number) => index * 120,
    setItemHeight: setItemHeightMock,
    scrollToBottom: () => {
      if (virtualScrollElement) {
        virtualScrollElement.scrollTop = Math.max(
          0,
          virtualScrollElement.scrollHeight - virtualScrollElement.clientHeight,
        );
      }
      scrollToBottomMock();
    },
  }),
}));

vi.mock('../message/MessageItem', () => ({
  MessageItem: (props: { message: Message }) => <div data-testid={`message-${props.message.id}`}>{props.message.id}</div>,
}));

vi.mock('../status/WorkingIndicator', () => ({
  WorkingIndicator: () => <div data-testid="working-indicator" />,
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function triggerResize(target: Element, height = 180): void {
  const observer = resizeObserverInstances.find((instance) => instance.elements.has(target));
  if (!observer) {
    throw new Error('ResizeObserver target not found');
  }
  observer.callback([
    {
      target,
      contentRect: { width: 0, height, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, toJSON: () => ({}) },
      contentBoxSize: [{ blockSize: height, inlineSize: 0 }],
    } as unknown as ResizeObserverEntry,
  ], {} as ResizeObserver);
}

function createRafHarness() {
  const callbacks: Array<FrameRequestCallback | null> = [];
  let nextHandle = 1;
  let nextTimestamp = 16;

  return {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks[handle] = callback;
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      callbacks[handle] = null;
    },
    flushNext(): void {
      const handle = callbacks.findIndex((callback, index) => index > 0 && callback !== null);
      if (handle <= 0) return;
      const callback = callbacks[handle];
      callbacks[handle] = null;
      callback?.(nextTimestamp);
      nextTimestamp += 16;
    },
    flushAll(): void {
      while (callbacks.some((callback, index) => index > 0 && callback !== null)) {
        this.flushNext();
      }
    },
  };
}

describe('VirtualMessageList', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    currentMessages = [];
    currentScrollRequest = null;
    virtualScrollElement = null;
    resizeObserverInstances.length = 0;

    const raf = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.stubGlobal('ResizeObserver', class {
      private readonly instance: MockResizeObserverInstance;

      constructor(callback: ResizeObserverCallback) {
        this.instance = {
          callback,
          elements: new Set<Element>(),
        };
        resizeObserverInstances.push(this.instance);
      }

      observe = (element: Element) => {
        this.instance.elements.add(element);
      };

      unobserve = (element: Element) => {
        this.instance.elements.delete(element);
      };

      disconnect = () => {
        this.instance.elements.clear();
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps follow-bottom active when the active assistant row grows', async () => {
    const mod = await import('./VirtualMessageList');
    currentMessages = [
      {
        id: 'm_ai_live_1',
        renderKey: 'active-run:thread-1',
        role: 'assistant',
        status: 'streaming',
        timestamp: 100,
        blocks: [{ type: 'markdown', content: 'Hello Flower' }],
      },
    ];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <mod.VirtualMessageList />, host);

    try {
      await flushAsync();

      const scroller = host.querySelector('.chat-message-list-scroll') as HTMLDivElement | null;
      const item = host.querySelector('.chat-message-list-item') as HTMLDivElement | null;

      expect(scroller).toBeTruthy();
      expect(item).toBeTruthy();

      let scrollTop = 120;
      let scrollHeight = 520;
      let clientHeight = 400;
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      triggerResize(scroller!, 400);
      await flushAsync();

      scrollToBottomMock.mockClear();
      onScrollMock.mockClear();

      scrollHeight = 620;
      triggerResize(item!, 220);
      await flushAsync();

      expect(setMessageHeightMock).toHaveBeenCalledWith('active-run:thread-1', 220);
      expect(scrollTop).toBe(220);
      expect(scrollToBottomMock).not.toHaveBeenCalled();
      expect(onScrollMock).toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('follows live tail growth without mutating virtual row height bookkeeping', async () => {
    const mod = await import('./VirtualMessageList');
    currentMessages = [
      {
        id: 'm_ai_settled_1',
        role: 'assistant',
        status: 'complete',
        timestamp: 100,
        blocks: [{ type: 'markdown', content: 'Settled transcript row' }],
      },
    ];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const TestTail = () => (
      <div class="chat-message-list-item">
        <div data-testid="live-tail">Streaming tail</div>
      </div>
    );

    const dispose = render(() => (
      <mod.VirtualMessageList
        tailVisible
        tailComponent={TestTail}
      />
    ), host);

    try {
      await flushAsync();

      const scroller = host.querySelector('.chat-message-list-scroll') as HTMLDivElement | null;
      const tail = host.querySelector('.chat-message-list-tail') as HTMLDivElement | null;

      expect(scroller).toBeTruthy();
      expect(tail).toBeTruthy();

      let scrollTop = 120;
      let scrollHeight = 520;
      let clientHeight = 400;
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      triggerResize(scroller!, 400);
      triggerResize(tail!, 120);
      await flushAsync();

      scrollToBottomMock.mockClear();
      setMessageHeightMock.mockClear();
      setItemHeightMock.mockClear();
      onScrollMock.mockClear();

      scrollHeight = 620;
      triggerResize(tail!, 220);
      await flushAsync();

      expect(setMessageHeightMock).not.toHaveBeenCalled();
      expect(setItemHeightMock).not.toHaveBeenCalled();
      expect(scrollTop).toBe(220);
      expect(scrollToBottomMock).not.toHaveBeenCalled();
      expect(onScrollMock).toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('preserves the bottom anchor when the transcript viewport height changes mid-run', async () => {
    const mod = await import('./VirtualMessageList');
    currentMessages = [
      {
        id: 'm_ai_live_resize_1',
        renderKey: 'active-run:thread-resize',
        role: 'assistant',
        status: 'streaming',
        timestamp: 100,
        blocks: [{ type: 'markdown', content: 'Hello Flower' }],
      },
    ];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <mod.VirtualMessageList />, host);

    try {
      await flushAsync();

      const scroller = host.querySelector('.chat-message-list-scroll') as HTMLDivElement | null;

      expect(scroller).toBeTruthy();

      let scrollTop = 120;
      let scrollHeight = 520;
      let clientHeight = 400;
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      triggerResize(scroller!, 400);
      await flushAsync();

      scrollToBottomMock.mockClear();
      onScrollMock.mockClear();

      clientHeight = 360;
      triggerResize(scroller!, 360);
      await flushAsync();

      expect(scrollHeight).toBe(520);
      expect(scrollTop).toBe(160);
      expect(scrollToBottomMock).not.toHaveBeenCalled();
      expect(onScrollMock).toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('animates user-triggered follow-bottom requests instead of snapping immediately', async () => {
    const raf = createRafHarness();
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);

    const mod = await import('./VirtualMessageList');
    currentMessages = [];
    currentScrollRequest = { seq: 1, behavior: 'smooth', source: 'user' };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <mod.VirtualMessageList />, host);

    try {
      await Promise.resolve();
      await Promise.resolve();

      const scroller = host.querySelector('.chat-message-list-scroll') as HTMLDivElement | null;
      expect(scroller).toBeTruthy();

      let scrollTop = 0;
      const scrollHeight = 620;
      const clientHeight = 400;
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      triggerResize(scroller!, clientHeight);
      raf.flushNext();

      expect(scrollTop).toBeGreaterThan(0);
      expect(scrollTop).toBeLessThan(scrollHeight - clientHeight);

      raf.flushAll();
      expect(scrollTop).toBe(scrollHeight - clientHeight);
    } finally {
      dispose();
    }
  });

  it('keeps system follow-bottom requests instant during restore flows', async () => {
    const raf = createRafHarness();
    vi.stubGlobal('requestAnimationFrame', raf.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', raf.cancelAnimationFrame);

    const mod = await import('./VirtualMessageList');
    currentMessages = [];
    currentScrollRequest = { seq: 1, behavior: 'auto', source: 'system' };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <mod.VirtualMessageList />, host);

    try {
      await Promise.resolve();
      await Promise.resolve();

      const scroller = host.querySelector('.chat-message-list-scroll') as HTMLDivElement | null;
      expect(scroller).toBeTruthy();

      let scrollTop = 0;
      const scrollHeight = 620;
      const clientHeight = 400;
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => clientHeight,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      triggerResize(scroller!, clientHeight);
      raf.flushNext();

      expect(scrollTop).toBe(scrollHeight - clientHeight);
    } finally {
      dispose();
    }
  });
});
