import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signPayload,
  verify as verifyPayload,
} from 'node:crypto';

import {
  GATEWAY_STORE_SCHEMA_VERSION,
  gatewayBindingAudience,
  type GatewayRecord,
  type GatewayTrustProfile,
} from './gatewayStore';

export const GATEWAY_TRUST_SIGNATURE_ALGORITHM = 'ed25519';

export type GatewaySecretStore = Readonly<{
  writeSecret: (key: string, value: string) => Promise<void> | void;
  readSecret: (key: string) => Promise<string> | string;
  deleteSecret: (key: string) => Promise<void> | void;
}>;

export type GatewayPairingMaterial = Readonly<{
  client_nonce: string;
  client_public_key: string;
  client_private_key: string;
  client_key_id: string;
  private_key_ref: string;
  binding_audience: string;
}>;

export type GatewayPairingChallengeResponse = Readonly<{
  protocol_version: string;
  gateway_id: string;
  gateway_public_key: string;
  gateway_public_key_fingerprint?: string;
  gateway_nonce: string;
  pairing_code?: string;
  expires_at_unix_ms: number;
  signature: string;
}>;

export type GatewayPairingCompleteRequest = Readonly<{
  protocol_version: 'redeven-runtime-gateway-v1';
  client_nonce: string;
  gateway_nonce: string;
  gateway_id: string;
  binding_audience: string;
  client_key_id: string;
  proof: string;
}>;

export type GatewayPairingCompleteResponse = Readonly<{
  protocol_version: string;
  gateway_id: string;
  client_key_id: string;
  paired_at_unix_ms: number;
  proof: string;
}>;

export type GatewayAuthenticatedRequestInput = Readonly<{
  record: GatewayRecord;
  method: string;
  route: string;
  body: unknown;
  timestamp_unix_ms?: number;
  nonce?: string;
  private_key?: string;
  secret_store?: GatewaySecretStore;
}>;

export type GatewayAuthenticatedHeaders = Readonly<Record<string, string>>;

export class GatewayTrustError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayTrustError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function randomBase64URL(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function canonicalJSON(value: unknown): string {
  if (value == null) {
    return '';
  }
  return JSON.stringify(sortJSONValue(value));
}

function sortJSONValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJSONValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJSONValue(nested)]),
    );
  }
  return value;
}

function sha256Base64URL(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function gatewayPublicKeyFingerprint(publicKey: string): string {
  const clean = compact(publicKey);
  if (!clean) {
    throw new GatewayTrustError('GATEWAY_PUBLIC_KEY_REQUIRED', 'Gateway public key is required.');
  }
  return `SHA256:${sha256Base64URL(clean)}`;
}

export function gatewayClientKeyID(publicKey: string): string {
  return `gck_${sha256Base64URL(compact(publicKey)).slice(0, 24)}`;
}

export function createGatewayPairingMaterial(record: GatewayRecord): GatewayPairingMaterial {
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const clientPublicKey = compact(pair.publicKey);
  const clientPrivateKey = compact(pair.privateKey);
  const clientKeyID = gatewayClientKeyID(clientPublicKey);
  return {
    client_nonce: randomBase64URL(24),
    client_public_key: clientPublicKey,
    client_private_key: clientPrivateKey,
    client_key_id: clientKeyID,
    private_key_ref: `gateway-client-key:${record.gateway_id}:${clientKeyID}`,
    binding_audience: gatewayBindingAudience(record.connection),
  };
}

export function pairingChallengeRequest(material: GatewayPairingMaterial): Readonly<{
  protocol_version: 'redeven-runtime-gateway-v1';
  client_nonce: string;
  client_public_key: string;
  binding_audience: string;
}> {
  return {
    protocol_version: 'redeven-runtime-gateway-v1',
    client_nonce: material.client_nonce,
    client_public_key: compact(material.client_public_key),
    binding_audience: material.binding_audience,
  };
}

export function pairingProofPayload(input: Readonly<{
  protocol_version: string;
  client_nonce: string;
  gateway_nonce: string;
  gateway_id: string;
  binding_audience: string;
  client_key_id: string;
}>): string {
  return canonicalJSON(input);
}

export function signGatewayPayload(privateKey: string, payload: string): string {
  const cleanPrivateKey = compact(privateKey);
  if (!cleanPrivateKey) {
    throw new GatewayTrustError('GATEWAY_CLIENT_PRIVATE_KEY_REQUIRED', 'Gateway client private key is required.');
  }
  return signPayload(null, Buffer.from(payload, 'utf8'), cleanPrivateKey).toString('base64url');
}

export function verifyGatewaySignature(publicKey: string, payload: string, signature: string): boolean {
  const cleanPublicKey = compact(publicKey);
  const cleanSignature = compact(signature);
  if (!cleanPublicKey || !cleanSignature) {
    return false;
  }
  try {
    return verifyPayload(null, Buffer.from(payload, 'utf8'), cleanPublicKey, Buffer.from(cleanSignature, 'base64url'));
  } catch {
    return false;
  }
}

export function pairingChallengePayload(input: Readonly<{
  protocol_version: string;
  client_nonce: string;
  gateway_nonce: string;
  gateway_id: string;
  binding_audience: string;
  client_public_key: string;
  gateway_public_key: string;
  expires_at_unix_ms: number;
}>): string {
  return canonicalJSON(input);
}

export function buildPairingCompleteRequest(
  material: GatewayPairingMaterial,
  challenge: GatewayPairingChallengeResponse,
): GatewayPairingCompleteRequest {
  const gatewayID = compact(challenge.gateway_id);
  const gatewayNonce = compact(challenge.gateway_nonce);
  if (!gatewayID || !gatewayNonce) {
    throw new GatewayTrustError('GATEWAY_PAIRING_CHALLENGE_INVALID', 'Gateway pairing challenge is incomplete.');
  }
  const base = {
    protocol_version: 'redeven-runtime-gateway-v1' as const,
    client_nonce: material.client_nonce,
    gateway_nonce: gatewayNonce,
    gateway_id: gatewayID,
    binding_audience: material.binding_audience,
    client_key_id: material.client_key_id,
  };
  return {
    ...base,
    proof: signGatewayPayload(material.client_private_key, pairingProofPayload(base)),
  };
}

export function pairingCompleteResponsePayload(input: Readonly<{
  protocol_version: string;
  client_nonce: string;
  gateway_nonce: string;
  gateway_id: string;
  binding_audience: string;
  client_key_id: string;
  paired_at_unix_ms: number;
}>): string {
  return canonicalJSON(input);
}

export function gatewayConnectArtifactProofPayload(input: Readonly<{
  gateway_id: string;
  gateway_env_id: string;
  gateway_session_id: string;
  binding_audience: string;
  requested_capability: string;
  client_nonce: string;
  artifact_kind: string;
  artifact_url?: string;
  bridge_session_id?: string;
  route_id?: string;
  expires_at_unix_ms: number;
  artifact_nonce: string;
}>): string {
  return canonicalJSON({
    protocol_version: 'redeven-runtime-gateway-v1',
    gateway_id: input.gateway_id,
    gateway_env_id: input.gateway_env_id,
    gateway_session_id: input.gateway_session_id,
    binding_audience: input.binding_audience,
    requested_capability: input.requested_capability,
    client_nonce: input.client_nonce,
    artifact_kind: input.artifact_kind,
    artifact_url: compact(input.artifact_url),
    bridge_session_id: compact(input.bridge_session_id),
    route_id: compact(input.route_id),
    expires_at_unix_ms: input.expires_at_unix_ms,
    artifact_nonce: input.artifact_nonce,
  });
}

export function assertGatewayPairingChallengeSignature(
  material: GatewayPairingMaterial,
  challenge: GatewayPairingChallengeResponse,
): void {
  const payload = pairingChallengePayload({
    protocol_version: challenge.protocol_version,
    client_nonce: material.client_nonce,
    gateway_nonce: challenge.gateway_nonce,
    gateway_id: challenge.gateway_id,
    binding_audience: material.binding_audience,
    client_public_key: compact(material.client_public_key),
    gateway_public_key: challenge.gateway_public_key,
    expires_at_unix_ms: challenge.expires_at_unix_ms,
  });
  if (!verifyGatewaySignature(challenge.gateway_public_key, payload, challenge.signature)) {
    throw new GatewayTrustError('GATEWAY_PAIRING_SIGNATURE_INVALID', 'Gateway pairing challenge signature is invalid.');
  }
}

export function assertGatewayPairingChallenge(input: Readonly<{
  record: GatewayRecord;
  material: GatewayPairingMaterial;
  challenge: GatewayPairingChallengeResponse;
  now_unix_ms?: number;
}>): string {
  const now = Math.floor(input.now_unix_ms ?? Date.now());
  const gatewayID = compact(input.challenge.gateway_id);
  if (!gatewayID || gatewayID !== input.record.gateway_id) {
    throw new GatewayTrustError('GATEWAY_PAIRING_ID_MISMATCH', 'Gateway pairing response does not match the saved Gateway.');
  }
  const expiresAt = Number(input.challenge.expires_at_unix_ms);
  if (!Number.isFinite(expiresAt) || Math.floor(expiresAt) <= now) {
    throw new GatewayTrustError('GATEWAY_PAIRING_CHALLENGE_EXPIRED', 'Gateway pairing challenge expired.');
  }
  if (input.challenge.protocol_version !== 'redeven-runtime-gateway-v1') {
    throw new GatewayTrustError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol version is not supported.');
  }
  const expectedFingerprint = gatewayPublicKeyFingerprint(input.challenge.gateway_public_key);
  const observedFingerprint = compact(input.challenge.gateway_public_key_fingerprint) || expectedFingerprint;
  if (observedFingerprint !== expectedFingerprint) {
    throw new GatewayTrustError('GATEWAY_FINGERPRINT_INVALID', 'Gateway fingerprint does not match the advertised public key.');
  }
  assertGatewayPairingChallengeSignature(input.material, input.challenge);
  return expectedFingerprint;
}

export function assertGatewayPairingCompleteResponse(
  material: GatewayPairingMaterial,
  challenge: GatewayPairingChallengeResponse,
  response: GatewayPairingCompleteResponse,
): void {
  if (response.protocol_version !== 'redeven-runtime-gateway-v1') {
    throw new GatewayTrustError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol version is not supported.');
  }
  if (response.gateway_id !== challenge.gateway_id || response.client_key_id !== material.client_key_id) {
    throw new GatewayTrustError('GATEWAY_PAIRING_COMPLETE_MISMATCH', 'Gateway pairing completion response does not match this pairing request.');
  }
  if (!Number.isFinite(Number(response.paired_at_unix_ms)) || Number(response.paired_at_unix_ms) <= 0) {
    throw new GatewayTrustError('GATEWAY_PAIRING_COMPLETE_INVALID', 'Gateway pairing completion response is incomplete.');
  }
  const payload = pairingCompleteResponsePayload({
    protocol_version: response.protocol_version,
    client_nonce: material.client_nonce,
    gateway_nonce: challenge.gateway_nonce,
    gateway_id: response.gateway_id,
    binding_audience: material.binding_audience,
    client_key_id: response.client_key_id,
    paired_at_unix_ms: response.paired_at_unix_ms,
  });
  if (!verifyGatewaySignature(challenge.gateway_public_key, payload, response.proof)) {
    throw new GatewayTrustError('GATEWAY_PAIRING_COMPLETE_SIGNATURE_INVALID', 'Gateway pairing completion signature is invalid.');
  }
}

export function assertGatewayConnectArtifactProof(input: Readonly<{
  record: GatewayRecord;
  gateway_env_id: string;
  requested_capability: string;
  client_nonce: string;
  gateway_session_id: string;
  artifact: Readonly<{
    kind: string;
    url?: string;
    bridge_session_id?: string;
    route_id?: string;
    expires_at_unix_ms: number;
    artifact_nonce: string;
    proof: string;
  }>;
}>): void {
  const profile = assertGatewayTrustForCall(input.record);
  const payload = gatewayConnectArtifactProofPayload({
    gateway_id: input.record.gateway_id,
    gateway_env_id: input.gateway_env_id,
    gateway_session_id: input.gateway_session_id,
    binding_audience: profile.binding_audience,
    requested_capability: input.requested_capability,
    client_nonce: input.client_nonce,
    artifact_kind: input.artifact.kind,
    artifact_url: input.artifact.url,
    bridge_session_id: input.artifact.bridge_session_id,
    route_id: input.artifact.route_id,
    expires_at_unix_ms: input.artifact.expires_at_unix_ms,
    artifact_nonce: input.artifact.artifact_nonce,
  });
  if (!verifyGatewaySignature(profile.gateway_public_key, payload, input.artifact.proof)) {
    throw new GatewayTrustError('GATEWAY_ARTIFACT_PROOF_INVALID', 'Gateway connect artifact proof is invalid.');
  }
}

export async function completeGatewayPairing(input: Readonly<{
  record: GatewayRecord;
  material: GatewayPairingMaterial;
  challenge: GatewayPairingChallengeResponse;
  user_confirmed: boolean;
  secret_store: GatewaySecretStore;
  now_unix_ms?: number;
}>): Promise<GatewayTrustProfile> {
  if (!input.user_confirmed) {
    throw new GatewayTrustError('GATEWAY_PAIRING_CONFIRMATION_REQUIRED', 'Confirm the Gateway fingerprint before pairing.');
  }
  const now = Math.floor(input.now_unix_ms ?? Date.now());
  const expectedFingerprint = assertGatewayPairingChallenge({
    record: input.record,
    material: input.material,
    challenge: input.challenge,
    now_unix_ms: now,
  });
  await input.secret_store.writeSecret(input.material.private_key_ref, input.material.client_private_key);
  return {
    trust_profile_id: `gtp_${randomBase64URL(18)}`,
    paired_client_key_id: input.material.client_key_id,
    paired_client_private_key_ref: input.material.private_key_ref,
    gateway_id: input.record.gateway_id,
    gateway_public_key: compact(input.challenge.gateway_public_key),
    gateway_public_key_fingerprint: expectedFingerprint,
    binding_audience: input.material.binding_audience,
    created_at_unix_ms: now,
    last_verified_at_unix_ms: now,
  };
}

export function assertGatewayTrustForCall(record: GatewayRecord): GatewayTrustProfile {
  const profile = record.trust_profile;
  if (!profile) {
    throw new GatewayTrustError('GATEWAY_PAIRING_REQUIRED', 'Pair this Gateway before making authenticated calls.');
  }
  if (profile.revoked_at_unix_ms) {
    throw new GatewayTrustError('GATEWAY_TRUST_REVOKED', 'Gateway trust has been revoked.');
  }
  if (profile.gateway_id !== record.gateway_id) {
    throw new GatewayTrustError('GATEWAY_TRUST_ID_MISMATCH', 'Gateway trust profile does not match this Gateway.');
  }
  if (profile.binding_audience !== gatewayBindingAudience(record.connection)) {
    throw new GatewayTrustError('GATEWAY_TRUST_CHANGED', 'Gateway connection identity changed and must be paired again.');
  }
  return profile;
}

export function assertGatewayFingerprint(profile: GatewayTrustProfile, observedFingerprint: string): void {
  const cleanObserved = compact(observedFingerprint);
  if (!cleanObserved || cleanObserved !== profile.gateway_public_key_fingerprint) {
    throw new GatewayTrustError('GATEWAY_TRUST_CHANGED', 'Gateway identity changed and must be paired again.');
  }
}

export async function revokeGatewayTrust(
  profile: GatewayTrustProfile,
  secretStore: GatewaySecretStore,
  nowUnixMS = Date.now(),
): Promise<GatewayTrustProfile> {
  await secretStore.deleteSecret(profile.paired_client_private_key_ref);
  return {
    ...profile,
    revoked_at_unix_ms: Math.floor(nowUnixMS),
  };
}

export function repairGatewayTrust(record: GatewayRecord): GatewayRecord {
  return {
    ...record,
    schema_version: GATEWAY_STORE_SCHEMA_VERSION,
    trust_profile: undefined,
    updated_at_ms: Date.now(),
  };
}

export async function createGatewayAuthHeaders(
  input: GatewayAuthenticatedRequestInput,
): Promise<GatewayAuthenticatedHeaders> {
  const profile = assertGatewayTrustForCall(input.record);
  const privateKey = compact(input.private_key)
    || compact(input.secret_store ? await input.secret_store.readSecret(profile.paired_client_private_key_ref) : '');
  const timestamp = Math.floor(input.timestamp_unix_ms ?? Date.now());
  const nonce = compact(input.nonce) || randomBase64URL(18);
  const bodyDigest = sha256Base64URL(canonicalJSON(input.body));
  const route = compact(input.route);
  const method = compact(input.method).toUpperCase();
  const signaturePayload = canonicalJSON({
    protocol_version: 'redeven-runtime-gateway-v1',
    method,
    route,
    body_digest: bodyDigest,
    gateway_id: input.record.gateway_id,
    binding_audience: profile.binding_audience,
    nonce,
    timestamp_unix_ms: timestamp,
  });

  return {
    'content-type': 'application/json',
    'x-redeven-gateway-id': input.record.gateway_id,
    'x-redeven-gateway-binding-audience': profile.binding_audience,
    'x-redeven-client-key-id': profile.paired_client_key_id,
    'x-redeven-client-nonce': nonce,
    'x-redeven-request-ts': String(timestamp),
    'x-redeven-request-signature': signGatewayPayload(privateKey, signaturePayload),
  };
}
