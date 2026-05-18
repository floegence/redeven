import { describe, expect, it } from 'vitest';

import { buildDesktopRuntimeOperationPlans } from './desktopRuntimeOperationPlanner';
import {
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  desktopRuntimeControlStatusOwnerMismatch,
} from './desktopRuntimePresence';

const hostPlacement = { kind: 'host_process' as const, runtime_root: '' };

describe('desktopRuntimePresence', () => {
  it('uses explicit operation plans for running managed runtimes', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: hostPlacement,
      running: true,
      openable: true,
      runtime_control_status: desktopRuntimeControlStatusAvailable(),
    });

    expect(plans.stop).toMatchObject({
      availability: 'available',
      label: 'Stop runtime',
      method: 'local_host',
      menu_visibility: 'stable',
    });
    expect(plans.start.availability).toBe('unavailable');
    expect(plans.start.menu_visibility).toBe('hidden');
    expect(plans.restart).toMatchObject({
      availability: 'available',
      method: 'local_host',
      menu_visibility: 'stable',
    });
    expect(plans.update).toMatchObject({
      availability: 'available',
      label: 'Update Redeven Desktop',
      method: 'desktop_local_update_handoff',
      menu_visibility: 'stable',
    });
    expect(plans.refresh.availability).toBe('available');
  });

  it('keeps host management available when runtime-control owner mismatches', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'ssh_host', ssh: {
        ssh_destination: 'devbox',
        ssh_port: 22,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 10,
      } },
      placement: hostPlacement,
      running: true,
      openable: true,
      runtime_control_status: desktopRuntimeControlStatusOwnerMismatch('Owned by another Desktop.'),
    });

    expect(plans.stop).toMatchObject({
      availability: 'available',
      method: 'ssh_host',
      menu_visibility: 'stable',
    });
    expect(plans.update).toMatchObject({
      availability: 'available',
      method: 'ssh_host',
      label: 'Update runtime',
      menu_visibility: 'stable',
    });
    expect(plans.connect_provider).toMatchObject({
      availability: 'blocked',
      reason_code: 'runtime_control_owner_mismatch',
    });
  });

  it('blocks container start when the management target itself is unavailable', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'abc123',
        container_ref: 'web',
        container_label: 'web',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      running: false,
      openable: false,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'forward_unavailable',
        'Container web is not running.',
      ),
    });

    expect(plans.start).toMatchObject({
      availability: 'blocked',
      reason_code: 'runtime_target_unavailable',
      message: 'Container web is not running.',
      menu_visibility: 'contextual',
    });
    expect(plans.stop).toMatchObject({
      availability: 'unavailable',
      menu_visibility: 'stable',
      message: 'Runtime is not running.',
    });
    expect(plans.restart).toMatchObject({
      availability: 'unavailable',
      menu_visibility: 'stable',
      message: 'Runtime is not running.',
    });
    expect(plans.update).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      menu_visibility: 'stable',
      message: 'Container web is not running.',
    });
  });

  it('keeps provider cards out of runtime lifecycle management', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'provider_card',
      running: true,
      openable: true,
    });

    expect(plans.open).toMatchObject({
      availability: 'available',
      method: 'provider_tunnel',
    });
    for (const operation of ['start', 'stop', 'restart', 'update'] as const) {
      expect(plans[operation]).toMatchObject({
        availability: 'hidden',
        method: 'none',
        menu_visibility: 'hidden',
      });
    }
  });

  it('routes container updates through the host/container management channel', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'ssh_host', ssh: {
        ssh_destination: 'devbox',
        ssh_port: 22,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 10,
      } },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'abc123',
        container_ref: 'web',
        container_label: 'web',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      running: true,
      openable: true,
      runtime_control_status: desktopRuntimeControlStatusAvailable(),
    });

    expect(plans.update).toMatchObject({
      availability: 'available',
      label: 'Update runtime',
      method: 'ssh_container_exec',
      menu_visibility: 'stable',
    });
  });

  it('allows Open while keeping provider link blocked when a ready container still needs an Open connection', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'abc123',
        container_ref: 'redeven-nginx-dev',
        container_label: 'redeven-nginx-dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      running: true,
      openable: false,
      open_connection_required: true,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'forward_unavailable',
        'Open this runtime to prepare the Desktop bridge and provider connection.',
      ),
    });

    expect(plans.open).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
    });
    expect(plans.start).toMatchObject({
      availability: 'unavailable',
      reason_code: 'runtime_already_running',
    });
    expect(plans.connect_provider).toMatchObject({
      availability: 'blocked',
      reason_code: 'runtime_control_missing',
      message: 'Open this runtime to prepare the Desktop bridge and provider connection.',
    });
  });

  it('uses explicit runtime-control status values without exposing tokens', () => {
    expect(desktopRuntimeControlStatusAvailable()).toEqual({
      state: 'available',
      owner: 'current_desktop',
    });
    expect(desktopRuntimeControlStatusMissing('not_reported', '')).toMatchObject({
      state: 'missing',
      reason_code: 'not_reported',
    });
    expect(desktopRuntimeControlStatusOwnerMismatch('')).toMatchObject({
      state: 'owner_mismatch',
      owner: 'other_desktop',
    });
  });
});
