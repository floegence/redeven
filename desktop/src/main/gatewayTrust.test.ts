import { describe, expect, it } from 'vitest';
import {
  assertGatewayAddressProof, assertGatewayPairingChallenge, assertGatewayPairingCompleteResponse, buildPairingCompleteRequest,
  completeGatewayPairing, createGatewayAuthHeaders, createGatewayPairingMaterial, gatewayPublicKeyFingerprint,
  pairingChallengePayload, pairingCompleteResponsePayload, pairingProofPayload,
  revokeGatewayTrust, signGatewayPayload, verifyGatewaySignature, type GatewaySecretStore,
} from './gatewayTrust';
import { gatewayRecordFixture } from '../testSupport/gatewayMembershipFixture';
import { GATEWAY_PROTOCOL_VERSION, type GatewayPermissions } from '../shared/gatewayMembership';
import { gatewayProtocolID } from './gatewayStore';

function fixture() {
  const record = gatewayRecordFixture;
  const material = createGatewayPairingMaterial(record), machine = createGatewayPairingMaterial(record);
  const values = new Map<string, string>();
  const secret_store: GatewaySecretStore = { readSecret: key => values.get(key) ?? '', writeSecret: (key, value) => { values.set(key, value); }, deleteSecret: key => { values.delete(key); } };
  const challenge = {
    protocol_version: GATEWAY_PROTOCOL_VERSION, gateway_id: 'machine_stable', gateway_nonce: 'nonce',
    gateway_public_key: machine.client_public_key, gateway_public_key_fingerprint: gatewayPublicKeyFingerprint(machine.client_public_key),
    expires_at_unix_ms: 2000, pairing_code: '123456', signature: '',
  };
  challenge.signature = signGatewayPayload(machine.client_private_key, pairingChallengePayload({
    protocol_version: challenge.protocol_version, client_nonce: material.client_nonce, gateway_nonce: challenge.gateway_nonce,
    gateway_id: challenge.gateway_id, binding_audience: material.binding_audience, client_public_key: material.client_public_key,
    gateway_public_key: challenge.gateway_public_key, expires_at_unix_ms: challenge.expires_at_unix_ms, pairing_code: challenge.pairing_code,
  }));
  const pair = () => completeGatewayPairing({ record, material, challenge, secret_store, trust_accepted: true, now_unix_ms: 1000 });
  return { record, material, machine, challenge, values, secret_store, pair };
}

describe('Gateway v4 trust', () => {
  it('pins machine identity independently from the local registration and signs requests with that identity', async () => {
    const f = fixture(), profile = await f.pair(), record = { ...f.record, trust_profile: profile };
    expect(profile.gateway_id).toBe('machine_stable'); expect(profile.gateway_id).not.toBe(f.record.gateway_id);
    expect(gatewayProtocolID(record)).toBe(profile.gateway_id);
    const headers = await createGatewayAuthHeaders({ record, method: 'POST', route: '/gateway/v4/catalog', body: {}, secret_store: f.secret_store, timestamp_unix_ms: 1000, nonce: 'request-nonce' });
    expect(headers).toMatchObject({ 'x-redeven-gateway-id': 'machine_stable', 'x-redeven-client-key-id': f.material.client_key_id, 'x-redeven-client-nonce': 'request-nonce' });
    expect(headers.authorization).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(f.material.client_private_key);
  });
  it('rejects changed identity, key, audience, challenge, code, expiry and protocol', async () => {
    const f = fixture(), profile = await f.pair(), record = { ...f.record, trust_profile: profile };
    for (const patch of [{ gateway_id: 'other' }, { gateway_public_key: f.material.client_public_key }, { gateway_nonce: 'other' },
      { gateway_public_key_fingerprint: 'wrong' }, { expires_at_unix_ms: 1000 }, { signature: 'wrong' }, { protocol_version: 'redeven-gateway-v3' }]) {
      expect(() => assertGatewayPairingChallenge({ record, material: f.material, challenge: { ...f.challenge, ...patch }, now_unix_ms: 1000 })).toThrow();
    }
    expect(() => assertGatewayPairingChallenge({ record, material: f.material, challenge: f.challenge, expected_pairing_code: 'other', now_unix_ms: 1000 })).toThrow();
    expect(() => assertGatewayPairingChallenge({ record, material: { ...f.material, binding_audience: 'https://other.example/' }, challenge: f.challenge, now_unix_ms: 1000 })).toThrow();
  });
  it('requires explicit trust consent before storing any private key', async () => {
    const f = fixture();
    await expect(completeGatewayPairing({ ...f, trust_accepted: false, now_unix_ms: 1000 })).rejects.toThrow();
    expect(f.values.size).toBe(0);
  });
  it('binds the exact independent permissions into both pairing proofs', () => {
    const f = fixture();
    const permissions: GatewayPermissions = { access: true, manage_members: true, configure_cloud: false };
    const request = buildPairingCompleteRequest(f.material, f.challenge, permissions);
    const { proof, ...payload } = request;
    expect(verifyGatewaySignature(f.material.client_public_key, pairingProofPayload(payload), proof)).toBe(true);
    expect(verifyGatewaySignature(f.material.client_public_key, pairingProofPayload({ ...payload, permissions: { ...permissions, configure_cloud: true } }), proof)).toBe(false);
    const response = { protocol_version: GATEWAY_PROTOCOL_VERSION, gateway_id: f.challenge.gateway_id,
      client_key_id: f.material.client_key_id, paired_at_unix_ms: 1000, permissions, proof: '' };
    const { proof: _responseProof, ...body } = response;
    response.proof = signGatewayPayload(f.machine.client_private_key, pairingCompleteResponsePayload({ ...body,
      client_nonce: f.material.client_nonce, gateway_nonce: f.challenge.gateway_nonce, binding_audience: f.material.binding_audience }));
    expect(() => assertGatewayPairingCompleteResponse(f.material, f.challenge, response, permissions)).not.toThrow();
    expect(() => assertGatewayPairingCompleteResponse(f.material, f.challenge, { ...response, permissions: { ...permissions, configure_cloud: true } }, permissions)).toThrow();
    expect(buildPairingCompleteRequest(f.material, f.challenge).permissions).toEqual({ access: true, manage_members: false, configure_cloud: false });
  });
  it('fences unpaired, revoked and edited destinations and deletes the revoked secure key', async () => {
    const f = fixture();
    const call = (record: typeof f.record) => createGatewayAuthHeaders({ record, method: 'POST', route: '/gateway/v4/catalog', body: {}, secret_store: f.secret_store });
    await expect(call(f.record)).rejects.toMatchObject({ code: 'GATEWAY_PAIRING_REQUIRED' });
    const profile = await f.pair();
    await expect(call({ ...f.record, connection: { kind: 'url', base_url: 'https://other.example/' }, trust_profile: profile })).rejects.toMatchObject({ code: 'GATEWAY_TRUST_CHANGED' });
    const revoked = await revokeGatewayTrust(profile, f.secret_store, 1500);
    expect(f.values.size).toBe(0);
    await expect(call({ ...f.record, trust_profile: revoked })).rejects.toMatchObject({ code: 'GATEWAY_TRUST_REVOKED' });
  });
});

 it('retains pairing across addresses only after fresh pinned-key proof', async () => {
   const { verifyGatewayConnectionChange } = await import('./gatewayRegistration');
   const f = fixture(), profile = await f.pair();
   const record = { ...f.record, trust_profile: profile };
   const nonce = 'fresh-address-proof-nonce';
   const connection = { kind: 'url' as const, base_url: 'https://new-gateway.example/' };
   let proof: Record<string, unknown> = {};
   const updated = await verifyGatewayConnectionChange(record, connection, async candidate => {
     proof = { binding_audience: connection.base_url, expires_at_unix_ms: 2000, gateway_id: profile.gateway_id,
       nonce, protocol_version: GATEWAY_PROTOCOL_VERSION, signature: '' };
     proof.signature = signGatewayPayload(f.machine.client_private_key, JSON.stringify(proof));
     assertGatewayAddressProof(candidate, nonce, proof, 1000);
     for (const patch of [{ gateway_id: 'other' }, { binding_audience: profile.binding_audience }, { nonce: 'replayed' },
       { expires_at_unix_ms: 1000 }, { signature: signGatewayPayload(f.material.client_private_key, JSON.stringify({ ...proof, signature: '' })) }]) {
       expect(() => assertGatewayAddressProof(candidate, nonce, { ...proof, ...patch }, 1000)).toThrow();
     }
   });
   expect(updated).toMatchObject({ gateway_id: profile.gateway_id, paired_client_private_key_ref: profile.paired_client_private_key_ref, binding_audience: connection.base_url });
   expect(record.trust_profile.binding_audience).toBe(profile.binding_audience);
   await expect(verifyGatewayConnectionChange(record, connection, async () => { throw new Error('identity changed'); })).rejects.toThrow('identity changed');
 });
