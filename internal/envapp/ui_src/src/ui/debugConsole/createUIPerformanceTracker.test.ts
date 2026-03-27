// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUIPerformanceTracker } from './createUIPerformanceTracker';

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('createUIPerformanceTracker', () => {
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
