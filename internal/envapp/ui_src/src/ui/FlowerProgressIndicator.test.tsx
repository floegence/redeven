// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { mapFlowerProviderRequestProgress } from '../../../../flower_ui/src/providerRequestProgress';

import {
  FlowerProgressIndicator,
  type FlowerProgressIndicatorState,
} from '../../../../flower_ui/src/chat/FlowerProgressIndicator';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderIndicator() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [progress, setProgress] = createSignal<FlowerProgressIndicatorState | null>({
    kind: 'waiting_response',
    runID: 'run-1',
  });
  const [label, setLabel] = createSignal('Waiting for model response...');
  disposers.push(render(() => (
    <FlowerProgressIndicator progress={progress()} label={label()} outputCopy={DEFAULT_FLOWER_SURFACE_COPY.chat.outputProgress} />
  ), host));
  return { host, setProgress, setLabel };
}

describe('FlowerProgressIndicator', () => {
  it('shows elapsed time at exactly three seconds, stops at output, and resets for a new attempt', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const { host, setProgress } = renderIndicator();
    const request = mapFlowerProviderRequestProgress({ logical_request_id: 'request-1', attempt_id: 'attempt-1', attempt_epoch: 1,
      started_at: '2026-01-01T00:00:00Z', estimated_output_tokens: 0 }, Date.parse('2026-01-01T00:00:00Z'));
    setProgress({ kind: 'waiting_response', runID: 'run-1', request });
    await vi.advanceTimersByTimeAsync(2999);
    expect(host.querySelector('.flower-model-status-metric')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(host.querySelector('.flower-model-status-metric')?.textContent).toContain('3 s');
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.querySelector('.flower-model-status-metric')?.textContent).toContain('5 s');
    const indicator = host.querySelector('.flower-model-status-indicator');
    setProgress({ kind: 'streaming', runID: 'run-1', request: { ...request, first_output_at: '2026-01-01T00:00:05Z', estimated_output_tokens: 128 } });
    await flushEffects();
    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    const metric = host.querySelector('.flower-model-status-metric');
    expect(metric?.textContent).toContain('128 tokens');
    expect(metric?.getAttribute('title')).toContain('Estimated');
    expect(metric?.closest('[aria-live="polite"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(metric?.textContent).toContain('128 tokens');
    setProgress({ kind: 'retrying', runID: 'run-1', request });
    expect(host.querySelector('.flower-model-status-metric')).toBeNull();
    setProgress({ kind: 'waiting_response', runID: 'run-1', request: { ...request, attempt_id: 'attempt-2', wait_anchor_monotonic_ms: performance.now() } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(host.querySelector('.flower-model-status-metric')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(host.querySelector('.flower-model-status-metric')?.textContent).toContain('3 s');
  });

  it('keeps the server-sampled waiting age when a cached thread is reopened', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const { host, setProgress } = renderIndicator();
    const request = mapFlowerProviderRequestProgress({ logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
      started_at: '2026-01-01T00:00:00Z', estimated_output_tokens: 0 }, Date.parse('2026-01-01T00:00:07Z'));
    setProgress({ kind: 'waiting_response', runID: 'run-1', request });
    expect(host.textContent).toContain('7 s');
    setProgress(null);
    await vi.advanceTimersByTimeAsync(5000);
    setProgress({ kind: 'waiting_response', runID: 'run-1', request });
    expect(host.textContent).toContain('12 s');
    setProgress({ kind: 'tool_execution', runID: 'run-1', request });
    expect(host.querySelector('.flower-model-status-metric')).toBeNull();
  });
  it('renders only canonical run progress', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const [progress, setProgress] = createSignal<FlowerProgressIndicatorState | null>(null);
    disposers.push(render(() => <FlowerProgressIndicator progress={progress()} label="Waiting for model response" />, host));
    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();
    setProgress({ kind: 'preparing', runID: 'run-1' });
    await flushEffects();
    expect(host.querySelector('.flower-model-status-indicator')?.getAttribute('data-flower-progress-run-id')).toBe('run-1');
    setProgress(null);
    await flushEffects();
    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('keeps the indicator, Flower, and dots DOM nodes while one run changes phase', async () => {
    const { host, setProgress, setLabel } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');
    const flower = indicator?.querySelector('.flower-model-status-flower');
    const dots = indicator?.querySelector('.flower-model-status-dots');
    const text = indicator?.querySelector('.flower-model-status-text');
    expect(text?.getAttribute('data-floe-progress-shimmer')).toBe('text');

    batch(() => {
      setProgress({ kind: 'streaming', runID: 'run-1' });
      setLabel('Thinking...');
    });
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.querySelector('.flower-model-status-flower')).toBe(flower);
    expect(indicator?.querySelector('.flower-model-status-dots')).toBe(dots);
    expect(indicator?.querySelector('[data-floe-progress-shimmer="text"]')).toBe(text);
    expect(indicator?.getAttribute('data-flower-progress-kind')).toBe('streaming');
    expect(indicator?.textContent).toContain('Thinking');
  });

  it('clears when upstream run progress clears', async () => {
    const { host, setProgress } = renderIndicator();
    await flushEffects();

    setProgress(null);
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(host.querySelector('[data-floe-progress-shimmer]')).toBeNull();
  });

  it('remounts only when the real run identity changes', async () => {
    const { host, setProgress } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    setProgress({ kind: 'preparing', runID: 'run-2' });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBeNull();
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-flower-progress-run-id')).toBe('run-2');
  });
});
