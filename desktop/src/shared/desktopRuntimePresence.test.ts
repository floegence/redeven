import { describe, expect, it } from 'vitest';

import { buildDesktopRuntimeOperationPlans } from './desktopRuntimeOperationPlanner';
import {
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  desktopRuntimeControlStatusOwnerMismatch,
} from './desktopRuntimePresence';

const hostPlacement = { kind: 'host_process' as const, runtime_root: '' };
const localContainerPlacement = {
  kind: 'container_process' as const,
  container_engine: 'docker' as const,
  container_id: 'abc123',
  container_ref: 'redeven-nginx-dev',
  container_label: 'redeven-nginx-dev',
  runtime_root: '/root/.redeven',
  bridge_strategy: 'exec_stream' as const,
};

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
        ...localContainerPlacement,
        container_ref: 'web',
        container_label: 'web',
      },
      running: false,
      openable: false,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'container_not_running',
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
      availability: 'blocked',
      reason_code: 'runtime_target_unavailable',
      menu_visibility: 'stable',
      message: 'Container web is not running.',
    });
    expect(plans.update).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      menu_visibility: 'stable',
      message: 'Container web is not running.',
    });
  });

  it('blocks container lifecycle actions when the local container engine CLI is unavailable', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: {
        ...localContainerPlacement,
        container_ref: 'web',
        container_label: 'web',
      },
      running: false,
      openable: false,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'container_engine_unavailable',
        'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
      ),
    });

    expect(plans.open).toMatchObject({
      availability: 'blocked',
      reason_code: 'runtime_target_unavailable',
      message: 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
    });
    expect(plans.start).toMatchObject({
      availability: 'blocked',
      reason_code: 'runtime_target_unavailable',
      message: 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
    });
    expect(plans.update).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      message: 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
    });
    expect(plans.refresh.availability).toBe('available');
  });

  it('offers Start for a stopped container runtime when the container target is reachable', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: localContainerPlacement,
      running: false,
      openable: false,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Start this runtime before connecting it to a provider.',
      ),
    });

    expect(plans.open).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      reason_code: 'runtime_not_started',
      message: 'Start this runtime before opening it.',
    });
    expect(plans.start).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      menu_visibility: 'contextual',
    });
    expect(plans.stop).toMatchObject({
      availability: 'unavailable',
      reason_code: 'runtime_not_started',
      menu_visibility: 'stable',
    });
    expect(plans.restart).toMatchObject({
      availability: 'available',
      menu_visibility: 'stable',
    });
    expect(plans.update).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      menu_visibility: 'stable',
    });
  });

  it('keeps Start and Restart available while exposing outdated runtime update as a separate action', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: localContainerPlacement,
      running: false,
      openable: false,
      package_state: {
        state: 'outdated',
        current_version: 'v0.5.9',
        target_version: 'v0.6.7',
      },
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Start this runtime before connecting it to a provider.',
      ),
    });

    expect(plans.open).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      message: 'Start this runtime before opening it.',
    });
    expect(plans.start).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
    });
    expect(plans.restart).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
    });
    expect(plans.update).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      reason_code: 'runtime_update_required',
      menu_visibility: 'stable',
    });
  });

  it('keeps Open available for compatibility update blocks while preserving Update as a separate operation', () => {
    for (const [compatibility, reasonCode] of [
      ['update_required', 'runtime_update_required'],
      ['desktop_update_required', 'desktop_update_required'],
    ] as const) {
      const plans = buildDesktopRuntimeOperationPlans({
        surface: 'managed_runtime_card',
        host_access: { kind: 'local_host' },
        placement: hostPlacement,
        running: true,
        openable: false,
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: false,
          compatibility,
          open_readiness: {
            state: 'blocked',
            reason_code: reasonCode,
            message: 'The runtime rejected Desktop compatibility.',
          },
          active_workload: {
            terminal_count: 0,
            session_count: 0,
            task_count: 0,
            port_forward_count: 0,
          },
        },
        runtime_control_status: desktopRuntimeControlStatusAvailable(),
      });

      expect(plans.open).toMatchObject({
        availability: 'available',
        method: 'local_host',
      });
      expect(plans.update).toMatchObject({
        availability: 'available',
        method: 'desktop_local_update_handoff',
        menu_visibility: 'stable',
      });
    }
  });

  it('keeps Open available while a running runtime is preparing Env App readiness', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: hostPlacement,
      running: true,
      openable: false,
      runtime_service: {
        protocol_version: 'redeven-runtime-v1',
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        remote_enabled: false,
        compatibility: 'compatible',
        open_readiness: {
          state: 'starting',
          reason_code: 'env_app_gateway_starting',
          message: 'Env App gateway is starting.',
        },
        active_workload: {
          terminal_count: 0,
          session_count: 0,
          task_count: 0,
          port_forward_count: 0,
        },
      },
      runtime_control_status: desktopRuntimeControlStatusAvailable(),
    });

    expect(plans.open).toMatchObject({
      availability: 'available',
      method: 'local_host',
    });
  });

  it('does not let open-level update maintenance lock a compatible Open attempt', () => {
    const maintenance = {
      kind: 'runtime_update_required' as const,
      required_for: 'open' as const,
      recovery_action: 'update_runtime' as const,
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: false,
      active_work_label: 'No active work',
      message: 'Update this runtime before opening it with this Desktop.',
    };
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: hostPlacement,
      running: true,
      openable: false,
      runtime_service: {
        protocol_version: 'redeven-runtime-v1',
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        remote_enabled: false,
        compatibility: 'update_required',
        open_readiness: {
          state: 'blocked',
          reason_code: 'runtime_update_required',
          message: 'The runtime rejected Desktop compatibility.',
        },
        active_workload: {
          terminal_count: 0,
          session_count: 0,
          task_count: 0,
          port_forward_count: 0,
        },
      },
      runtime_control_status: desktopRuntimeControlStatusAvailable(),
      maintenance,
    });

    expect(plans.open).toMatchObject({
      availability: 'available',
      method: 'local_host',
    });
  });

  it('guides running container runtime-control failures through Restart while preserving Stop and Update', () => {
    const maintenance = {
      kind: 'runtime_restart_required' as const,
      required_for: 'open' as const,
      recovery_action: 'restart_runtime' as const,
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: 'Existing runtime work may be active',
      attach_state: 'live_process_without_management_socket',
      failure_code: 'management_socket_unreachable',
      lock_pid: 4242,
      message: 'A Redeven runtime process is alive, but its management socket is not reachable.',
    };
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: localContainerPlacement,
      running: true,
      openable: true,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_reported',
        'Restart this runtime from Desktop so runtime-control can be prepared.',
      ),
      maintenance,
    });

    expect(plans.open).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      message: maintenance.message,
      maintenance,
    });
    expect(plans.stop).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      menu_visibility: 'stable',
    });
    expect(plans.restart).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      message: maintenance.message,
      menu_visibility: 'stable',
    });
    expect(plans.update).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      message: maintenance.message,
      menu_visibility: 'stable',
    });
  });

  it('treats stale lock container recovery as stopped-like runtime management', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: localContainerPlacement,
      running: false,
      openable: false,
      runtime_control_status: desktopRuntimeControlStatusMissing(
        'not_started',
        'Runtime lock metadata is present but no live runtime is reachable.',
      ),
      maintenance: {
        kind: 'runtime_stale_lock',
        required_for: 'open',
        recovery_action: 'start_runtime',
        can_desktop_start: true,
        can_desktop_restart: false,
        has_active_work: false,
        active_work_label: 'No active work',
        attach_state: 'stale_lock',
        failure_code: 'lock_pid_not_alive',
        lock_pid: 4321,
        message: 'Runtime lock metadata is present but no live runtime is reachable.',
      },
    });

    expect(plans.open).toMatchObject({
      availability: 'blocked',
      method: 'local_container_exec',
      message: 'Start this runtime before opening it.',
    });
    expect(plans.start).toMatchObject({
      availability: 'available',
      method: 'local_container_exec',
      menu_visibility: 'contextual',
    });
    expect(plans.restart).toMatchObject({
      availability: 'available',
      menu_visibility: 'stable',
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
        ...localContainerPlacement,
        container_ref: 'web',
        container_label: 'web',
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
      placement: localContainerPlacement,
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
