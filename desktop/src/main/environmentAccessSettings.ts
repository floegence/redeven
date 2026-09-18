import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { buildDesktopSettingsSurfaceSnapshot } from './settingsPageContent';
import type { RuntimeAccessSettings } from './runtimeControlClient';
import { RuntimeControlError } from './runtimeControlClient';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import type { StartupReport } from './startup';
import type { DesktopWSLDiscoverySnapshot } from '../shared/desktopWSL';
import type { DesktopPreferences, DesktopSavedRuntimeTarget } from './desktopPreferences';

export type EnvironmentAccessOwner =
  | Readonly<{ kind: 'local'; environment_id: string; label: string }>
  | Readonly<{ kind: 'managed'; environment_id: string; label: string; target: DesktopSavedRuntimeTarget }>;

export function resolveEnvironmentAccessOwner(
  preferences: DesktopPreferences, environmentID: string, nativeHostRuntime: boolean,
): EnvironmentAccessOwner {
  if (nativeHostRuntime && environmentID === preferences.local_environment.id) {
    return { kind: 'local', environment_id: environmentID, label: preferences.local_environment.label };
  }
  const target = preferences.saved_runtime_targets.find((entry) => entry.id === environmentID);
  if (target) return { kind: 'managed', environment_id: target.id, label: target.label, target };
  throw new Error('Access settings require this Environment management connection.');
}

export async function withEnvironmentAccessOwner<T>(
  preferences: DesktopPreferences, environmentID: string, nativeHostRuntime: boolean,
  operation: (owner: EnvironmentAccessOwner) => Promise<T>,
): Promise<T> {
  return operation(resolveEnvironmentAccessOwner(preferences, environmentID, nativeHostRuntime));
}

export function requireEnvironmentAccessCompatible(startup: StartupReport | null): void {
  if (startup && (startup.runtime_service?.compatibility_epoch ?? 0) < RUNTIME_SERVICE_COMPATIBILITY_EPOCH) {
    throw new RuntimeControlError('SETTINGS_RUNTIME_INCOMPATIBLE', 'Stop or update this older Runtime before managing its access settings.');
  }
}

export async function requireEnvironmentAccessHostAvailable(
  owner: EnvironmentAccessOwner, discover: () => Promise<DesktopWSLDiscoverySnapshot>,
): Promise<void> {
  if (owner.kind !== 'managed' || owner.target.host_access.kind !== 'wsl_host') return;
  const host = owner.target.host_access;
  const discovery = await discover();
  if (!discovery.distributions.some(entry => entry.distribution_name === host.distribution_name && entry.state === 'running')) {
    throw new RuntimeControlError('SETTINGS_WSL_STOPPED', 'Start this WSL Environment before reading or saving its access settings.');
  }
}

export function buildEnvironmentAccessSnapshot(
  owner: EnvironmentAccessOwner, environment: DesktopEnvironmentEntry,
  access: RuntimeAccessSettings, startup: StartupReport | null,
) {
  return {
    ...buildDesktopSettingsSurfaceSnapshot('environment_settings', {
      local_ui_bind: access.local_ui_bind, local_ui_protocol: access.local_ui_protocol,
      local_ui_password: '', local_ui_password_mode: 'keep',
      auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
    }, {
      environment_id: owner.environment_id, environment_label: environment.label,
      environment_kind: owner.kind === 'local' ? 'local' : 'runtime_target',
      runtime_connection: owner.kind === 'managed'
        ? { host_access: owner.target.host_access, placement: owner.target.placement }
        : { host_access: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: '' } },
      runtime_health: environment.runtime_health,
      local_ui_password_configured: access.local_ui_password_configured,
      runtime_password_required: startup?.password_required === true,
      current_runtime_running: environment.runtime_health.status === 'online',
      current_runtime_url: environment.local_ui_url ?? '', current_runtime_urls: environment.local_ui_urls ?? [],
      auto_runtime_probe_configurable: false,
    }),
    runtime_configuration_pending: environment.runtime_health.status === 'online' && access.restart_required === true
      && access.runtime_started_at_unix_ms === environment.runtime_started_at_unix_ms,
    runtime_started_at_unix_ms: access.runtime_started_at_unix_ms,
  };
}
