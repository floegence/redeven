import { createHash, randomBytes } from 'node:crypto';

import { normalizeControlPlaneOrigin } from '../shared/controlPlaneProvider';

export const DESKTOP_CONTROL_PLANE_PKCE_METHOD = 'S256';
export const DESKTOP_CONTROL_PLANE_AUTHORIZATION_TTL_MS = 5 * 60_000;

export type PendingControlPlaneAuthorization = Readonly<{
  state: string;
  provider_origin: string;
  provider_id?: string;
  code_verifier: string;
  code_challenge: string;
  requested_env_public_id?: string;
  label?: string;
  display_label?: string;
  created_at_unix_ms: number;
  expires_at_unix_ms: number;
}>;

type CreatePendingControlPlaneAuthorizationInput = Readonly<{
  providerOrigin: string;
  providerID?: string;
  requestedEnvPublicID?: string;
  label?: string;
  displayLabel?: string;
  now?: number;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function randomBase64URL(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function buildControlPlaneCodeChallenge(codeVerifier: string): string {
  const cleanVerifier = compact(codeVerifier);
  if (cleanVerifier === '') {
    throw new Error('Desktop code verifier is required.');
  }
  return createHash('sha256').update(cleanVerifier, 'utf8').digest('base64url');
}

export function createPendingControlPlaneAuthorization(
  input: CreatePendingControlPlaneAuthorizationInput,
): PendingControlPlaneAuthorization {
  const providerOrigin = normalizeControlPlaneOrigin(input.providerOrigin);
  const now = Number.isFinite(input.now) ? Math.floor(Number(input.now)) : Date.now();
  const codeVerifier = randomBase64URL(32);

  return {
    state: randomBase64URL(16),
    provider_origin: providerOrigin,
    provider_id: compact(input.providerID) || undefined,
    code_verifier: codeVerifier,
    code_challenge: buildControlPlaneCodeChallenge(codeVerifier),
    requested_env_public_id: compact(input.requestedEnvPublicID) || undefined,
    label: compact(input.label) || undefined,
    display_label: compact(input.displayLabel) || undefined,
    created_at_unix_ms: now,
    expires_at_unix_ms: now + DESKTOP_CONTROL_PLANE_AUTHORIZATION_TTL_MS,
  };
}

export function buildControlPlaneAuthorizationBrowserURL(
  providerOrigin: string,
  pendingAuthorization: PendingControlPlaneAuthorization,
): string {
  const url = new URL('/desktop/connect', normalizeControlPlaneOrigin(providerOrigin));
  url.searchParams.set('desktop_state', compact(pendingAuthorization.state));
  url.searchParams.set('code_challenge', compact(pendingAuthorization.code_challenge));
  url.searchParams.set('code_challenge_method', DESKTOP_CONTROL_PLANE_PKCE_METHOD);
  return url.toString();
}

export function isPendingControlPlaneAuthorizationExpired(
  pendingAuthorization: PendingControlPlaneAuthorization,
  now = Date.now(),
): boolean {
  return pendingAuthorization.expires_at_unix_ms <= now;
}
