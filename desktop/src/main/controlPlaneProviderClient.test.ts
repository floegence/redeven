import { describe, expect, it, vi } from 'vitest';

import {
  DesktopProviderRequestError,
  type DesktopProviderTransport,
  type DesktopProviderTransportResponse,
} from './controlPlaneProviderTransport';
import {
  authorizeProviderRuntimeOperation,
  fetchProviderDiscovery,
  fetchProviderEnvironments,
  fetchProviderRuntimeManagementCapability,
  exchangeProviderDesktopConnectAuthorization,
  requestProviderRuntimeEnrollmentChallenge,
  requestProviderRuntimeLinkAuthorization,
  requestDesktopOpenSession,
} from './controlPlaneProviderClient';
import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';

function accessPoint(overrides: Record<string, unknown> = {}) {
  return {
    access_point_id: 'dev',
    region: 'dev',
    display_name: 'Development',
    description: 'Development access point',
    access_point_origin: 'https://dev.redeven.test',
    country_code: 'SG',
    city: 'Singapore',
    status: 'active',
    health_status: 'healthy',
    ...overrides,
  };
}

function providerPayload(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: 'rcpp-v3',
    provider_id: 'redeven',
    display_name: 'Redeven',
    provider_origin: 'https://redeven.test',
    documentation_url: 'https://redeven.test/help/control-plane-providers',
    access_points: [accessPoint()],
    ...overrides,
  };
}

function provider() {
  const normalized = normalizeDesktopControlPlaneProvider(providerPayload());
  if (!normalized) {
    throw new Error('test provider fixture is invalid');
  }
  return normalized;
}

function response(
  status: number,
  bodyText: string,
  headers: Readonly<Record<string, string>> = {
    'content-type': 'application/json',
  },
): DesktopProviderTransportResponse {
  return {
    status,
    headers,
    body_text: bodyText,
  };
}

describe('controlPlaneProviderClient', () => {
  it('normalizes provider discovery through the injected transport', async () => {
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify(providerPayload())));

    await expect(fetchProviderDiscovery('https://redeven.test', { transport })).resolves.toEqual(provider());
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://redeven.test/.well-known/redeven-provider.json',
      method: 'GET',
    }));
  });

  it('turns invalid JSON into a stable provider error', async () => {
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(
      200,
      '<!doctype html><html><body>frontend shell</body></html>',
      { 'content-type': 'text/html' },
    ));

    await expect(fetchProviderDiscovery('https://redeven.test', { transport })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_invalid_json',
      providerOrigin: 'https://redeven.test',
      status: 200,
      message: 'The provider returned invalid JSON for the provider discovery document.',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('preserves provider-side JSON errors with HTTP status', async () => {
    const normalizedProvider = provider();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(401, JSON.stringify({
      error: {
        code: 'INVALID_DESKTOP_ACCESS',
        message: 'Invalid desktop access token',
      },
    })));

    await expect(fetchProviderEnvironments(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      { transport },
    )).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_request_failed',
      providerOrigin: 'https://dev.redeven.test',
      status: 401,
      message: 'Invalid desktop access token',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('rejects malformed environment list payloads', async () => {
    const normalizedProvider = provider();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      items: [],
    })));

    await expect(fetchProviderEnvironments(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      { transport },
    )).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_invalid_response',
      providerOrigin: 'https://dev.redeven.test',
      message: 'The provider environment list is invalid.',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('posts authorization_code and code_verifier for the desktop connect exchange', async () => {
    const normalizedProvider = provider();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      access_token: 'access_demo',
      access_expires_at_unix_ms: 1_710_000_000_000,
      refresh_token: 'refresh_demo',
      authorization_expires_at_unix_ms: 1_710_000_100_000,
      provider_id: normalizedProvider.provider_id,
      provider_origin: normalizedProvider.provider_origin,
      account: {
        user_public_id: 'user_demo',
        user_display_name: 'Demo User',
        authorization_expires_at_unix_ms: 1_710_000_100_000,
      },
      access_points: [accessPoint()],
    })));

    await expect(exchangeProviderDesktopConnectAuthorization(normalizedProvider, {
      authorization_code: ' code_demo ',
      code_verifier: ' verifier_demo ',
    }, { transport })).resolves.toMatchObject({
      access_token: 'access_demo',
      refresh_token: 'refresh_demo',
      authorization_expires_at_unix_ms: 1_710_000_100_000,
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://redeven.test/api/rcpp/v3/desktop/connect/exchange',
      method: 'POST',
      body_text: JSON.stringify({
        authorization_code: 'code_demo',
        code_verifier: 'verifier_demo',
      }),
    }));
  });

  it('requests access-point desktop open session material', async () => {
    const normalizedProvider = provider();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      remote_session_url: 'https://env.dev.redeven.test/_redeven_boot/#redeven=abc',
      access_point_origin: 'https://dev.redeven.test',
      expires_at_unix_ms: 1_710_000_000_000,
    })));

    await expect(requestDesktopOpenSession(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      ' env_demo ',
      { transport },
    )).resolves.toEqual({
      remote_session_url: 'https://env.dev.redeven.test/_redeven_boot/#redeven=abc',
      access_point_origin: 'https://dev.redeven.test',
      expires_at_unix_ms: 1_710_000_000_000,
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v3/environments/env_demo/desktop/open-session',
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer access-token',
      }),
    }));
  });

  it('rejects v2 bootstrap semantics in a v3 open-session response', async () => {
    const normalizedProvider = provider();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      bootstrap_ticket: 'legacy-ticket',
      remote_session_url: 'https://env.dev.redeven.test/_redeven_boot/#redeven=abc',
      access_point_origin: 'https://dev.redeven.test',
      expires_at_unix_ms: 1_710_000_000_000,
    })));
    await expect(requestDesktopOpenSession(
      normalizedProvider, normalizedProvider.access_points[0]!, 'access-token', 'env_demo', { transport },
    )).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });

  it('rejects desktop connect exchange responses for a different provider identity', async () => {
    const normalizedProvider = provider();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      access_token: 'access_demo',
      access_expires_at_unix_ms: 1_710_000_000_000,
      refresh_token: 'refresh_demo',
      authorization_expires_at_unix_ms: 1_710_000_100_000,
      provider_id: 'other_provider',
      provider_origin: normalizedProvider.provider_origin,
      account: {
        user_public_id: 'user_demo',
        user_display_name: 'Demo User',
        authorization_expires_at_unix_ms: 1_710_000_100_000,
      },
      access_points: [accessPoint()],
    })));

    await expect(exchangeProviderDesktopConnectAuthorization(normalizedProvider, {
      authorization_code: 'code_demo',
      code_verifier: 'verifier_demo',
    }, { transport })).rejects.toMatchObject({
      code: 'provider_invalid_response',
      message: 'The provider desktop connect response is invalid.',
    });
  });

  it('rejects desktop connect exchange responses without a provider identity', async () => {
    const normalizedProvider = provider();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      access_token: 'access_demo',
      access_expires_at_unix_ms: 1_710_000_000_000,
      refresh_token: 'refresh_demo',
      authorization_expires_at_unix_ms: 1_710_000_100_000,
      account: {
        user_public_id: 'user_demo',
        user_display_name: 'Demo User',
        authorization_expires_at_unix_ms: 1_710_000_100_000,
      },
      access_points: [accessPoint()],
    })));

    await expect(exchangeProviderDesktopConnectAuthorization(normalizedProvider, {
      authorization_code: 'code_demo',
      code_verifier: 'verifier_demo',
    }, { transport })).rejects.toMatchObject({
      code: 'provider_invalid_response',
      message: 'The provider desktop connect response is invalid.',
    });
  });

  it('strictly parses scoped Runtime management capability responses', async () => {
    const normalizedProvider = provider();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v3',
      provider_id: normalizedProvider.provider_id,
      provider_origin: normalizedProvider.provider_origin,
      access_point_id: 'dev',
      env_public_id: 'env_demo',
      capability: {
        support: 'supported',
        authorization: { state: 'allowed', grants: ['manage_runtime'] },
        readiness: 'ready',
        target: { lifecycle_target_id: 'target_demo', target_generation: 7 },
        operations: ['restart', 'update_runtime'],
        artifact_policies: ['published_release'],
        binding_actions: [],
        supervision_mode: 'provider_gateway',
        checked_at_unix_ms: 1_710_000_000_000,
      },
    })));

    await expect(fetchProviderRuntimeManagementCapability(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      'env_demo',
      { transport },
    )).resolves.toMatchObject({
      presentation_state: 'allowed',
      target: { lifecycle_target_id: 'target_demo', target_generation: 7 },
      operations: ['restart', 'update_runtime'],
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v3/environments/env_demo/runtime-management/capabilities',
    }));
  });

  it('rejects v3 environment lists without the exact outer protocol version', async () => {
    const normalizedProvider = provider();
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v2',
      environments: [],
    })));
    await expect(fetchProviderEnvironments(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      { transport },
    )).rejects.toMatchObject({
      code: 'provider_invalid_response',
      message: 'The provider environment list protocol is invalid.',
    });
  });

  it('returns an operation permit only from an allowed v3 authorization', async () => {
    const normalizedProvider = provider();
    const expiresAt = Date.now() + 60_000;
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v3',
      decision: 'allowed',
      grants: ['manage_runtime'],
      permit: 'permit_demo',
      expires_at_unix_ms: expiresAt,
    })));
    await expect(authorizeProviderRuntimeOperation(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      'env_demo',
      {
        action: 'prepare',
        lifecycle_target_id: 'target_demo',
        target_generation: 7,
        operation_id: 'operation_demo',
        operation: 'restart',
        artifact_policy: 'published_release',
        authorized_client_key_id: 'client_key_demo',
      },
      { transport },
    )).resolves.toEqual({
      decision: 'allowed',
      grants: ['manage_runtime'],
      permit: 'permit_demo',
      expires_at_unix_ms: expiresAt,
      reason_code: '',
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v3/environments/env_demo/runtime-management/authorizations',
      body_text: expect.stringContaining('"protocol_version":"rcpp-v3"'),
    }));
  });

  it('parses an explicit interactive Runtime enrollment challenge', async () => {
    const normalizedProvider = provider();
    const expiresAt = Date.now() + 60_000;
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v3',
      challenge_id: 'challenge_demo',
      enrollment_code: 'enrollment_demo',
      proof_nonce: 'proof_nonce_demo',
      control_binding_generation: 5,
      expected_target_generation: 8,
      expires_at_unix_ms: expiresAt,
    })));
    await expect(requestProviderRuntimeEnrollmentChallenge(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      'env_demo',
      { mode: 'interactive_code', expected_target_generation: 8 },
      { transport },
    )).resolves.toEqual({
      challenge_id: 'challenge_demo',
      enrollment_code: 'enrollment_demo',
      proof_nonce: 'proof_nonce_demo',
      control_binding_generation: 5,
      expected_target_generation: 8,
      expires_at_unix_ms: expiresAt,
    });
  });

  it('requests an independent v3 Runtime link ticket without accepting bootstrap semantics', async () => {
    const normalizedProvider = provider();
    const expiresAt = Date.now() + 60_000;
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v3',
      runtime_link_ticket: 'runtime-link-ticket',
      expires_at_unix_ms: expiresAt,
    })));
    await expect(requestProviderRuntimeLinkAuthorization(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      'env_demo',
      { transport },
    )).resolves.toEqual({ runtime_link_ticket: 'runtime-link-ticket', expires_at_unix_ms: expiresAt });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v3/environments/env_demo/runtime-link/authorizations',
      body_text: JSON.stringify({ protocol_version: 'rcpp-v3', env_public_id: 'env_demo' }),
    }));

    const legacyTransport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v3',
      runtime_link_ticket: 'runtime-link-ticket',
      bootstrap_ticket: 'legacy-ticket',
      expires_at_unix_ms: expiresAt,
    })));
    await expect(requestProviderRuntimeLinkAuthorization(
      normalizedProvider,
      normalizedProvider.access_points[0]!,
      'access-token',
      'env_demo',
      { transport: legacyTransport },
    )).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });
});
