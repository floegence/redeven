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
    scrollRef: vi.fn(),
    onScroll: onScrollMock,
    virtualItems: () => currentMessages.map((message, index) => ({ index, key: message.id, start: index * 120, size: 120, end: (index + 1) * 120 })),
    visibleRange: () => ({ start: 0, end: Math.max(0, currentMessages.length - 1) }),
    paddingTop: () => 0,
    paddingBottom: () => 0,
    getItemOffset: (index: number) => index * 120,
    setItemHeight: setItemHeightMock,
    scrollToBottom: scrollToBottomMock,
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

describe('VirtualMessageList', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    currentMessages = [];
    currentScrollRequest = null;
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
      Object.defineProperty(scroller!, 'scrollHeight', {
        configurable: true,
        get: () => 520,
      });
      Object.defineProperty(scroller!, 'clientHeight', {
        configurable: true,
        get: () => 400,
      });
      Object.defineProperty(scroller!, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });

      scrollToBottomMock.mockClear();

      triggerResize(item!, 220);
      await flushAsync();

      expect(setMessageHeightMock).toHaveBeenCalledWith('active-run:thread-1', 220);
      expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });
});
