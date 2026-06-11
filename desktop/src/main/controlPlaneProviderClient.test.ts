import { describe, expect, it, vi } from 'vitest';

import {
  DesktopProviderRequestError,
  type DesktopProviderTransport,
  type DesktopProviderTransportResponse,
} from './controlPlaneProviderTransport';
import {
  fetchProviderDiscovery,
  fetchProviderEnvironments,
  exchangeProviderDesktopConnectAuthorization,
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
    protocol_version: 'rcpp-v2',
    provider_id: 'redeven',
    display_name: 'Redeven',
    provider_origin: 'https://redeven.test',
    documentation_url: 'https://redeven.test/docs/control-plane-providers',
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
      url: 'https://redeven.test/api/rcpp/v2/desktop/connect/exchange',
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
      bootstrap_ticket: 'boot_ticket_demo',
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
      bootstrap_ticket: 'boot_ticket_demo',
      remote_session_url: 'https://env.dev.redeven.test/_redeven_boot/#redeven=abc',
      access_point_origin: 'https://dev.redeven.test',
      expires_at_unix_ms: 1_710_000_000_000,
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v2/environments/env_demo/desktop/open-session',
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer access-token',
      }),
    }));
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
});
