import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalApiError } from '../services/localApi';
import {
  aiReadinessFromLocalApiError,
  createAIReadinessController,
  normalizeAIReadinessSnapshot,
  type AIReadinessSnapshot,
} from './aiReadiness';

const ready = (): AIReadinessSnapshot => ({
  state: 'ready',
  reason_code: '',
  retryable: false,
  safe_to_retry: false,
  committed: false,
  rolled_back: false,
});

const inspecting = (): AIReadinessSnapshot => ({
  state: 'inspecting',
  reason_code: '',
  retryable: false,
  safe_to_retry: false,
  committed: false,
  rolled_back: false,
});

const busy = (): AIReadinessSnapshot => ({
  state: 'blocked',
  reason_code: 'temporarily_blocked',
  retryable: true,
  safe_to_retry: true,
  committed: false,
  rolled_back: false,
});

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TestVisibilitySource {
  visibilityState: DocumentVisibilityState = 'visible';
  private listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('AI readiness model', () => {
  it('preserves safe diagnostics while startup is inspecting', () => {
    expect(normalizeAIReadinessSnapshot({
      state: 'inspecting',
      reason_code: '',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
      trace_id: 'ai-start-3',
      startup_phase: 'inspecting',
    })).toEqual({
      state: 'inspecting',
      reason_code: '',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
      trace_id: 'ai-start-3',
      startup_phase: 'inspecting',
    });
  });

  it('preserves safe recovering diagnostics without exposing raw storage details', () => {
    expect(normalizeAIReadinessSnapshot({
      state: 'recovering',
      reason_code: 'temporarily_blocked',
      retryable: true,
      safe_to_retry: true,
      committed: false,
      rolled_back: false,
      trace_id: 'ai-start-2a',
      startup_phase: 'recovering',
      retry_reason: 'temporary_store_open',
      raw_path: '/private/agent.sqlite',
    })).toEqual({
      state: 'recovering',
      reason_code: 'temporarily_blocked',
      retryable: true,
      safe_to_retry: true,
      committed: false,
      rolled_back: false,
      trace_id: 'ai-start-2a',
      startup_phase: 'recovering',
      retry_reason: 'temporary_store_open',
    });
  });

  it('accepts only a counted host-settings degraded state', () => {
    expect(normalizeAIReadinessSnapshot({
      state: 'degraded', reason_code: 'host_thread_settings_missing', issue_count: 2,
      retryable: false, safe_to_retry: false, committed: false, rolled_back: false,
    })).toEqual({
      state: 'degraded', reason_code: 'host_thread_settings_missing', issue_count: 2,
      retryable: false, safe_to_retry: false, committed: false, rolled_back: false,
    });
    expect(normalizeAIReadinessSnapshot({
      state: 'degraded', reason_code: 'host_thread_settings_missing', issue_count: 0,
      retryable: false, safe_to_retry: false, committed: false, rolled_back: false,
    }).state).toBe('blocked');
  });

  it('normalizes only the six sanitized wire facts', () => {
    expect(normalizeAIReadinessSnapshot({
      state: 'blocked',
      reason_code: ' store_io_error ',
      retryable: true,
      safe_to_retry: true,
      committed: false,
      rolled_back: false,
      secret_path: '/private/store.db',
    })).toEqual({
      state: 'blocked',
      reason_code: 'store_io_error',
      retryable: true,
      safe_to_retry: true,
      committed: false,
      rolled_back: false,
    });

  });

  it.each([
    { ...busy(), state: 'future_state' },
    { ...busy(), reason_code: 'database /private/store.db' },
    { ...ready(), reason_code: 'future_reason' },
    { ...busy(), retryable: 1 },
    { ...busy(), committed: true, rolled_back: true },
    { ...busy(), retryable: false, safe_to_retry: true },
    { ...busy(), reason_code: 'migration_rolled_back', rolled_back: false },
    { ...busy(), reason_code: 'temporarily_blocked', rolled_back: true },
    { ...busy(), reason_code: 'post_commit_verification_error', committed: false },
    { ...busy(), reason_code: 'store_io_error', committed: true },
    { ...ready(), reason_code: 'store_io_error', committed: true },
    { state: 'ready' },
    null,
  ])('fails closed for an unknown or malformed contract: %#', (value) => {
    expect(normalizeAIReadinessSnapshot(value)).toEqual({
      state: 'blocked',
      reason_code: 'ai_readiness_contract_error',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
    });
  });

  it('extracts error facts only from LocalApiError.data.readiness', () => {
    expect(aiReadinessFromLocalApiError(new LocalApiError({
      message: 'irrelevant',
      data: { readiness: busy() },
    }))).toEqual(busy());

    expect(aiReadinessFromLocalApiError(new Error(JSON.stringify({ readiness: ready() })))).toBeNull();
    expect(aiReadinessFromLocalApiError(new LocalApiError({
      message: JSON.stringify({ readiness: ready() }),
      data: null,
    }))).toBeNull();
  });
});

describe('createAIReadinessController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start or report an in-flight load when autoStart is false', async () => {
    const request = vi.fn(async () => ready());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      autoStart: false,
    });

    await flushAsync();
    expect(request).not.toHaveBeenCalled();
    expect(controller.loading()).toBe(false);

    await controller.refresh();
    expect(request).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('loads the current typed snapshot from the readiness endpoint', async () => {
    const request = vi.fn(async () => ready());
    const controller = createAIReadinessController({ request, visibilitySource: null });

    expect(controller.loading()).toBe(true);
    await flushAsync();

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/_redeven_proxy/api/ai/readiness', { method: 'GET' });
    expect(controller.loading()).toBe(false);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('fails closed when a synchronous request transport returns no readiness payload', async () => {
    const request = vi.fn(() => undefined);
    const refreshController = createAIReadinessController({
      request,
      visibilitySource: null,
      autoStart: false,
    });

    await expect(refreshController.refresh()).resolves.toEqual({
      state: 'blocked',
      reason_code: 'ai_readiness_contract_error',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
    });
    expect(refreshController.loading()).toBe(false);
    refreshController.dispose();

    const retryController = createAIReadinessController({
      request,
      visibilitySource: null,
      autoStart: false,
    });
    await expect(retryController.retry()).resolves.toEqual({
      state: 'blocked',
      reason_code: 'ai_readiness_contract_error',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
    });
    expect(retryController.retryPending()).toBe(false);
    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
      ['/_redeven_proxy/api/ai/readiness/retry', { method: 'POST' }],
    ]);
    retryController.dispose();
  });

  it('maps a synchronous request throw through the readiness failure boundary', async () => {
    const request = vi.fn(() => {
      throw new Error('synchronous transport failure');
    });
    const controller = createAIReadinessController({ request, visibilitySource: null });

    await flushAsync();

    expect(controller.snapshot()).toEqual({
      state: 'blocked',
      reason_code: 'ai_readiness_contract_error',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
    });
    expect(controller.loading()).toBe(false);
    controller.dispose();
  });

  it('uses LocalApiError.data.readiness without parsing its message', async () => {
    const request = vi.fn(async () => {
      throw new LocalApiError({
        message: JSON.stringify({ readiness: ready() }),
        data: { readiness: busy() },
      });
    });
    const controller = createAIReadinessController({ request, visibilitySource: null, maxAutomaticRetries: 0 });

    await flushAsync();

    expect(controller.snapshot()).toEqual(busy());
    controller.dispose();
  });

  it('caps automatic retries for a safe temporary block', async () => {
    const request = vi.fn(async () => busy());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      maxAutomaticRetries: 2,
    });
    await flushAsync();

    await vi.advanceTimersByTimeAsync(10);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(10);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
      ['/_redeven_proxy/api/ai/readiness/retry', { method: 'POST' }],
      ['/_redeven_proxy/api/ai/readiness/retry', { method: 'POST' }],
    ]);
    expect(controller.retryPending()).toBe(false);
    controller.dispose();
  });

  it('does not POST an automatic retry without current permission', async () => {
    const request = vi.fn(async () => busy());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      maxAutomaticRetries: 2,
      canAutomaticallyRetry: () => false,
    });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();

    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
    ]);
    expect(controller.nextCheckAt()).toBeNull();
    controller.dispose();
  });

  it('rechecks current permission before a scheduled automatic retry POST', async () => {
    let canAutomaticallyRetry = true;
    const request = vi.fn(async () => busy());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      maxAutomaticRetries: 2,
      canAutomaticallyRetry: () => canAutomaticallyRetry,
    });
    await flushAsync();
    expect(controller.nextCheckAt()).toBe(Date.now() + 10);

    canAutomaticallyRetry = false;
    await vi.advanceTimersByTimeAsync(10);
    await flushAsync();

    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
    ]);
    expect(controller.nextCheckAt()).toBeNull();
    controller.dispose();
  });

  it('publishes and clears the next scheduled check time', async () => {
    const retryResponse = deferred<AIReadinessSnapshot>();
    const request = vi.fn((url: string) => (
      url.endsWith('/retry') ? retryResponse.promise : Promise.resolve(inspecting())
    ));
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 25,
    });
    await flushAsync();

    expect(controller.nextCheckAt()).toBe(Date.now() + 25);
    const retryPromise = controller.retry();
    expect(controller.nextCheckAt()).toBeNull();

    retryResponse.resolve(ready());
    await retryPromise;
    expect(controller.nextCheckAt()).toBeNull();
    controller.dispose();
  });

  it('resets the bounded automatic retry quota after reaching ready', async () => {
    const responses: AIReadinessSnapshot[] = [
      busy(),
      busy(),
      ready(),
      busy(),
      ready(),
    ];
    const request = vi.fn(async (_url: string, _init: RequestInit) => responses.shift() ?? ready());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      maxAutomaticRetries: 1,
    });
    await flushAsync();

    await vi.advanceTimersByTimeAsync(10);
    await flushAsync();
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/retry'))).toHaveLength(1);
    expect(controller.nextCheckAt()).toBeNull();

    await controller.refresh();
    expect(controller.snapshot()).toEqual(ready());
    await controller.refresh();
    expect(controller.snapshot()).toEqual(busy());

    await vi.advanceTimersByTimeAsync(10);
    await flushAsync();
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/retry'))).toHaveLength(2);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('polls transient states more slowly while hidden and reschedules on visibility changes', async () => {
    const visibilitySource = new TestVisibilitySource();
    visibilitySource.setVisibility('hidden');
    const request = vi.fn(async () => inspecting());
    const controller = createAIReadinessController({
      request,
      visibilitySource,
      foregroundDelayMs: 10,
      backgroundDelayMs: 100,
    });
    await flushAsync();

    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(1);

    visibilitySource.setVisibility('visible');
    await vi.advanceTimersByTimeAsync(9);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(visibilitySource.listenerCount()).toBe(0);
  });

  it('deduplicates manual retries and exposes pending state synchronously', async () => {
    const retryResponse = deferred<AIReadinessSnapshot>();
    const request = vi.fn((url: string) => {
      if (url.endsWith('/retry')) return retryResponse.promise;
      return Promise.resolve(busy());
    });
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      maxAutomaticRetries: 0,
    });
    await flushAsync();

    const first = controller.retry();
    const second = controller.retry();
    const refreshDuringRetry = controller.refresh();
    expect(first).toBe(second);
    expect(first).toBe(refreshDuringRetry);
    expect(controller.retryPending()).toBe(true);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/retry'))).toHaveLength(1);

    retryResponse.resolve(ready());
    await first;
    expect(controller.retryPending()).toBe(false);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('does not allow an older request generation to overwrite a retry result', async () => {
    const initialResponse = deferred<AIReadinessSnapshot>();
    const request = vi.fn((url: string) => (
      url.endsWith('/retry') ? Promise.resolve(ready()) : initialResponse.promise
    ));
    const controller = createAIReadinessController({ request, visibilitySource: null, maxAutomaticRetries: 0 });

    await controller.retry();
    expect(controller.snapshot()).toEqual(ready());
    expect(controller.loading()).toBe(false);

    initialResponse.resolve(busy());
    await flushAsync();
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('pauses an in-flight generation and prevents its late result from scheduling polls', async () => {
    const firstResponse = deferred<AIReadinessSnapshot>();
    const request = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue(ready());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      autoStart: false,
      initialPaused: true,
    });

    const firstRefresh = controller.resume();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.loading()).toBe(true);

    controller.pause();
    expect(controller.loading()).toBe(false);
    expect(controller.nextCheckAt()).toBeNull();
    expect(controller.snapshot().state).toBe('unavailable');
    await controller.refresh();
    await controller.retry();
    expect(request).toHaveBeenCalledTimes(1);

    firstResponse.resolve(inspecting());
    await firstRefresh;
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().state).toBe('unavailable');

    await controller.resume();
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('blocks manual requests until an initially paused controller is resumed', async () => {
    const request = vi.fn().mockResolvedValue(ready());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      initialPaused: true,
    });

    expect(controller.loading()).toBe(false);
    await controller.refresh();
    await controller.retry();
    expect(request).not.toHaveBeenCalled();

    await controller.resume();
    await controller.resume();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('clears a scheduled automatic retry while paused and resumes with one GET', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(busy())
      .mockResolvedValue(ready());
    const controller = createAIReadinessController({
      request,
      visibilitySource: null,
      foregroundDelayMs: 10,
      maxAutomaticRetries: 2,
      initialPaused: true,
    });
    await controller.resume();
    expect(controller.nextCheckAt()).toBe(Date.now() + 10);

    controller.pause();
    await vi.advanceTimersByTimeAsync(100);
    await controller.retry();
    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
    ]);
    expect(controller.nextCheckAt()).toBeNull();

    await controller.resume();
    expect(request.mock.calls).toEqual([
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
      ['/_redeven_proxy/api/ai/readiness', { method: 'GET' }],
    ]);
    expect(controller.snapshot()).toEqual(ready());
    controller.dispose();
  });

  it('stops timers, listeners, and late publications when disposed', async () => {
    const visibilitySource = new TestVisibilitySource();
    const response = deferred<AIReadinessSnapshot>();
    const request = vi.fn(() => response.promise);
    const controller = createAIReadinessController({
      request,
      visibilitySource,
      foregroundDelayMs: 10,
    });

    const beforeDispose = controller.snapshot();
    controller.dispose();
    response.resolve(inspecting());
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.snapshot()).toEqual(beforeDispose);
    expect(request).toHaveBeenCalledTimes(1);
    expect(visibilitySource.listenerCount()).toBe(0);
  });
});
