import { describe, expect, it } from 'vitest';

import {
  assertGatewayConnectArtifactProof,
  assertGatewayPairingChallenge,
  assertGatewayPairingCompleteResponse,
  completeGatewayPairing,
  createGatewayAuthHeaders,
  createGatewayPairingMaterial,
  gatewayPublicKeyFingerprint,
  pairingChallengePayload,
  pairingChallengeRequest,
  pairingCompleteResponsePayload,
  revokeGatewayTrust,
  signGatewayPayload,
  gatewayConnectArtifactProofPayload,
  type GatewaySecretStore,
} from './gatewayTrust';
import type { GatewayRecord } from './gatewayStore';

function memorySecretStore(): GatewaySecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    writeSecret: (key, value) => {
      values.set(key, value);
    },
    readSecret: (key) => values.get(key) ?? '',
    deleteSecret: (key) => {
      values.delete(key);
    },
  };
}

function gatewayRecord(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
  return {
    schema_version: 1,
    gateway_id: 'gw_demo',
    display_name: 'Demo Gateway',
    connection: {
      kind: 'url',
      base_url: 'https://gateway.example/',
    },
    created_at_ms: 1,
    updated_at_ms: 1,
    ...overrides,
  };
}

function signedChallenge(
  material: ReturnType<typeof createGatewayPairingMaterial>,
  gatewayMaterial: ReturnType<typeof createGatewayPairingMaterial>,
  overrides: Partial<{
    protocol_version: string;
    gateway_id: string;
    gateway_nonce: string;
    expires_at_unix_ms: number;
  }> = {},
) {
  const challenge = {
    protocol_version: overrides.protocol_version ?? 'redeven-runtime-gateway-v1',
    gateway_id: overrides.gateway_id ?? 'gw_demo',
    gateway_public_key: gatewayMaterial.client_public_key,
    gateway_public_key_fingerprint: gatewayPublicKeyFingerprint(gatewayMaterial.client_public_key),
    gateway_nonce: overrides.gateway_nonce ?? 'gateway-nonce',
    expires_at_unix_ms: overrides.expires_at_unix_ms ?? 2_000,
  };
  return {
    ...challenge,
    signature: signGatewayPayload(gatewayMaterial.client_private_key, pairingChallengePayload({
      protocol_version: challenge.protocol_version,
      client_nonce: material.client_nonce,
      gateway_nonce: challenge.gateway_nonce,
      gateway_id: challenge.gateway_id,
      binding_audience: material.binding_audience,
      client_public_key: material.client_public_key,
      gateway_public_key: challenge.gateway_public_key,
      expires_at_unix_ms: challenge.expires_at_unix_ms,
    })),
  };
}

describe('gatewayTrust', () => {
  it('requires explicit user confirmation before saving pairing material', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);

    await expect(completeGatewayPairing({
      record,
      material,
      challenge: signedChallenge(material, gatewayMaterial),
      user_confirmed: false,
      secret_store: store,
      now_unix_ms: 1_000,
    })).rejects.toMatchObject({ code: 'GATEWAY_PAIRING_CONFIRMATION_REQUIRED' });
    expect(store.values.size).toBe(0);
  });

  it('stores only the Desktop private key in the secret store after pairing', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);
    const challenge = signedChallenge(material, gatewayMaterial);

    const profile = await completeGatewayPairing({
      record,
      material,
      challenge,
      user_confirmed: true,
      secret_store: store,
      now_unix_ms: 1_000,
    });

    expect(profile).toMatchObject({
      gateway_id: record.gateway_id,
      paired_client_key_id: material.client_key_id,
      paired_client_private_key_ref: material.private_key_ref,
      gateway_public_key: gatewayMaterial.client_public_key,
      gateway_public_key_fingerprint: challenge.gateway_public_key_fingerprint,
      binding_audience: 'https://gateway.example/',
    });
    expect(store.values.get(material.private_key_ref)).toContain('PRIVATE KEY');
    expect(JSON.stringify(profile)).not.toContain('PRIVATE KEY');
  });

  it('rejects pairing challenges without an exact protocol version', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);

    await expect(completeGatewayPairing({
      record,
      material,
      challenge: signedChallenge(material, gatewayMaterial, { protocol_version: '' }),
      user_confirmed: true,
      secret_store: store,
      now_unix_ms: 1_000,
    })).rejects.toMatchObject({ code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' });
  });

  it('rejects pairing challenges with invalid Gateway signatures', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);

    await expect(completeGatewayPairing({
      record,
      material,
      challenge: {
        ...signedChallenge(material, gatewayMaterial),
        signature: 'invalid-signature',
      },
      user_confirmed: true,
      secret_store: store,
      now_unix_ms: 1_000,
    })).rejects.toMatchObject({ code: 'GATEWAY_PAIRING_SIGNATURE_INVALID' });
    expect(store.values.size).toBe(0);
  });

  it('validates pairing challenges before user confirmation or complete requests', () => {
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);
    const challenge = signedChallenge(material, gatewayMaterial);

    expect(assertGatewayPairingChallenge({
      record,
      material,
      challenge,
      now_unix_ms: 1_000,
    })).toBe(challenge.gateway_public_key_fingerprint);
    expect(() => assertGatewayPairingChallenge({
      record,
      material,
      challenge: { ...challenge, gateway_id: 'gw_other' },
      now_unix_ms: 1_000,
    })).toThrow('Gateway pairing response does not match the saved Gateway');
    expect(() => assertGatewayPairingChallenge({
      record,
      material,
      challenge: signedChallenge(material, gatewayMaterial, { expires_at_unix_ms: 999 }),
      now_unix_ms: 1_000,
    })).toThrow('Gateway pairing challenge expired');
    expect(() => assertGatewayPairingChallenge({
      record,
      material,
      challenge: { ...challenge, signature: 'invalid' },
      now_unix_ms: 1_000,
    })).toThrow('Gateway pairing challenge signature is invalid');
  });

  it('verifies pairing completion responses before the private key is persisted', () => {
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);
    const challenge = signedChallenge(material, gatewayMaterial);
    const response = {
      protocol_version: 'redeven-runtime-gateway-v1',
      gateway_id: record.gateway_id,
      client_key_id: material.client_key_id,
      paired_at_unix_ms: 1_000,
      proof: signGatewayPayload(gatewayMaterial.client_private_key, pairingCompleteResponsePayload({
        protocol_version: 'redeven-runtime-gateway-v1',
        client_nonce: material.client_nonce,
        gateway_nonce: challenge.gateway_nonce,
        gateway_id: record.gateway_id,
        binding_audience: material.binding_audience,
        client_key_id: material.client_key_id,
        paired_at_unix_ms: 1_000,
      })),
    };

    expect(() => assertGatewayPairingCompleteResponse(material, challenge, response)).not.toThrow();
    expect(() => assertGatewayPairingCompleteResponse(material, challenge, {
      ...response,
      proof: 'invalid',
    })).toThrow('Gateway pairing completion signature is invalid');
  });

  it('blocks authenticated calls until the Gateway is paired and not revoked', async () => {
    const store = memorySecretStore();
    await expect(createGatewayAuthHeaders({
      record: gatewayRecord(),
      method: 'POST',
      route: '/gateway/v1/catalog',
      body: {},
      secret_store: store,
    })).rejects.toMatchObject({ code: 'GATEWAY_PAIRING_REQUIRED' });

    const profile = {
      trust_profile_id: 'gtp_demo',
      paired_client_key_id: 'gck_demo',
      paired_client_private_key_ref: 'gateway-client-key:gw_demo:gck_demo',
      gateway_id: 'gw_demo',
      gateway_public_key: 'PUBLIC KEY',
      gateway_public_key_fingerprint: 'SHA256:fingerprint',
      binding_audience: 'https://gateway.example/',
      created_at_unix_ms: 1,
      revoked_at_unix_ms: 2,
    };
    await expect(createGatewayAuthHeaders({
      record: gatewayRecord({ trust_profile: profile }),
      method: 'POST',
      route: '/gateway/v1/catalog',
      body: {},
      secret_store: store,
    })).rejects.toMatchObject({ code: 'GATEWAY_TRUST_REVOKED' });
  });

  it('pins authenticated calls to the transport binding audience', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    store.values.set(material.private_key_ref, material.client_private_key);
    const paired = gatewayRecord({
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: material.client_key_id,
        paired_client_private_key_ref: material.private_key_ref,
        gateway_id: 'gw_demo',
        gateway_public_key: 'PUBLIC KEY',
        gateway_public_key_fingerprint: 'SHA256:fingerprint',
        binding_audience: 'https://old.example/',
        created_at_unix_ms: 1,
      },
    });

    await expect(createGatewayAuthHeaders({
      record: paired,
      method: 'POST',
      route: '/gateway/v1/catalog',
      body: {},
      secret_store: store,
    })).rejects.toMatchObject({ code: 'GATEWAY_TRUST_CHANGED' });
  });

  it('creates signed request headers without bearer/provider/runtime-control credentials', async () => {
    const store = memorySecretStore();
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    store.values.set(material.private_key_ref, material.client_private_key);

    const headers = await createGatewayAuthHeaders({
      record: gatewayRecord({
        trust_profile: {
          trust_profile_id: 'gtp_demo',
          paired_client_key_id: material.client_key_id,
          paired_client_private_key_ref: material.private_key_ref,
          gateway_id: 'gw_demo',
          gateway_public_key: 'PUBLIC KEY',
          gateway_public_key_fingerprint: 'SHA256:fingerprint',
          binding_audience: 'https://gateway.example/',
          created_at_unix_ms: 1,
        },
      }),
      method: 'POST',
      route: '/gateway/v1/catalog',
      body: { protocol_version: 'redeven-runtime-gateway-v1' },
      secret_store: store,
      timestamp_unix_ms: 1_770_000_000_000,
      nonce: 'nonce',
    });

    expect(headers).toMatchObject({
      'x-redeven-gateway-id': 'gw_demo',
      'x-redeven-client-key-id': material.client_key_id,
      'x-redeven-client-nonce': 'nonce',
      'x-redeven-request-ts': '1770000000000',
    });
    expect(headers.authorization).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain('provider-token');
    expect(JSON.stringify(headers)).not.toContain('runtime-control-token');
  });

  it('revokes trust by deleting the secure storage key reference', async () => {
    const store = memorySecretStore();
    store.values.set('key-ref', 'PRIVATE KEY');
    const revoked = await revokeGatewayTrust({
      trust_profile_id: 'gtp_demo',
      paired_client_key_id: 'gck_demo',
      paired_client_private_key_ref: 'key-ref',
      gateway_id: 'gw_demo',
      gateway_public_key: 'PUBLIC KEY',
      gateway_public_key_fingerprint: 'SHA256:fingerprint',
      binding_audience: 'https://gateway.example/',
      created_at_unix_ms: 1,
    }, store, 2);

    expect(store.values.has('key-ref')).toBe(false);
    expect(revoked.revoked_at_unix_ms).toBe(2);
  });

  it('builds pairing challenge requests from generated key material', () => {
    const material = createGatewayPairingMaterial(gatewayRecord());
    expect(pairingChallengeRequest(material)).toMatchObject({
      protocol_version: 'redeven-runtime-gateway-v1',
      client_nonce: material.client_nonce,
      client_public_key: material.client_public_key,
      binding_audience: 'https://gateway.example/',
    });
  });

  it('rejects open-session artifacts whose proof is not signed by the pinned Gateway key', () => {
    const record = gatewayRecord();
    const material = createGatewayPairingMaterial(record);
    const gatewayMaterial = createGatewayPairingMaterial(record);
    const challenge = signedChallenge(material, gatewayMaterial);
    const paired = gatewayRecord({
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: material.client_key_id,
        paired_client_private_key_ref: material.private_key_ref,
        gateway_id: record.gateway_id,
        gateway_public_key: gatewayMaterial.client_public_key,
        gateway_public_key_fingerprint: challenge.gateway_public_key_fingerprint,
        binding_audience: 'https://gateway.example/',
        created_at_unix_ms: 1,
      },
    });

    expect(() => assertGatewayConnectArtifactProof({
      record: paired,
      gateway_env_id: 'env_demo',
      requested_capability: 'env_app',
      client_nonce: 'client-nonce',
      gateway_session_id: 'session-demo',
      artifact: {
        kind: 'desktop_bridge_artifact',
        bridge_session_id: 'bridge_demo',
        route_id: 'route_demo',
        expires_at_unix_ms: Date.now() + 60_000,
        artifact_nonce: 'artifact-nonce',
        proof: 'invalid-proof',
      },
    })).toThrow('Gateway connect artifact proof is invalid');
  });

  it('binds open-session artifact proofs to the pinned Gateway audience', () => {
    const payload = gatewayConnectArtifactProofPayload({
      gateway_id: 'gw_demo',
      gateway_env_id: 'env_demo',
      gateway_session_id: 'session-demo',
      binding_audience: 'https://gateway.example/',
      requested_capability: 'env_app',
      client_nonce: 'client-nonce',
      artifact_kind: 'local_direct_artifact',
      artifact_url: 'https://gateway.example/_redeven_proxy/env/',
      expires_at_unix_ms: 1_900_000_000_000,
      artifact_nonce: 'artifact-nonce',
    });

    expect(payload).toContain('"binding_audience":"https://gateway.example/"');
  });
});
