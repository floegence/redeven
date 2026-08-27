import type { DesktopSessionContextSnapshot } from '../shared/desktopSessionContextIPC';
import type { DesktopSessionTarget } from './desktopTarget';
import type { LocalUIExposure } from '../shared/localUIExposure';
import type { DesktopSessionTransportKind } from './desktopSessionTransport';

export function desktopSessionContextSnapshotFromTarget(
  target: DesktopSessionTarget | null,
  localUIExposure?: LocalUIExposure,
  transportKind?: DesktopSessionTransportKind,
): DesktopSessionContextSnapshot | null {
  if (!target) {
    return null;
  }

  const privateBridgeDocument = transportKind === 'native_local_bridge' || transportKind === 'placement_bridge';

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
      ...(localUIExposure ? { local_ui_exposure: localUIExposure } : {}),
      ...(privateBridgeDocument ? { document_transport: 'desktop_private_bridge_v2' as const } : {}),
    };
  }

  return {
    local_environment_id: target.environment_id,
    renderer_storage_scope_id: target.kind === 'gateway_environment'
      ? target.session_key
      : target.environment_id,
    target_kind: target.kind,
    target_route: 'remote_desktop',
    session_source: target.kind === 'ssh_environment'
      ? 'ssh_environment'
      : target.kind === 'wsl_environment'
        ? 'wsl_environment'
      : target.kind === 'gateway_environment'
        ? 'runtime_gateway'
        : 'external_local_ui',
    label: target.label,
    ...(localUIExposure ? { local_ui_exposure: localUIExposure } : {}),
    ...(privateBridgeDocument ? { document_transport: 'desktop_private_bridge_v2' as const } : {}),
  };
}
