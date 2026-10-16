import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

/** Authority coordinates exclude health, capability probes, labels and presentation order. */
export function environmentInteractionIdentity(environment: DesktopEnvironmentEntry): string {
  return JSON.stringify([environment.id, environment.registration_ref, environment.verified_runtime_identity,
    environment.gateway_identity_fingerprint, environment.managed_runtime_host_access, environment.managed_runtime_placement,
    environment.cloud_origin, environment.cloud_id, environment.env_public_id,
    environment.runtime_service?.bindings?.cloud_link.cloud?.association_revision]);
}

/** Gateway health and catalog changes do not change the saved connection authority. */
export function gatewayInteractionIdentity(gateway: DesktopGatewaySource): string {
  return JSON.stringify([gateway.gateway_id, gateway.identity_fingerprint, gateway.connection_kind,
    gateway.gateway_url, gateway.ssh_details, gateway.runtime_root, gateway.container_engine, gateway.container_id, gateway.container_ref]);
}
