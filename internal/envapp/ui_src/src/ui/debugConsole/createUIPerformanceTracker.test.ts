// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUIPerformanceTracker } from './createUIPerformanceTracker';
import { publishUIPresentationTransaction } from '../services/uiPresentationTransactions';

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('createUIPerformanceTracker', () => {
  it('summarizes completed presentation transactions by surface and source and drops cancelled work', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const [enabled] = createSignal(true);
    const [detailed] = createSignal(true);
    let tracker!: ReturnType<typeof createUIPerformanceTracker>;
    const dispose = createRoot((disposeRoot) => {
      tracker = createUIPerformanceTracker({ enabled, detailed });
      return disposeRoot;
    });

    const publish = (transactionKey: string, phase: 'requested' | 'intent_presented' | 'commit_started' | 'committed' | 'content_presented' | 'cancelled', elapsedMs: number) => {
      publishUIPresentationTransaction({
        surface: 'terminal',
        source: 'session-nav',
        target: 'session-redacted-id',
        phase,
        transactionKey,
        startedAt: 100,
        timestamp: 100 + elapsedMs,
        elapsedMs,
      });
    };

    for (const [transactionKey, intentMs, commitMs, contentMs] of [
      ['one', 8, 4, 40],
      ['two', 20, 6, 120],
    ] as const) {
      publish(transactionKey, 'requested', 0);
      publish(transactionKey, 'intent_presented', intentMs);
      publish(transactionKey, 'commit_started', intentMs + 1);
      publish(transactionKey, 'committed', intentMs + 1 + commitMs);
      publish(transactionKey, 'content_presented', contentMs);
    }
    publish('cancelled', 'requested', 0);
    publish('cancelled', 'cancelled', 3);

    expect(tracker.snapshot().presentation_transactions).toEqual({
      count: 2,
      summaries: [{
        surface: 'terminal',
        source: 'session-nav',
        count: 2,
        intent_paint: { p50_ms: 8, p95_ms: 20, max_ms: 20 },
        commit: { p50_ms: 4, p95_ms: 6, max_ms: 6 },
        content_paint: { p50_ms: 40, p95_ms: 120, max_ms: 120 },
      }],
    });
    expect(tracker.snapshot().recent_events[0]).toMatchObject({
      kind: 'ui_presentation_transaction',
      detail: {
        surface: 'terminal',
        source: 'session-nav',
        target: 'session-redacted-id',
        content_paint_ms: 120,
      },
    });

    dispose();
  });

  it('ignores debug console self-mutations', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const [enabled] = createSignal(true);
    const [detailed] = createSignal(true);
    let tracker!: ReturnType<typeof createUIPerformanceTracker>;

    const dispose = createRoot((disposeRoot) => {
      tracker = createUIPerformanceTracker({ enabled, detailed });
      return disposeRoot;
    });

    const debugConsoleRoot = document.createElement('div');
    debugConsoleRoot.className = 'debug-console-window';
    document.body.appendChild(debugConsoleRoot);
    debugConsoleRoot.appendChild(document.createElement('div'));

    await tick();
    await tick();

    expect(tracker.snapshot().dom_activity.mutation_batches).toBe(0);
    expect(tracker.snapshot().dom_activity.mutation_records).toBe(0);

    dispose();
  });

  it('still tracks non-debug-console mutations', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const [enabled] = createSignal(true);
    const [detailed] = createSignal(true);
    let tracker!: ReturnType<typeof createUIPerformanceTracker>;

    const dispose = createRoot((disposeRoot) => {
      tracker = createUIPerformanceTracker({ enabled, detailed });
      return disposeRoot;
    });

    const regularNode = document.createElement('div');
    document.body.appendChild(regularNode);
    regularNode.textContent = 'tracked mutation';

    await tick();
    await tick();

    expect(tracker.snapshot().dom_activity.mutation_batches).toBeGreaterThan(0);
    expect(tracker.snapshot().dom_activity.mutation_records).toBeGreaterThan(0);

    dispose();
  });
});
