import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import { normalizeGatewayBaseURL, type GatewayConnection } from './gatewayStore';

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
