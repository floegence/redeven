import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { FlowerLiveStreamEnvelope, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([[1100, 'stop'], [420, 'stop'], [1100, 'success'], [420, 'failure']] as const)('keeps provider recovery in one turn at width %s through %s', async (width, outcome) => {
  await page.viewport(width, 850);
  const threadID = `retry-${width}`;
  const runID = 'run-retry';
  const turnID = 'turn-retry';
  let selected = thread({ thread_id: threadID, status: 'running', active_run_id: runID,
    run_progress: { run_id: runID, turn_id: turnID, phase: 'streaming' },
    messages: [{ id: 'draft-old', role: 'assistant', turn_id: turnID, run_id: runID, status: 'streaming', live: true, content: 'Failed draft fragment', created_at_ms: 1 }],
  });
  let emit: ((value: FlowerLiveStreamEnvelope | null) => void) | undefined;
  let version = 1;
  const retryThread = vi.fn(async () => liveBootstrap(selected, version));
  const base = { ...adapter(true), retryThread, listThreads: vi.fn(async () => [selected]), loadThread: vi.fn(async () => liveBootstrap(selected, version)),
    async *connectLiveStream({ signal }: { signal: AbortSignal }) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [selected] };
      while (!signal.aborted) {
        const event = await new Promise<FlowerLiveStreamEnvelope | null>(resolve => { emit = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
        if (!event) return;
        emit = undefined;
        yield event;
      }
    },
  };
  const push = async (next: FlowerThreadSnapshot) => {
    selected = next; version += 1;
    await waitFor(() => emit != null);
    emit!({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: runtimeCurrentView(next, version) });
  };
  const stopThread = vi.fn(async () => { await push({ ...selected, status: 'canceled', active_run_id: undefined, run_progress: null }); });
  const surface = renderSurfaceWithAdapterProps({ ...base, stopThread }, { focusThreadRequest: { request_id: 'focus-retry', thread_id: threadID } });
  surface.style.cssText = `width:${width}px;height:820px;position:relative`;
  await waitFor(() => surface.textContent?.includes('Failed draft fragment') ?? false);
  const nextAttemptAt = new Date(Date.now() + 3500).toISOString();
  const retry = { retry: 1, max_retries: 4, next_attempt_at: nextAttemptAt, reason: 'stream_interrupted', replaced_attempt_id: 'attempt-old', replaced_attempt_epoch: 1 };
  await push({ ...selected, messages: [], run_progress: { run_id: runID, turn_id: turnID, phase: 'retrying', retry } });
  const indicator = () => surface.querySelector<HTMLElement>('[data-flower-progress-kind="retrying"]');
  await waitFor(() => indicator()?.textContent?.includes('Regenerating') ?? false);
  expect(surface.textContent).not.toContain('Failed draft fragment');
  expect(indicator()?.textContent).toContain('1/4');
  const firstLabel = indicator()!.textContent;
  await vi.waitFor(() => expect(indicator()!.textContent).not.toBe(firstLabel), { timeout: 2500 });
  expect(surface.querySelectorAll('.flower-error-card')).toHaveLength(0);
  // Reopening reads the same deadline and attempt, rather than starting another recovery.
  const reopened = renderSurfaceWithAdapterProps({ ...base, stopThread }, { focusThreadRequest: { request_id: 'reopen-retry', thread_id: threadID } });
  reopened.style.cssText = `width:${width}px;height:820px;position:relative`;
  await waitFor(() => reopened.querySelector('[data-flower-progress-kind="retrying"]')?.textContent?.includes('1/4') ?? false);
  expect(reopened.textContent).not.toContain('Failed draft fragment');
  const stop = surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
  expect(stop.getAttribute('aria-label')).toBe('Stop');
  expect(stop.disabled).toBe(false);
  const progressRect = indicator()!.getBoundingClientRect();
  expect(progressRect.right).toBeLessThanOrEqual(surface.getBoundingClientRect().right + 1);
  await page.screenshot({ element: surface, path: `__screenshots__/provider-retry-${width}.png` });
  expect(retryThread).not.toHaveBeenCalled();
  if (outcome === 'stop') {
    reopened.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
    await waitFor(() => stopThread.mock.calls.length === 1);
  } else if (outcome === 'success') {
    await push({ ...selected, status: 'success', active_run_id: undefined, run_progress: null, messages: [{ id: 'recovered', role: 'assistant', turn_id: turnID, run_id: runID, status: 'complete', content: 'Recovered answer', created_at_ms: 2 }] });
    await waitFor(() => reopened.textContent?.includes('Recovered answer') ?? false);
    expect(reopened.querySelector('[data-flower-progress-kind="retrying"]')).toBeNull();
    expect(reopened.querySelectorAll('.flower-error-card')).toHaveLength(0);
    expect(retryThread).not.toHaveBeenCalled();
  } else {
    await push({ ...selected, status: 'failed', active_run_id: undefined, run_progress: null,
      messages: [{ id: 'final-partial', role: 'assistant', turn_id: turnID, run_id: runID, status: 'error', content: 'Last unfinished fragment', created_at_ms: 2 }],
      error: { code: 'provider_server_error', message: 'Service unavailable', detail: '{"http_status":500,"request_id":"req-final"}' },
    });
    await waitFor(() => reopened.querySelector('.flower-error-card') != null);
    expect(reopened.querySelectorAll('.flower-error-card')).toHaveLength(1);
    expect(reopened.querySelector('[data-flower-progress-kind="retrying"]')).toBeNull();
    expect(reopened.textContent).toContain('Last unfinished fragment');
    expect(reopened.querySelector('[data-flower-message-status="error"]')?.textContent).toContain('Last unfinished fragment');
    const retryButton = [...reopened.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent?.includes('Retry'));
    expect(retryButton).toBeDefined();
    retryButton!.click();
    await waitFor(() => retryThread.mock.calls.length === 1);
  }
});
