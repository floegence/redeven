import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import { gatewayBindingAudience, normalizeGatewayBaseURL, type GatewayConnection, type GatewayRecord, type GatewayTrustProfile } from './gatewayStore';

/** Save a changed address only after it proves the existing pinned identity. */
export async function verifyGatewayConnectionChange(existing: GatewayRecord | null, connection: GatewayConnection,
  verify: (candidate: GatewayRecord) => Promise<void>): Promise<GatewayTrustProfile | undefined> {
  const profile = existing?.trust_profile;
  if (!existing || !profile || gatewayBindingAudience(existing.connection) === gatewayBindingAudience(connection)) return profile;
  const candidate = { ...existing, connection, trust_profile: { ...profile, binding_audience: gatewayBindingAudience(connection) } };
  await verify(candidate);
  return { ...candidate.trust_profile, last_verified_at_unix_ms: Date.now() };
}

export function gatewayConnectionFromSetup(
  request: Extract<DesktopLauncherActionRequest, { kind: 'upsert_gateway' }>,
): GatewayConnection {
  if (request.connection_kind === 'url') {
    return { kind: 'url', base_url: normalizeGatewayBaseURL(request.gateway_url), allow_loopback_http: request.allow_loopback_http };
  }
  const host = request.host_access;
  const placement = request.placement;
  if (host.kind === 'wsl_host') throw new Error('Gateway service placement does not support WSL.');
  const root = { runtime_root: placement.runtime_root };
  const container = placement.kind === 'container_process' ? {
    container_engine: placement.container_engine, container_id: placement.container_id,
    container_ref: placement.container_ref, container_label: placement.container_label,
  } : null;
  if (host.kind === 'local_host') {
    return container ? { kind: 'local_container', ...root, ...container } : { kind: 'local_host', ...root };
  }
  const ssh = { ...root, ssh_destination: host.ssh.ssh_destination,
    ...(host.ssh.ssh_port ? { ssh_port: host.ssh.ssh_port } : {}), auth_mode: host.ssh.auth_mode,
    connect_timeout_seconds: host.ssh.connect_timeout_seconds ?? undefined };
  return container ? { kind: 'ssh_container', ...ssh, ...container }
    : { kind: 'ssh_host', ...ssh, bootstrap_strategy: placement.kind === 'host_process' ? placement.bootstrap_strategy : undefined, release_base_url: placement.kind === 'host_process' ? placement.release_base_url : undefined };
}
