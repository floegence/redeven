import { describe, expect, it } from 'vitest';

import {
  DESKTOP_CONTROL_PLANE_AUTHORIZATION_TTL_MS,
  DESKTOP_CONTROL_PLANE_PKCE_METHOD,
  buildControlPlaneAuthorizationBrowserURL,
  buildControlPlaneCodeChallenge,
  createPendingControlPlaneAuthorization,
  isPendingControlPlaneAuthorizationExpired,
} from './controlPlaneAuthorization';

describe('controlPlaneAuthorization', () => {
  it('creates a pending authorization with a local PKCE verifier and challenge', () => {
    const pending = createPendingControlPlaneAuthorization({
      providerOrigin: 'https://dev.redeven.test/provider/path?q=1',
      providerID: 'redeven_portal',
      requestedEnvPublicID: ' env_demo ',
      label: ' Demo Environment ',
      displayLabel: ' Demo Portal ',
      now: 1_710_000_000_000,
    });

    expect(pending.provider_origin).toBe('https://dev.redeven.test');
    expect(pending.provider_id).toBe('redeven_portal');
    expect(pending.requested_env_public_id).toBe('env_demo');
    expect(pending.label).toBe('Demo Environment');
    expect(pending.display_label).toBe('Demo Portal');
    expect(pending.code_verifier).toHaveLength(43);
    expect(pending.code_challenge).toHaveLength(43);
    expect(pending.code_challenge).toBe(buildControlPlaneCodeChallenge(pending.code_verifier));
    expect(pending.expires_at_unix_ms).toBe(1_710_000_000_000 + DESKTOP_CONTROL_PLANE_AUTHORIZATION_TTL_MS);
  });

  it('builds the browser authorization URL for the desktop PKCE flow', () => {
    const pending = createPendingControlPlaneAuthorization({
      providerOrigin: 'https://dev.redeven.test',
      now: 1_710_000_000_000,
    });

    expect(buildControlPlaneAuthorizationBrowserURL('https://dev.redeven.test', pending)).toBe(
      `https://dev.redeven.test/desktop/connect?desktop_state=${encodeURIComponent(pending.state)}&code_challenge=${encodeURIComponent(pending.code_challenge)}&code_challenge_method=${DESKTOP_CONTROL_PLANE_PKCE_METHOD}`,
    );
  });

  it('detects expired pending authorizations', () => {
    const pending = createPendingControlPlaneAuthorization({
      providerOrigin: 'https://dev.redeven.test',
      now: 1_710_000_000_000,
    });

    expect(isPendingControlPlaneAuthorizationExpired(pending, pending.expires_at_unix_ms - 1)).toBe(false);
    expect(isPendingControlPlaneAuthorizationExpired(pending, pending.expires_at_unix_ms)).toBe(true);
  });
});
