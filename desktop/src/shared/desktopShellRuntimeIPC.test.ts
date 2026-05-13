import { describe, expect, it } from 'vitest';

import {
  desktopShellRuntimeMaintenanceMethodUsesDesktop,
  normalizeDesktopShellRuntimeMaintenanceContext,
  normalizeDesktopShellRuntimeAction,
  normalizeDesktopShellRuntimeActionRequest,
  normalizeDesktopShellRuntimeActionResponse,
} from './desktopShellRuntimeIPC';

describe('desktopShellRuntimeIPC', () => {
  it('normalizes supported runtime actions', () => {
    expect(normalizeDesktopShellRuntimeAction(' restart ')).toBe('restart_runtime');
    expect(normalizeDesktopShellRuntimeAction('RESTART_RUNTIME')).toBe('restart_runtime');
    expect(normalizeDesktopShellRuntimeAction('restart_managed_runtime')).toBe('restart_managed_runtime');
    expect(normalizeDesktopShellRuntimeAction('update')).toBe('upgrade_runtime');
    expect(normalizeDesktopShellRuntimeAction('desktop_update')).toBe('manage_desktop_update');
  });

  it('normalizes action requests and responses', () => {
    expect(normalizeDesktopShellRuntimeActionRequest({ action: 'restart', target_version: ' v1.2.3 ' })).toEqual({
      action: 'restart_runtime',
      target_version: 'v1.2.3',
    });
    expect(normalizeDesktopShellRuntimeActionResponse({ ok: true, started: true, message: 'done' })).toEqual({
      ok: true,
      started: true,
      message: 'done',
    });
  });

  it('rejects unsupported actions', () => {
    expect(normalizeDesktopShellRuntimeAction('open_settings')).toBe('');
    expect(normalizeDesktopShellRuntimeActionRequest({ action: 'open_settings' })).toBeNull();
    expect(normalizeDesktopShellRuntimeActionResponse(null)).toEqual({
      ok: false,
      started: false,
      message: 'Desktop runtime action failed.',
    });
  });

  it('normalizes explicit runtime maintenance contexts', () => {
    const context = normalizeDesktopShellRuntimeMaintenanceContext({
      available: true,
      authority: 'desktop_ssh',
      runtime_kind: 'ssh',
      lifecycle_owner: 'external',
      service_owner: 'desktop',
      desktop_managed: true,
      upgrade_policy: 'desktop_release',
      current_version: ' v1.0.0 ',
      active_workload: {
        terminal_count: 2.2,
        session_count: 1,
        task_count: -1,
        port_forward_count: '3',
      },
      restart: {
        availability: 'available',
        method: 'desktop_ssh_restart',
        label: 'Restart SSH runtime',
        confirm_label: 'Restart',
        title: 'Restart SSH Runtime?',
        message: 'Desktop will restart the SSH runtime.',
      },
      upgrade: {
        availability: 'available',
        method: 'desktop_ssh_force_update',
        label: 'Update SSH runtime',
        confirm_label: 'Update',
        title: 'Update SSH Runtime?',
        message: 'Desktop will reinstall the SSH runtime.',
        requires_target_version: false,
      },
    });

    expect(context.authority).toBe('desktop_ssh');
    expect(context.runtime_kind).toBe('ssh');
    expect(context.current_version).toBe('v1.0.0');
    expect(context.active_workload).toEqual({
      terminal_count: 2,
      session_count: 1,
      task_count: 0,
      port_forward_count: 3,
    });
    expect(context.upgrade.requires_target_version).toBe(false);
    expect(desktopShellRuntimeMaintenanceMethodUsesDesktop(context.upgrade.method)).toBe(true);
  });
});
