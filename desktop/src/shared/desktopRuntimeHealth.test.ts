import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeMaintenanceFromBlockedLaunchReport,
  normalizeDesktopRuntimeMaintenanceRequirement,
} from './desktopRuntimeHealth';

describe('desktopRuntimeHealth', () => {
  it('normalizes runtime maintenance requirements', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: ' desktop_model_source_requires_runtime_update ',
      required_for: ' desktop_model_source ',
      recovery_action: ' update_runtime ',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: ' 1 terminal ',
      current_runtime_version: ' v0.5.9 ',
      target_runtime_version: ' v0.6.7 ',
      attach_state: ' live_process_without_management_socket ',
      failure_code: ' management_socket_unreachable ',
      lock_pid: 1234,
      message: ' Update required. ',
    })).toEqual({
      kind: 'desktop_model_source_requires_runtime_update',
      required_for: 'desktop_model_source',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: '1 terminal',
      current_runtime_version: 'v0.5.9',
      target_runtime_version: 'v0.6.7',
      attach_state: 'live_process_without_management_socket',
      failure_code: 'management_socket_unreachable',
      lock_pid: 1234,
      message: 'Update required.',
    });
  });

  it('rejects legacy SSH-named maintenance kinds', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'ssh_runtime_restart_required',
      message: 'legacy',
    })).toBeUndefined();
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'ssh_runtime_update_required',
      message: 'legacy',
    })).toBeUndefined();
  });

  it('maps stale lock blocked reports to start recovery', () => {
    expect(desktopRuntimeMaintenanceFromBlockedLaunchReport({
      code: 'stale_lock',
      message: 'Runtime lock metadata is present but no live runtime is reachable.',
      diagnostics: {
        attach_state: 'stale_lock',
        failure_code: 'lock_pid_not_alive',
        lock_pid: 4321,
      },
    })).toEqual({
      kind: 'runtime_stale_lock',
      required_for: 'open',
      recovery_action: 'start_runtime',
      can_desktop_start: true,
      can_desktop_restart: false,
      has_active_work: false,
      active_work_label: 'No active work',
      current_runtime_version: undefined,
      target_runtime_version: undefined,
      attach_state: 'stale_lock',
      failure_code: 'lock_pid_not_alive',
      lock_pid: 4321,
      message: 'Runtime lock metadata is present but no live runtime is reachable.',
    });
  });

  it('maps live blocked reports to restart recovery', () => {
    expect(desktopRuntimeMaintenanceFromBlockedLaunchReport({
      code: 'live_process_without_management_socket',
      message: 'A runtime process is alive but not reachable.',
      lock_owner: {
        pid: 4321,
        desktop_managed: true,
      },
      diagnostics: {
        attach_state: 'live_process_without_management_socket',
        failure_code: 'management_socket_unreachable',
      },
    }, {
      target_runtime_version: 'v0.6.7',
    })).toMatchObject({
      kind: 'runtime_restart_required',
      required_for: 'open',
      recovery_action: 'restart_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: 'Existing runtime work may be active',
      target_runtime_version: 'v0.6.7',
      attach_state: 'live_process_without_management_socket',
      failure_code: 'management_socket_unreachable',
      lock_pid: 4321,
      message: 'A runtime process is alive but not reachable.',
    });
  });

  it('rejects unknown maintenance kinds', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'unknown',
      message: 'nope',
    })).toBeUndefined();
  });
});
