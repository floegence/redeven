import { describe, expect, it } from 'vitest';

import { buildDesktopRuntimeOperationPlans } from './desktopRuntimeOperationPlanner';

describe('desktopRuntimeOperationPlanner', () => {
  it('keeps direct access open while requiring Gateway setup for managed lifecycle', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'ssh_host', ssh: {
        ssh_destination: 'runtime.example',
        ssh_port: 22,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 10,
      } },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      running: true,
      openable: true,
    });

    expect(plans.open).toMatchObject({ availability: 'available', method: 'ssh_host' });
    for (const operation of ['start', 'stop', 'restart', 'update'] as const) {
      expect(plans[operation]).toMatchObject({
        availability: 'blocked',
        method: 'runtime_gateway',
        reason_code: 'runtime_gateway_setup_required',
      });
      expect(plans[operation].message).toContain('Set up Runtime management');
    }
  });

  it('does not expose lifecycle actions when the connection cannot host a supervisor', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'external_local_ui',
      running: true,
      openable: true,
    });

    expect(plans.open.availability).toBe('available');
    expect(plans.start.availability).toBe('hidden');
    expect(plans.stop.availability).toBe('hidden');
    expect(plans.restart.availability).toBe('hidden');
    expect(plans.update.availability).toBe('hidden');
  });

  it('leaves workload confirmation to Gateway preflight without projecting client ownership', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      running: true,
      openable: false,
      maintenance: {
        kind: 'runtime_restart_required',
        required_for: 'open',
        recovery_action: 'restart_runtime',
        can_desktop_start: false,
        can_desktop_restart: true,
        has_active_work: true,
        active_work_label: 'Active work may be interrupted',
        message: 'Runtime restart is required before opening.',
      },
    });

    expect(plans.open.availability).toBe('blocked');
    expect(plans.start.requires_confirmation).toBe(false);
    expect(plans.stop.requires_confirmation).toBe(false);
    expect(plans.restart.requires_confirmation).toBe(false);
    expect(plans.update.requires_confirmation).toBe(false);
    expect(JSON.stringify(plans)).not.toContain('owner');
    expect(JSON.stringify(plans)).not.toContain('takeover');
  });
});
