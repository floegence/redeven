import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences, testProviderEnvironment } from './desktopTestHelpers';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopProviderRuntimeLinkTargetKind, DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

export function linkedEnvironmentFixture(kind: DesktopProviderRuntimeLinkTargetKind = 'local_environment') {
  const provider = testProviderEnvironment('https://provider.example.invalid', 'env_linked', { label: 'Cloud workspace', pinned: false });
  const initial = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences({ provider_environments: [provider] }) });
  const local = initial.environments.find(entry => entry.kind === 'local_environment')!;
  const targetID: DesktopProviderRuntimeLinkTargetID = kind === 'ssh_environment' ? 'ssh:fixture' : kind === 'wsl_environment' ? 'wsl:fixture' : 'local:local';
  const runtime: DesktopEnvironmentEntry = {
    ...local, kind, label: 'Development runtime', pinned: false,
    local_ui_url: 'http://localhost:23998/', local_ui_urls: ['http://localhost:23998/'],
    runtime_health: { ...local.runtime_health, status: 'online', freshness: 'fresh' },
    local_environment_runtime_state: 'running',
    runtime_operations: { ...local.runtime_operations, open: { ...local.runtime_operations.open, availability: 'available' } },
    provider_runtime_link_target: { ...local.provider_runtime_link_target!, id: targetID, kind,
      provider_link_state: 'linked', provider_connection_state: 'connected', provider_origin_supported: true,
      provider_origin: provider.provider_origin, provider_id: provider.provider_id, env_public_id: provider.env_public_id,
    },
  };
  const cloud: DesktopEnvironmentEntry = {
    ...initial.environments.find(entry => entry.kind === 'provider_environment')!,
    remote_environment_url: 'https://cloud.example.invalid/environments/env_linked',
    remote_route_state: 'ready', control_plane_sync_state: 'ready',
    provider_linked_runtime_summary: { runtime_target_id: targetID, runtime_kind: kind,
      label: runtime.label, provider_connection_state: 'connected' },
  };
  const snapshot = { ...initial, environments: [runtime, cloud] };
  return { runtime, cloud, snapshot };
}
