import { describe, expect, it } from 'vitest';

import {
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceForRuntimeService,
  desktopRuntimeMaintenanceFromBlockedLaunchReport,
  normalizeDesktopRuntimeMaintenanceRequirement,
} from './desktopRuntimeHealth';
import type { RuntimeServiceSnapshot } from './runtimeService';

const openableRuntimeService: RuntimeServiceSnapshot = {
  protocol_version: 'redeven-runtime-v1',
  service_owner: 'desktop',
  desktop_managed: true,
  effective_run_mode: 'desktop',
  remote_enabled: false,
  compatibility: 'compatible',
  open_readiness: { state: 'openable' },
  active_workload: {
    terminal_count: 0,
    session_count: 0,
    task_count: 0,
    port_forward_count: 0,
  },
  capabilities: {
    desktop_model_source: { supported: false },
    provider_link: { supported: true, bind_method: 'runtime_control_v1' },
  },
};

const blockedRuntimeService: RuntimeServiceSnapshot = {
  ...openableRuntimeService,
  open_readiness: {
    state: 'blocked',
    reason_code: 'runtime_control_missing',
    message: 'Runtime-control is not reachable.',
  },
};

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

  it('classifies not-running blocked reports as stopped without maintenance', () => {
    const report = {
      code: 'not_running',
      message: 'Runtime daemon is not running.',
      diagnostics: {
        attach_state: 'not_running',
      },
    };
    expect(classifyDesktopRuntimeBlockedLaunchReport(report)).toMatchObject({
      kind: 'stopped',
      reason: 'not_running',
      message: 'Runtime daemon is not running.',
      attach_state: 'not_running',
    });
    expect(desktopRuntimeMaintenanceFromBlockedLaunchReport(report)).toBeUndefined();
  });

  it('classifies stale lock blocked reports as stopped-like recovery without maintenance', () => {
    const report = {
      code: 'stale_lock',
      message: 'Runtime lock metadata is present but no live runtime is reachable.',
      diagnostics: {
        attach_state: 'stale_lock',
        failure_code: 'lock_pid_not_alive',
        lock_pid: 4321,
      },
    };
    expect(classifyDesktopRuntimeBlockedLaunchReport(report)).toMatchObject({
      kind: 'stopped',
      reason: 'stale_lock',
      attach_state: 'stale_lock',
      failure_code: 'lock_pid_not_alive',
      lock_pid: 4321,
      message: 'Runtime lock metadata is present but no live runtime is reachable.',
    });
    expect(desktopRuntimeMaintenanceFromBlockedLaunchReport(report)).toBeUndefined();
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

  it('drops open maintenance once runtime service is openable', () => {
    expect(desktopRuntimeMaintenanceForRuntimeService({
      kind: 'runtime_restart_required',
      required_for: 'open',
      recovery_action: 'restart_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: 'Existing runtime work may be active',
      message: 'Restart this runtime before opening it.',
    }, openableRuntimeService)).toBeUndefined();
  });

  it('keeps Desktop model source maintenance for openable runtime services', () => {
    expect(desktopRuntimeMaintenanceForRuntimeService({
      kind: 'desktop_model_source_requires_runtime_update',
      required_for: 'desktop_model_source',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: '1 terminal',
      target_runtime_version: 'v0.6.7',
      message: 'Update runtime before connecting Desktop model source.',
    }, openableRuntimeService)).toMatchObject({
      kind: 'desktop_model_source_requires_runtime_update',
      required_for: 'desktop_model_source',
      target_runtime_version: 'v0.6.7',
    });
  });

  it('keeps open maintenance while runtime service is not openable', () => {
    expect(desktopRuntimeMaintenanceForRuntimeService({
      kind: 'runtime_restart_required',
      required_for: 'open',
      recovery_action: 'restart_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: 'Existing runtime work may be active',
      message: 'Restart this runtime before opening it.',
    }, blockedRuntimeService)).toMatchObject({
      kind: 'runtime_restart_required',
      required_for: 'open',
    });
  });

  it('rejects unknown maintenance kinds', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'unknown',
      message: 'nope',
    })).toBeUndefined();
  });

  it('normalizes verified process takeover as restart maintenance', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'runtime_process_takeover_required',
      required_for: 'open',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: 'Active work may be interrupted',
      message: 'Review the verified Runtime processes.',
    })).toMatchObject({
      kind: 'runtime_process_takeover_required',
      recovery_action: 'restart_runtime',
      can_desktop_restart: true,
    });
  });
});
