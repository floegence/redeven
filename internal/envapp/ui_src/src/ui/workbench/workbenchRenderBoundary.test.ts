import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT,
  requestWorkbenchRenderTransaction,
  subscribeWorkbenchRenderTransactions,
} from './workbenchRenderBoundary';

type TestWindow = EventTarget & typeof globalThis;

describe('workbenchRenderBoundary', () => {
  beforeEach(() => {
    vi.stubGlobal('CustomEvent', class TestCustomEvent<T = unknown> extends Event {
      readonly detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    });
    vi.stubGlobal('window', new EventTarget() as TestWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches normalized render transactions through a window-scoped contract', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkbenchRenderTransactions(listener);

    const transaction = requestWorkbenchRenderTransaction('theme', { frameCount: 12 });

    expect(transaction).toMatchObject({
      reason: 'theme',
      frameCount: 4,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(transaction);

    unsubscribe();
  });

  it('ignores malformed render transaction events', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkbenchRenderTransactions(listener);

    globalThis.window.dispatchEvent(new CustomEvent(REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT, {
      detail: { reason: 'unknown', frameCount: 1 },
    }));

    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });
});
