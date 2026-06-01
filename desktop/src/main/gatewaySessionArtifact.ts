import { GatewayClientError, type GatewayOpenSessionResponse } from './gatewayClient';
import type { GatewayRecord } from './gatewayStore';
import { buildLocalUIEnvAppEntryURL } from './localUIURL';
import type { RuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';

type GatewayArtifactBridgeSession = Pick<RuntimePlacementBridgeSession, 'placement_target_id' | 'local_ui_url'>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function gatewayEnvAppBridgeRouteID(record: Pick<GatewayRecord, 'gateway_id'>): string {
  return `env_app:${record.gateway_id}`;
}

export function gatewaySessionArtifactURL(
  record: GatewayRecord,
  response: Pick<GatewayOpenSessionResponse, 'connect_artifact'>,
  bridgeSession: GatewayArtifactBridgeSession | undefined,
): string {
  const artifact = response.connect_artifact;
  if (record.connection.kind === 'url') {
    if (artifact.kind !== 'local_direct_artifact') {
      throw new GatewayClientError('GATEWAY_ARTIFACT_UNSUPPORTED', 'URL Gateways must return a direct environment artifact.');
    }
    const directURL = compact(artifact.url);
    if (!directURL) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact is missing its URL.');
    }
    return directURL;
  }

  if (!bridgeSession) {
    throw new GatewayClientError('GATEWAY_BRIDGE_UNAVAILABLE', 'Gateway bridge session is unavailable.', null, true);
  }
  if (
    artifact.kind !== 'desktop_bridge_artifact'
    || compact(artifact.bridge_session_id) !== bridgeSession.placement_target_id
    || compact(artifact.route_id) !== gatewayEnvAppBridgeRouteID(record)
  ) {
    throw new GatewayClientError('GATEWAY_ARTIFACT_UNSUPPORTED', 'SSH and container Gateways must return a matching bridge environment artifact.');
  }
  return buildLocalUIEnvAppEntryURL(bridgeSession.local_ui_url);
}
