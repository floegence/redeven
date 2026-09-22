import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { StartupReport } from './startup';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { describe, expect, it, vi } from 'vitest';
import { testDesktopPreferences, testProviderEnvironment } from '../testSupport/desktopTestHelpers';
import { RuntimeControlError } from './runtimeControlClient';
import { environmentSettingsFailure, resolveEnvironmentAccessOwner, withEnvironmentAccessOwner, requireEnvironmentAccessHostAvailable, requireEnvironmentAccessCompatible, requireEnvironmentManagementAvailable, buildEnvironmentAccessSnapshot } from './environmentAccessSettings';
import { desktopRuntimeControlStatusMissing } from '../shared/desktopRuntimePresence';
import type { DesktopRuntimeMaintenanceRequirement } from '../shared/desktopRuntimeHealth';

describe('environment access settings authority', () => {
  it.each([401, 403])('preserves authorization status %s and the original diagnostic across settings IPC', status => {
    const diagnostic = 'Runtime control returned HTTP ' + status + ': private transport rejected';
    expect(environmentSettingsFailure(new RuntimeControlError('RUNTIME_CONTROL_HTTP_ERROR', diagnostic, status)))
      .toEqual({ ok: false, code: 'RUNTIME_CONTROL_HTTP_ERROR', status_code: status, error: diagnostic });
  });
  it('does not turn connection or unknown failures into authorization errors', () => {
    expect(environmentSettingsFailure(new RuntimeControlError('RUNTIME_CONTROL_UNREACHABLE', 'Connection refused')))
      .toEqual({ ok: false, code: 'RUNTIME_CONTROL_UNREACHABLE', error: 'Connection refused' });
    expect(environmentSettingsFailure(new Error('Unknown failure'))).toEqual({ ok: false, error: 'Unknown failure' });
  });
  it('rejects Cloud and missing targets before any local or remote write', async () => {
    const cloud = testProviderEnvironment('https://provider.example.invalid', 'cloud');
    const preferences = testDesktopPreferences({ provider_environments: [cloud] });
    const write = vi.fn();
    for (const id of [cloud.id, '', 'removed-environment']) {
      await expect(withEnvironmentAccessOwner(preferences, id, true, write)).rejects.toThrow();
    }
    expect(write).not.toHaveBeenCalled();
  });
  it('resolves only the explicit Local registration and respects platform capabilities', () => {
    const preferences = testDesktopPreferences();
    expect(resolveEnvironmentAccessOwner(preferences, preferences.local_environment.id, true).kind).toBe('local');
    expect(() => resolveEnvironmentAccessOwner(preferences, preferences.local_environment.id, false)).toThrow();
  });
  it('checks only WSL discovery and rejects a stopped registered distro before executing management', async () => {
    const host = { kind: 'wsl_host' as const, distribution_name: 'Ubuntu', linux_user: 'dev' };
    const placement = { kind: 'host_process' as const, runtime_root: '/home/dev/.redeven', bootstrap_strategy: 'auto' as const, release_base_url: '' };
    const id = desktopRuntimeTargetID(host, placement);
    const preferences = testDesktopPreferences({ saved_runtime_targets: [{ schema_version: 2, id, host_access: host, placement,
      label: 'Ubuntu', pinned: false, auto_runtime_probe_enabled: true, ssh_password: '', ssh_password_configured: false,
      created_at_ms: 1, updated_at_ms: 1, last_used_at_ms: 1 }] });
    const owner = resolveEnvironmentAccessOwner(preferences, id, false);
    const discover = vi.fn(async () => ({ availability: 'ready' as const, distributions: [{ distribution_name: 'Ubuntu', state: 'stopped' as const, wsl_version: 2 as const, registration_status: 'eligible' as const }] }));
    const execute = vi.fn();
    await expect((async () => { await requireEnvironmentAccessHostAvailable(owner, discover); execute(); })()).rejects.toMatchObject({ code: 'SETTINGS_WSL_STOPPED' });
    expect(discover).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
    await expect(requireEnvironmentAccessHostAvailable(owner, async () => ({ availability: 'ready', distributions: [{ distribution_name: 'Ubuntu', state: 'running', wsl_version: 2, registration_status: 'eligible' }] }))).resolves.toBeUndefined();
  });
  it('keeps the native Runtime compatibility boundary explicit and permits stopped authority access', () => {
    expect(() => requireEnvironmentAccessCompatible(null)).not.toThrow();
    expect(() => requireEnvironmentAccessCompatible({ runtime_service: { compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH - 1 } } as StartupReport)).toThrow('Stop or update');
    expect(() => requireEnvironmentAccessCompatible({ runtime_service: { compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH } } as StartupReport)).not.toThrow();
  });

  it('distinguishes stopped access configuration from unavailable and incompatible management', () => {
    const stopped = { runtime_target_available: true, runtime_control_status: desktopRuntimeControlStatusMissing('not_started', 'Stopped') };
    expect(() => requireEnvironmentManagementAvailable(stopped)).not.toThrow();
    expect(() => requireEnvironmentManagementAvailable({ ...stopped, runtime_target_available: false,
      runtime_control_status: desktopRuntimeControlStatusMissing('unverified', 'Connection failed') }))
      .toThrowError(expect.objectContaining({ code: 'RUNTIME_CONTROL_UNREACHABLE' }));
    expect(() => requireEnvironmentManagementAvailable({ ...stopped,
      startup: { runtime_service: { compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH - 1 } } as StartupReport }))
      .toThrowError(expect.objectContaining({ code: 'SETTINGS_RUNTIME_INCOMPATIBLE' }));
    for (const [kind, code] of [['runtime_update_required', 'SETTINGS_RUNTIME_INCOMPATIBLE'], ['runtime_restart_required', 'SECURITY_RESTART_REQUIRED']] as const) {
      expect(() => requireEnvironmentManagementAvailable({ ...stopped,
        maintenance: { kind, message: 'Action required' } as DesktopRuntimeMaintenanceRequirement }))
        .toThrowError(expect.objectContaining({ code }));
    }
  });

  it('retains the running password requirement, endpoint ownership and matching pending start', () => {
    const preferences = testDesktopPreferences();
    const owner = resolveEnvironmentAccessOwner(preferences, preferences.local_environment.id, true);
    const environment = { id: owner.environment_id, label: 'Local', runtime_health: { status: 'online' },
      local_ui_url: 'http://127.0.0.1:31000/', local_ui_urls: ['http://127.0.0.1:31000/'], runtime_started_at_unix_ms: 100 } as unknown as DesktopEnvironmentEntry;
    const access = { local_ui_bind: 'localhost:32000', local_ui_password_configured: true,
      restart_required: true, runtime_started_at_unix_ms: 100 };
    const result = buildEnvironmentAccessSnapshot(owner, environment, access, { password_required: true } as StartupReport);
    expect(result.runtime_password_required).toBe(true);
    expect(result.draft.local_ui_bind).toBe('localhost:32000');
    expect(result.current_runtime_urls).toEqual(['http://127.0.0.1:31000/']);
    expect(result.runtime_connection.host_access.kind).toBe('local_host');
    expect(result.runtime_configuration_pending).toBe(true);
    expect(buildEnvironmentAccessSnapshot(owner, { ...environment, runtime_started_at_unix_ms: 200 }, access, null).runtime_configuration_pending).toBe(false);
    expect(buildEnvironmentAccessSnapshot(owner, { ...environment, runtime_health: { ...environment.runtime_health, status: 'offline' } }, access, null).runtime_configuration_pending).toBe(false);
  });

});
