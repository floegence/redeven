import { describe, expect, it } from 'vitest';

import { gatewayEnvAppBridgeRouteID, gatewaySessionArtifactURL } from './gatewaySessionArtifact';
import type { GatewayOpenSessionResponse } from './gatewayClient';
import type { GatewayRecord } from './gatewayStore';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

function gatewayRecord(connection: GatewayRecord['connection']): GatewayRecord {
  return {
    schema_version: 1,
    gateway_id: 'gw_demo',
    display_name: 'Demo Gateway',
    connection,
    created_at_ms: 1,
    updated_at_ms: 1,
  };
}

function openSessionArtifact(
  connectArtifact: GatewayOpenSessionResponse['connect_artifact'],
): Pick<GatewayOpenSessionResponse, 'connect_artifact'> {
  return { connect_artifact: connectArtifact };
}

function bridgeArtifact(overrides: Partial<GatewayOpenSessionResponse['connect_artifact']> = {}): GatewayOpenSessionResponse['connect_artifact'] {
  return {
    kind: 'desktop_bridge_artifact',
    bridge_session_id: 'ssh://bridge_demo',
    route_id: 'env_app:gw_demo',
    expires_at_unix_ms: Date.now() + 60_000,
    artifact_nonce: 'artifact-nonce',
    proof: 'proof',
    ...overrides,
  };
}

describe('gatewaySessionArtifact', () => {
  it('uses direct artifacts only for URL Gateways', () => {
    const record = gatewayRecord({
      kind: 'url',
      base_url: 'https://gateway.example/',
    });

    expect(gatewaySessionArtifactURL(record, openSessionArtifact({
      kind: 'local_direct_artifact',
      url: 'https://gateway.example/_redeven_proxy/env/',
      expires_at_unix_ms: Date.now() + 60_000,
      artifact_nonce: 'artifact-nonce',
      proof: 'proof',
    }), undefined)).toBe('https://gateway.example/_redeven_proxy/env/');
    expect(() => gatewaySessionArtifactURL(record, openSessionArtifact(bridgeArtifact()), undefined)).toThrowError(/direct environment artifact/u);
  });

  it('requires SSH and container Gateway artifacts to match the active bridge session and route', () => {
    const record = gatewayRecord({
      kind: 'ssh_host',
      ssh_destination: 'bastion',
      runtime_root: '/opt/redeven',
    });
    const bridgeSession = {
      placement_target_id: 'ssh://bridge_demo' as DesktopRuntimeTargetID,
      local_ui_url: 'http://127.0.0.1:24000/',
    };

    expect(gatewayEnvAppBridgeRouteID(record)).toBe('env_app:gw_demo');
    expect(gatewaySessionArtifactURL(record, openSessionArtifact(bridgeArtifact()), bridgeSession)).toBe('http://127.0.0.1:24000/_redeven_proxy/env/');
    expect(() => gatewaySessionArtifactURL(record, openSessionArtifact(bridgeArtifact({
      bridge_session_id: 'ssh://bridge_other',
    })), bridgeSession)).toThrowError(/matching bridge environment artifact/u);
    expect(() => gatewaySessionArtifactURL(record, openSessionArtifact(bridgeArtifact({
      route_id: 'env_app:other',
    })), bridgeSession)).toThrowError(/matching bridge environment artifact/u);
    expect(() => gatewaySessionArtifactURL(record, openSessionArtifact({
      kind: 'local_direct_artifact',
      url: 'https://gateway.example/_redeven_proxy/env/',
      expires_at_unix_ms: Date.now() + 60_000,
      artifact_nonce: 'artifact-nonce',
      proof: 'proof',
    }), bridgeSession)).toThrowError(/matching bridge environment artifact/u);
    expect(() => gatewaySessionArtifactURL(record, openSessionArtifact(bridgeArtifact()), undefined)).toThrowError(/bridge session is unavailable/u);
  });
});
