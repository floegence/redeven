import { describe, expect, it } from 'vitest';
import { normalizeGatewayJoinMaterial } from './gatewayJoin';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

const material = { protocol_version: 1, cloud_origin: 'https://cloud.example', region_origin: 'https://sg.cloud.example', namespace_public_id: 'namespace', gateway_public_id: 'gateway', request_public_id: 'request', gateway_url: 'https://gateway.internal:7443', gateway_tls_root_pem: '-----BEGIN CERTIFICATE-----\ntest', join_token: 'a'.repeat(43), gateway_enrollment_token: 'b'.repeat(43), expires_at_unix_ms: 1900000000000 };

describe('Gateway join local consent', () => {
  it('preserves the exact original authority and one-time material', () => {
    expect(normalizeGatewayJoinMaterial(material)).toEqual(material);
    expect(normalizeDesktopLauncherActionRequest({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'ssh:chosen', material })).toEqual({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'ssh:chosen', material });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'local:chosen' })).toEqual({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'local:chosen' });
  });
  it('rejects arbitrary profiles, destinations, versions and unbounded secrets', () => {
    for (const patch of [{ cloud_origin: 'https://cloud.example/path' }, { cloud_origin: 'https://user:pass@cloud.example' }, { gateway_url: 'http://gateway.internal' }, { protocol_version: 2 }, { request_public_id: '../other' }, { join_token: 'a'.repeat(129) }, { extra: true }]) {
      expect(normalizeGatewayJoinMaterial({ ...material, ...patch })).toBeNull();
    }
    expect(normalizeDesktopLauncherActionRequest({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'https://public-runtime', material })).toBeNull();
  });
});
