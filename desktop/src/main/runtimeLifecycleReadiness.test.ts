import { describe, expect, it, vi } from 'vitest';

import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import { waitForDesktopRuntimeLifecycleReadiness } from './runtimeLifecycleReadiness';

function health(
  status: DesktopRuntimeHealth['status'],
  freshness: NonNullable<DesktopRuntimeHealth['freshness']> = 'fresh',
): DesktopRuntimeHealth {
  return {
    status,
    freshness,
    checked_at_unix_ms: 10,
    source: 'local_runtime_probe',
    ...(status === 'online'
      ? {
          runtime_service: {
            protocol_version: 'redeven-runtime-v2',
            compatibility_epoch: 9,
            effective_run_mode: 'desktop',
            remote_enabled: false,
            compatibility: 'compatible' as const,
            open_readiness: { state: 'openable' as const },
            active_workload: {
              terminal_count: 0,
              session_count: 0,
              task_count: 0,
              port_forward_count: 0,
            },
          },
        }
      : {
          offline_reason_code: 'not_started' as const,
          offline_reason: 'Runtime is not running.',
        }),
  };
}

describe('Desktop Runtime lifecycle readiness', () => {
  it.each(['initialize', 'start', 'restart', 'update_runtime'] as const)(
    'waits through stale offline health after %s until the Runtime is openable',
    async (operation) => {
      const observations = [health('offline'), health('online')];
      const wait = vi.fn(async () => undefined);

      await expect(waitForDesktopRuntimeLifecycleReadiness({
        operation,
        observe: async () => observations.shift(),
        wait,
        maxAttempts: 3,
      })).resolves.toMatchObject({ status: 'online' });
      expect(wait).toHaveBeenCalledOnce();
    },
  );

  it('waits for a fresh offline observation after stop', async () => {
    const observations = [health('online'), health('offline', 'checking'), health('offline')];
    const wait = vi.fn(async () => undefined);

    await expect(waitForDesktopRuntimeLifecycleReadiness({
      operation: 'stop',
      observe: async () => observations.shift(),
      wait,
      maxAttempts: 4,
    })).resolves.toMatchObject({ status: 'offline', freshness: 'fresh' });
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('fails with the final probe reason when readiness never converges', async () => {
    const wait = vi.fn(async () => undefined);

    await expect(waitForDesktopRuntimeLifecycleReadiness({
      operation: 'start',
      observe: async () => health('offline'),
      wait,
      maxAttempts: 2,
    })).rejects.toThrow('Runtime is not running.');
    expect(wait).toHaveBeenCalledOnce();
  });
});
