import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { StartupReport } from './startup';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { describe, expect, it, vi } from 'vitest';
import { testDesktopPreferences, testProviderEnvironment } from '../testSupport/desktopTestHelpers';
import { resolveEnvironmentAccessOwner, withEnvironmentAccessOwner, requireEnvironmentAccessHostAvailable, requireEnvironmentAccessCompatible, buildEnvironmentAccessSnapshot } from './environmentAccessSettings';

describe('environment access settings authority', () => {
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
