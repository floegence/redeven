import { describe, expect, it, vi } from 'vitest';

import { canReuseFreshRuntimeOpenPreflight, canAttemptKnownRuntimeBridge, runtimeOpenHasManagementEvidence, createRuntimeOpenConnectionBudget } from './runtimeOpenPreflight';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH, type RuntimeServiceSnapshot } from '../shared/runtimeService';

function runtimeService(overrides: Partial<RuntimeServiceSnapshot> = {}): RuntimeServiceSnapshot {
  return {
    runtime_version: 'v1.2.3',
    runtime_commit: 'runtime-commit',
    runtime_build_time: 'runtime-build',
    compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH,
    compatibility: 'compatible',
    open_readiness: { state: 'openable' },
    remote_enabled: false,
    active_workload: {
      terminal_count: 0,
      session_count: 0,
      task_count: 0,
      port_forward_count: 0,
    },
    ...overrides,
  };
}

function health(overrides: Partial<DesktopRuntimeHealth> = {}): DesktopRuntimeHealth {
  return {
    status: 'online',
    source: 'ssh_runtime_probe',
    freshness: 'fresh',
    checked_at_unix_ms: 10_000,
    runtime_pid: 4242,
    started_at_unix_ms: 8_000,
    runtime_service: runtimeService(),
    ...overrides,
  };
}

function ready(overrides: Parameters<typeof canReuseFreshRuntimeOpenPreflight>[1] = {}) {
  return {
    runtime_pid: 4242,
    runtime_started_at_unix_ms: 8_000,
    runtime_service: runtimeService(),
    ...overrides,
  };
}

describe('runtimeOpenPreflight', () => {
  it('reuses only a fresh openable observation for the same Runtime process and build', () => {
    expect(canReuseFreshRuntimeOpenPreflight(health(), ready(), 39_999)).toBe(true);
    expect(canReuseFreshRuntimeOpenPreflight(health(), ready(), 40_000)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health({ status: 'offline' }), ready(), 10_001)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health({
      runtime_service: runtimeService({ open_readiness: { state: 'starting' } }),
    }), ready(), 10_001)).toBe(false);
  });

  it('rejects missing or changed Runtime process identity', () => {
    expect(canReuseFreshRuntimeOpenPreflight(health({ runtime_pid: undefined }), ready(), 10_001)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health(), ready({ runtime_pid: 4243 }), 10_001)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health({ started_at_unix_ms: undefined }), ready(), 10_001)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health(), ready({ runtime_started_at_unix_ms: 8_001 }), 10_001)).toBe(false);
  });

  it('rejects a Runtime build mismatch in either observation', () => {
    expect(canReuseFreshRuntimeOpenPreflight(health({
      runtime_service: runtimeService({ runtime_commit: 'new-commit' }),
    }), ready(), 10_001)).toBe(false);
    expect(canReuseFreshRuntimeOpenPreflight(health(), ready({
      runtime_service: runtimeService({ runtime_build_time: 'other-build' }),
    }), 10_001)).toBe(false);
  });
});

describe('bridge-first opening', () => {
  it('uses a known openable placement as a dial hint without depending on observation age', () => {
    expect(canAttemptKnownRuntimeBridge(ready())).toBe(true);
    expect(canAttemptKnownRuntimeBridge(null)).toBe(false);
    expect(canAttemptKnownRuntimeBridge(ready({ runtime_service: runtimeService({ compatibility: 'update_required' }) }))).toBe(false);
  });
  it('does not infer lifecycle authority from an unreachable or unverified target', () => {
    for (const offline_reason_code of ['probe_failed', 'runtime_disconnected', 'unverified', 'auth_required'] as const) {
      expect(runtimeOpenHasManagementEvidence(health({ status: 'offline', offline_reason_code }))).toBe(false);
    }
    expect(runtimeOpenHasManagementEvidence(health({ status: 'offline', offline_reason_code: 'not_started' }))).toBe(true);
  });
});


describe('Runtime Open connection budget', () => {
  it('shares one deadline across observations and connection stages', async () => {
    vi.useFakeTimers();
    const budget = createRuntimeOpenConnectionBudget(undefined, 100);
    try {
      await budget.wait(Promise.resolve('known placement'));
      await vi.advanceTimersByTimeAsync(75);
      const stalled = budget.wait(new Promise<void>(() => undefined));
      const rejected = expect(stalled).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(budget.signal.aborted).toBe(true);
    } finally { budget.dispose(); vi.useRealTimers(); }
  });

  it('cancels a shared observation without admitting its late result', async () => {
    const cancel = new AbortController();
    const budget = createRuntimeOpenConnectionBudget(cancel.signal);
    let finish!: () => void;
    let admitted = false;
    try {
      const pending = budget.wait(new Promise<void>(resolve => { finish = resolve; })).then(() => { admitted = true; });
      cancel.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      finish(); await Promise.resolve();
      expect(admitted).toBe(false);
    } finally { budget.dispose(); }
  });

  it('releases the deadline before handing an established connection to its session', async () => {
    vi.useFakeTimers();
    const budget = createRuntimeOpenConnectionBudget(undefined, 100);
    budget.dispose();
    await vi.advanceTimersByTimeAsync(101);
    expect(budget.signal.aborted).toBe(false);
    vi.useRealTimers();
  });
});
