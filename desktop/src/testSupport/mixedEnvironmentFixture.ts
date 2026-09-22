import { REDEVEN_CLOUD_DEVELOPMENT_ORIGIN, REDEVEN_CLOUD_ORIGIN } from '../shared/redevenCloud';
import { desktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { resolveDesktopPlatformCapabilities } from '../shared/desktopPlatformCapabilities';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopSavedRuntimeTarget } from '../main/desktopPreferences';
import { normalizeDesktopControlPlaneProvider, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import type { DesktopRuntimePresence } from '../shared/desktopRuntimePresence';
import type { RuntimeServiceSnapshot } from '../shared/runtimeService';
import { testDesktopPreferences, testLocalEnvironment } from './desktopTestHelpers';

/** Real snapshot builder inputs shared by mixed-library unit and browser acceptance. */
export function mixedEnvironmentFixture(options: {
  linkState?: 'linking' | 'linked' | 'disconnecting' | 'unbound';
  linkKind?: 'local_environment' | 'ssh_environment' | 'wsl_environment';
  syncState?: DesktopControlPlaneSummary['sync_state'];
} = {}) {
  const now = Date.now();
  const sources: DesktopControlPlaneSummary[] = ['Team Cloud', 'Personal Cloud'].map((name, index) => {
    const origin = index ? REDEVEN_CLOUD_DEVELOPMENT_ORIGIN : REDEVEN_CLOUD_ORIGIN;
    const accessPoint = { access_point_id: 'dev', region: 'dev', display_name: 'Development', description: '',
      access_point_origin: index ? 'https://personal.example.invalid' : 'https://team.example.invalid', country_code: 'SG', city: 'Singapore', status: 'active', health_status: 'healthy' };
    const provider = normalizeDesktopControlPlaneProvider({ protocol_version: 'rcpp-v3', provider_id: 'redeven',
      display_name: 'Redeven Cloud', provider_origin: origin, documentation_url: `${origin}/help`, access_points: [accessPoint] })!;
    return { provider, account: { provider_id: 'redeven', provider_origin: origin, display_name: name,
      user_public_id: `user_${index}`, user_display_name: index ? 'Personal account' : 'Team account', authorization_expires_at_unix_ms: now + 3600000 },
      display_label: name, environments: [0, 1, 2].map(n => ({ provider_id: 'redeven', provider_origin: origin,
        env_public_id: `env_${index}_${n}`, region: 'dev', access_point_id: 'dev', access_point_origin: accessPoint.access_point_origin,
        label: n === 0 ? 'Development' : `${index ? 'Personal' : 'Team'} remote ${n}`, description: '', namespace_public_id: `ns_${index}`,
        namespace_name: name, environment_url: `${accessPoint.access_point_origin}/env/env_${index}_${n}`,
        status: n === 2 ? 'offline' : 'online', lifecycle_status: 'active', last_seen_at_unix_ms: now,
        runtime_health: { env_public_id: `env_${index}_${n}`, runtime_status: n === 2 ? 'offline' : 'online',
          observed_at_unix_ms: now, last_seen_at_unix_ms: now, offline_reason_code: '', offline_reason: '' },
      })), last_synced_at_ms: now, last_sync_attempt_at_ms: now, sync_state: options.syncState ?? 'ready',
      last_sync_error_code: options.syncState === 'provider_unreachable' ? 'network_error' : '',
      last_sync_error_message: options.syncState === 'provider_unreachable' ? 'Unable to reach this source.' : '',
      catalog_freshness: options.syncState && options.syncState !== 'ready' ? 'stale' : 'fresh',
    };
  });
  const targets: DesktopSavedRuntimeTarget[] = ['Build server', 'Staging server'].map((label, index) => {
    const host_access = { kind: 'ssh_host' as const, ssh: { ssh_destination: `dev@server-${index}.example.invalid`, ssh_port: 22, auth_mode: 'key_agent' as const, connect_timeout_seconds: 10 } };
    const placement = { kind: 'host_process' as const, runtime_root: '/home/dev/.redeven', bootstrap_strategy: 'auto' as const, release_base_url: '' };
    return { schema_version: 1, id: desktopRuntimeTargetID(host_access, placement), label, host_access, placement,
      ssh_password: '', ssh_password_configured: false, auto_runtime_probe_enabled: false, pinned: false,
      created_at_ms: now, updated_at_ms: now, last_used_at_ms: 0 };
  });
  if (options.linkKind === 'wsl_environment') {
    const host_access = { kind: 'wsl_host' as const, distribution_name: 'Ubuntu', linux_user: 'dev' };
    const placement = { kind: 'host_process' as const, runtime_root: '/home/dev/.redeven' };
    targets.push({ ...targets[0], id: desktopRuntimeTargetID(host_access, placement), label: 'Ubuntu', host_access, placement });
  }
  const source = sources[0];
  const runtimeService: RuntimeServiceSnapshot = {
    runtime_version: 'v1.4.2', protocol_version: 'redeven-runtime-v2', effective_run_mode: 'desktop', remote_enabled: true, compatibility: 'compatible',
    open_readiness: { state: 'openable' }, active_workload: { terminal_count: 0, session_count: 0, task_count: 0, port_forward_count: 0 },
    capabilities: { desktop_model_source: { supported: false }, provider_link: { supported: true, bind_method: 'runtime_control_v2' } },
    bindings: { desktop_model_source: { state: 'unsupported' }, provider_link: {
      state: options.linkState ?? 'linked', provider_origin: source.provider.provider_origin, provider_id: source.provider.provider_id,
      env_public_id: 'env_0_0', access_point_origin: source.environments[0].access_point_origin, remote_enabled: true,
    } },
  };
  const local = testLocalEnvironment({ label: 'Development runtime', pinned: false });
  const presences = Object.fromEntries([
    { id: 'local:local' as const, environmentID: local.id, label: local.label, kind: 'local_environment' as const,
      host: { kind: 'local_host' as const }, placement: { kind: 'host_process' as const, runtime_root: '' } },
    ...targets.map(target => ({ id: desktopProviderRuntimeLinkTargetID(target.host_access.kind === 'wsl_host' ? 'wsl_environment' : 'ssh_environment', target.id), environmentID: target.id, label: target.label,
      kind: target.host_access.kind === 'wsl_host' ? 'wsl_environment' as const : 'ssh_environment' as const,
      host: target.host_access, placement: target.placement })),
  ].map((target, index) => {
    const linked = (options.linkKind ?? 'local_environment') === target.kind && (target.kind !== 'ssh_environment' || index === 1);
    const presence = { target_id: target.id, placement_target_id: desktopRuntimeTargetID(target.host, target.placement), environment_id: target.environmentID, label: target.label,
      kind: target.kind, runtime_key: target.id, host_access: target.host, placement: target.placement,
      running: true, openable: true, local_ui_url: `http://localhost:${23998 + index}/`, checked_at_unix_ms: now, started_at_unix_ms: now - 120000,
      runtime_control_status: { state: 'available' as const },
      runtime_service: linked ? runtimeService : { ...runtimeService, bindings: { ...runtimeService.bindings!, provider_link: { state: 'unbound' as const, remote_enabled: false } } },
    };
    return [target.id, { ...presence, operations: buildDesktopRuntimeOperationPlans({ surface: 'managed_runtime_card', ...presence }) } satisfies DesktopRuntimePresence];
  }));
  const inputs = { preferences: testDesktopPreferences({ local_environment: local, saved_runtime_targets: targets }),
    controlPlanes: sources, redevenCloudOriginPolicy: { allow_development: true }, managedRuntimePresenceByTargetID: presences,
    ...(options.linkKind === 'wsl_environment' ? { platformCapabilities: resolveDesktopPlatformCapabilities('win32') } : {}),
  };
  const snapshot = buildDesktopWelcomeSnapshot(inputs);
  return { snapshot, sources, targets, inputs };
}
