import { describe, expect, it } from 'vitest';

import { canReuseFreshRuntimeOpenPreflight } from './runtimeOpenPreflight';
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
