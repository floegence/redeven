import { describe, expect, it } from 'vitest';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  decideManagedEnvironmentOpen,
  decideManagedRuntimeLifecycle,
} from './environmentOpenCoordinator';

function health(input: Partial<DesktopRuntimeHealth>): DesktopRuntimeHealth {
  return {
    status: 'offline',
    checked_at_unix_ms: 1,
    source: 'ssh_runtime_probe',
    freshness: 'fresh',
    ...input,
  };
}

describe('managed Environment Open coordination', () => {
  it('opens immediately when the authoritative Runtime record is ready', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: true,
      health: health({ status: 'online' }),
      managementOperations: ['restart', 'update_runtime'],
    })).toEqual({ kind: 'open' });
  });

  it('starts a stopped Runtime when start is advertised', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({ status: 'offline', offline_reason_code: 'not_started' }),
      managementOperations: ['start', 'stop', 'restart', 'update_runtime'],
    })).toEqual({ kind: 'lifecycle', operation: 'start', reason: 'runtime_stopped' });
  });

  it('installs and starts a missing SSH Runtime when update is the only convergence operation', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({ status: 'offline', offline_reason_code: 'not_started' }),
      managementOperations: ['stop', 'update_runtime'],
    })).toEqual({ kind: 'lifecycle', operation: 'update_runtime', reason: 'runtime_missing' });
  });

  it('updates an old Runtime before opening', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({
        status: 'offline',
        runtime_maintenance: {
          kind: 'runtime_update_required',
          required_for: 'open',
          message: 'Runtime update required.',
          recovery_action: 'update_runtime',
          can_desktop_start: true,
          can_desktop_restart: true,
          has_active_work: false,
          active_work_label: '',
        },
      }),
      managementOperations: ['update_runtime'],
    })).toEqual({ kind: 'lifecycle', operation: 'update_runtime', reason: 'runtime_update_required' });
  });

  it('restarts a running but unopenable Runtime before falling back to an update', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({ status: 'online' }),
      managementOperations: ['restart', 'update_runtime'],
    })).toEqual({ kind: 'lifecycle', operation: 'restart', reason: 'runtime_unverified' });
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({ status: 'online' }),
      managementOperations: ['update_runtime'],
    })).toEqual({ kind: 'lifecycle', operation: 'update_runtime', reason: 'runtime_unverified' });
  });

  it('returns an actionable block only when no safe convergence operation exists', () => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: health({ status: 'offline', freshness: 'failed', offline_reason_code: 'probe_failed' }),
      managementOperations: [],
    })).toEqual({
      kind: 'blocked',
      message: 'Desktop could not verify this Runtime, and the target supervisor does not expose a safe recovery operation.',
    });
  });

  it.each([
    {
      name: 'unknown local Runtime state',
      runtimeHealth: health({ status: 'offline', freshness: 'unknown' }),
      expected: { kind: 'lifecycle', operation: 'restart', reason: 'runtime_unverified' },
    },
    {
      name: 'failed SSH Runtime probe',
      runtimeHealth: health({ status: 'offline', freshness: 'failed', offline_reason_code: 'probe_failed' }),
      expected: { kind: 'lifecycle', operation: 'restart', reason: 'runtime_unverified' },
    },
    {
      name: 'stopped local container',
      runtimeHealth: health({ status: 'offline', offline_reason_code: 'container_not_running' }),
      expected: { kind: 'lifecycle', operation: 'start', reason: 'runtime_stopped' },
    },
    {
      name: 'stale Runtime lock',
      runtimeHealth: health({
        status: 'offline',
        runtime_maintenance: {
          kind: 'runtime_stale_lock',
          required_for: 'open',
          message: 'The Runtime lock is stale.',
          recovery_action: 'start_runtime',
          can_desktop_start: true,
          can_desktop_restart: true,
          has_active_work: false,
          active_work_label: '',
        },
      }),
      expected: { kind: 'lifecycle', operation: 'start', reason: 'runtime_stopped' },
    },
  ])('selects one recovery for $name', ({ runtimeHealth, expected }) => {
    expect(decideManagedEnvironmentOpen({
      runtimeReady: false,
      health: runtimeHealth,
      managementOperations: ['start', 'stop', 'restart', 'update_runtime'],
    })).toEqual(expected);
  });
});

describe('explicit managed Runtime lifecycle coordination', () => {
  it('treats start and stop races as already complete', () => {
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'start',
      health: health({ status: 'online' }),
      managementOperations: ['restart', 'stop', 'update_runtime'],
    })).toEqual({ kind: 'complete' });
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'stop',
      health: health({ status: 'offline', offline_reason_code: 'not_started' }),
      managementOperations: ['stop', 'update_runtime'],
    })).toEqual({ kind: 'complete' });
  });

  it('uses install/update to satisfy start or restart when the Runtime is missing', () => {
    const missing = health({ status: 'offline', offline_reason_code: 'not_started' });
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'start',
      health: missing,
      managementOperations: ['stop', 'update_runtime'],
    })).toEqual({ kind: 'execute', operation: 'update_runtime' });
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'restart',
      health: missing,
      managementOperations: ['stop', 'update_runtime'],
    })).toEqual({ kind: 'execute', operation: 'update_runtime' });
  });

  it('never invents an unsupported lifecycle operation', () => {
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'update_runtime',
      health: health({ status: 'online' }),
      managementOperations: ['stop', 'restart'],
    })).toEqual({ kind: 'blocked', message: 'The target supervisor does not support Runtime updates.' });
  });

  it('keeps stop executable when a failed probe cannot prove the Runtime is offline', () => {
    expect(decideManagedRuntimeLifecycle({
      requestedOperation: 'stop',
      health: health({ status: 'offline', freshness: 'failed', offline_reason_code: 'probe_failed' }),
      managementOperations: ['stop', 'update_runtime'],
    })).toEqual({ kind: 'execute', operation: 'stop' });
  });
});
