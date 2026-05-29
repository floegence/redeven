import type { DesktopSessionContextSnapshot } from '../shared/desktopSessionContextIPC';
import type { DesktopSessionTarget } from './desktopTarget';

export function desktopSessionContextSnapshotFromTarget(target: DesktopSessionTarget | null): DesktopSessionContextSnapshot | null {
  if (!target) {
    return null;
  }

  if (target.kind === 'local_environment') {
    return {
      local_environment_id: target.environment_id,
      renderer_storage_scope_id: target.route === 'local_host'
        ? 'local'
        : target.environment_id,
      target_kind: target.kind,
      target_route: target.route,
      session_source: target.local_environment_kind === 'controlplane' ? 'provider_environment' : 'local_runtime',
      label: target.label,
      ...(target.provider_origin ? { provider_origin: target.provider_origin } : {}),
      ...(target.provider_id ? { provider_id: target.provider_id } : {}),
      ...(target.env_public_id ? { env_public_id: target.env_public_id } : {}),
    };
  }

  return {
    local_environment_id: target.environment_id,
    renderer_storage_scope_id: target.environment_id,
    target_kind: target.kind,
    session_source: target.kind === 'ssh_environment' ? 'ssh_environment' : 'external_local_ui',
    label: target.label,
  };
}
