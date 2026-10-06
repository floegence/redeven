import { describe, expect, it } from 'vitest';
import { normalizeGatewayInvitation } from './gatewayJoin';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

const invitation = { protocol_version: 'redeven-gateway-v4', gateway_id: 'gateway', invitation_id: 'invitation', gateway_url: 'https://gateway.internal:7443', gateway_public_key: 'a'.repeat(43), gateway_tls_root_pem: '-----BEGIN CERTIFICATE-----\ntest', token: 'b'.repeat(43), signature: 'c'.repeat(86), issued_at_unix_ms: 1900000000000, expires_at_unix_ms: 1900000600000 };

describe('Gateway join local consent', () => {
  it('preserves the exact original authority and one-time invitation', () => {
    expect(normalizeGatewayInvitation(invitation)).toEqual(invitation);
    expect(normalizeDesktopLauncherActionRequest({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'join', invitation })).toEqual({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'join', invitation });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'manage_runtime_gateway', runtime_target_id: 'local:chosen', operation: 'status' })).toEqual({ kind: 'manage_runtime_gateway', runtime_target_id: 'local:chosen', operation: 'status' });
  });
  it('rejects arbitrary profiles, destinations, versions and unbounded secrets', () => {
    for (const patch of [{ gateway_url: 'https://gateway.example/path' }, { gateway_url: 'https://user:pass@gateway.example' }, { gateway_url: 'http://gateway.internal' }, { protocol_version: 2 }, { invitation_id: '../other' }, { token: 'a'.repeat(129) }, { extra: true }]) {
      expect(normalizeGatewayInvitation({ ...invitation, ...patch })).toBeNull();
    }
    expect(normalizeDesktopLauncherActionRequest({ kind: 'manage_runtime_gateway', runtime_target_id: 'https://public-runtime', invitation })).toBeNull();
  });
});
