import type { DesktopSavedRuntimeTarget } from '../main/desktopPreferences';
import type { DesktopRuntimePresence } from '../shared/desktopRuntimePresence';
import { mixedEnvironmentFixture } from './mixedEnvironmentFixture';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { desktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import { resolveDesktopPlatformCapabilities } from '../shared/desktopPlatformCapabilities';

// Example inventories use the same snapshot and operation planners as Desktop.
export function compactEnvironmentPreviewFixture() {
  const seed = mixedEnvironmentFixture();
  const first = seed.targets[0];
  const localPresence = seed.inputs.managedRuntimePresenceByTargetID['local:local'];
  const sshPresence = seed.inputs.managedRuntimePresenceByTargetID[`ssh:${first.id}`];
  const names = ['gzcom', 'gzlight', 'orange', 'los', 'udesk26', 'udesk24', 'devbox'];
  const targets: DesktopSavedRuntimeTarget[] = names.map(label => {
    const host_access = { ...first.host_access, kind: 'ssh_host' as const, ssh: { ...first.host_access.kind === 'ssh_host' ? first.host_access.ssh : {}, ssh_destination: label, ssh_port: 22, auth_mode: 'key_agent' as const, connect_timeout_seconds: 10 } };
    return { ...first, label, host_access, id: desktopRuntimeTargetID(host_access, first.placement) };
  });
  const presences = { 'local:local': { ...localPresence, label: 'Local Environment' } };
  const make = (allTypes: boolean) => {
    const runtimeTargets: DesktopSavedRuntimeTarget[] = [...targets];
    if (allTypes) {
      const host_access = { kind: 'wsl_host' as const, distribution_name: 'Ubuntu-24.04', linux_user: 'dev' };
      const wsl = { ...first, label: 'Ubuntu-24.04', host_access, id: desktopRuntimeTargetID(host_access, first.placement) };
      runtimeTargets.splice(4, 1, wsl as typeof first);
      const placement = { kind: 'container_process' as const, container_engine: 'docker' as const, container_id: 'demo-container', container_ref: 'redeven-dev', container_label: 'redeven-dev', bridge_strategy: 'exec_stream' as const, runtime_root: '/root/.redeven' };
      runtimeTargets.splice(5, 1, { ...first, label: 'Docker workspace', placement, id: desktopRuntimeTargetID(first.host_access, placement) });
    }
    const presence: Record<string, DesktopRuntimePresence> = { ...presences };
    runtimeTargets.forEach((target, index) => {
      if (!allTypes && index > 0) return;
      const kind: 'wsl_environment' | 'ssh_environment' = target.host_access.kind === 'wsl_host' ? 'wsl_environment' : 'ssh_environment';
      const id = desktopProviderRuntimeLinkTargetID(kind, target.id);
      const p = { ...sshPresence, target_id: id, placement_target_id: target.id, environment_id: target.id,
        label: target.label, kind, host_access: target.host_access, placement: target.placement,
        local_ui_url: 'http://localhost:23998/', local_ui_urls: index === 0 ? ['http://localhost:23998/', 'http://192.0.2.10:23998/'] : ['http://localhost:23998/'],
      };
      presence[id] = { ...p, operations: buildDesktopRuntimeOperationPlans({ surface: 'managed_runtime_card', ...p }) };
    });
    const source = seed.sources[0];
    const snapshot = buildDesktopWelcomeSnapshot({ ...seed.inputs,
      platformCapabilities: resolveDesktopPlatformCapabilities(allTypes ? 'win32' : 'darwin'),
      preferences: { ...seed.inputs.preferences, local_environment: { ...seed.inputs.preferences.local_environment, label: 'Local Environment', last_used_at_ms: Date.now() }, saved_runtime_targets: runtimeTargets,
        saved_environments: allTypes ? [{ id: 'demo-url', label: 'External URL', local_ui_url: 'https://workspace.example.invalid/', pinned: false, auto_runtime_probe_enabled: false, created_at_ms: Date.now(), last_used_at_ms: 0 }] : [],
      },
      gatewaySources: allTypes ? [{ gateway_id: 'bastion', display_name: 'Bastion', local_enabled: true,
        connection_kind: 'url', management_capability: 'access_only', capabilities: ['env_catalog', 'env_open_session'],
        status: 'online', trust_state: 'paired', endpoint_label: 'https://gateway.example.invalid',
        service_state: { status: 'not_applicable', can_start: false, can_stop: false, can_restart: false, can_update: false, can_pair_after_start: false },
        created_at_ms: Date.now(), updated_at_ms: Date.now(), environments: [{ gateway_env_id: 'internal-workspace', display_name: 'Gateway workspace',
          env_kind: 'reachable_env', state: 'available', capabilities: ['open'], access_capabilities: ['open'],
          origin: { kind: 'network_target', label: 'Development subnet' },
        }],
      }] : [],
      managedRuntimePresenceByTargetID: presence,
      controlPlanes: [{ ...source, environments: source.environments.slice(0, allTypes ? 3 : 1) }],
    });
    const localEntry = snapshot.environments.find(e => e.kind === 'local_environment')!;
    return { ...snapshot, open_windows: localEntry ? [{ session_key: 'demo-local-window', target_kind: 'local_environment' as const, environment_id: localEntry.id, label: localEntry.label, local_ui_url: localEntry.local_ui_url, lifecycle: 'open' as const }] : [], environments: snapshot.environments.map(e => e.kind === 'local_environment'
      ? { ...e, is_open: true, window_state: 'open' as const, open_action: 'focus' as const, open_session_key: 'demo-local-window' } : e) };
  };
  const daily = make(false);
  const coverage = make(true);
  const states = structuredClone(coverage);
  const statuses = ['unknown', 'checking', 'failed', 'offline', 'update', 'reinstall'];
  let idx = 0;
  for (const e of states.environments) {
    if (e.kind === 'provider_environment') {
      const state = e.env_public_id === 'env_0_0' ? 'auth_required' : e.env_public_id === 'env_0_1' ? 'provider_unreachable' : 'offline';
      Object.assign(e, { remote_route_state: state, control_plane_sync_state: state === 'auth_required' ? state : 'ready' });
      continue;
    }
    if (e.kind === 'local_environment') continue;
    const state = statuses[idx++ % statuses.length];
    if (state === 'update') {
      const maintenance = { kind: 'runtime_update_required', required_for: 'open', recovery_action: 'update_runtime', can_desktop_start: true, can_desktop_restart: true, has_active_work: true, active_work_label: '2 terminals', current_runtime_version: 'v1.3.0', target_runtime_version: 'v1.4.2', message: '' };
      Object.assign(e, { runtime_maintenance: maintenance });
      Object.assign(e.runtime_operations.open, { availability: 'blocked' });
      Object.assign(e.runtime_operations.update, { availability: 'available', maintenance });
    } else {
      Object.assign(e, { runtime_started_at_unix_ms: undefined, local_ui_url: '', local_ui_urls: [], is_open: false, window_state: 'closed', runtime_service: undefined, local_environment_runtime_service: undefined, local_environment_runtime_state: 'not_running' });
      Object.assign(e.runtime_health, { status: 'offline', freshness: ['unknown', 'checking', 'failed'].includes(state) ? state : 'fresh', runtime_service: undefined, started_at_unix_ms: undefined, offline_reason_code: state === 'reinstall' ? 'reinstall_required' : state === 'failed' ? 'probe_failed' : 'not_started' });
      Object.assign(e.runtime_operations.open, { availability: 'blocked' });
      Object.assign(e.runtime_operations.start, { availability: 'available' });
      Object.assign(e.runtime_operations.stop, { availability: 'hidden' });
      Object.assign(e.runtime_operations.restart, { availability: 'hidden' });
      if (state === 'reinstall') Object.assign(e, { reinstall_required: true });
    }
  }
  const linkedError = structuredClone(daily);
  for (const e of linkedError.environments) if (e.kind === 'provider_environment') {
    Object.assign(e, { remote_route_state: 'auth_required', control_plane_sync_state: 'auth_required' });
  }
  return { daily, coverage, states, linkedError };
}
