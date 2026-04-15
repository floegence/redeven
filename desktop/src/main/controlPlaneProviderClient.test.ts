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
} from './controlPlaneProviderClient';
import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';

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
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://dev.redeven.test',
      documentation_url: 'https://redeven.test/docs/control-plane-providers',
    })));

    await expect(fetchProviderDiscovery('https://dev.redeven.test', { transport })).resolves.toEqual({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://dev.redeven.test',
      documentation_url: 'https://redeven.test/docs/control-plane-providers',
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/.well-known/redeven-provider.json',
      method: 'GET',
    }));
  });

  it('turns invalid JSON into a stable provider error', async () => {
    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(
      200,
      '<!doctype html><html><body>frontend shell</body></html>',
      { 'content-type': 'text/html' },
    ));

    await expect(fetchProviderDiscovery('https://dev.redeven.test', { transport })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_invalid_json',
      providerOrigin: 'https://dev.redeven.test',
      status: 200,
      message: 'The Control Plane returned invalid JSON for the provider discovery document.',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('preserves provider-side JSON errors with HTTP status', async () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://dev.redeven.test',
      documentation_url: 'https://redeven.test/docs/control-plane-providers',
    });
    expect(provider).not.toBeNull();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(401, JSON.stringify({
      error: {
        code: 'INVALID_DESKTOP_ACCESS',
        message: 'Invalid desktop access token',
      },
    })));

    await expect(fetchProviderEnvironments(provider!, 'access-token', { transport })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_request_failed',
      providerOrigin: 'https://dev.redeven.test',
      status: 401,
      message: 'Invalid desktop access token',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('rejects malformed environment list payloads', async () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://dev.redeven.test',
      documentation_url: 'https://redeven.test/docs/control-plane-providers',
    });
    expect(provider).not.toBeNull();

    const transport = vi.fn<DesktopProviderTransport>().mockResolvedValueOnce(response(200, JSON.stringify({
      items: [],
    })));

    await expect(fetchProviderEnvironments(provider!, 'access-token', { transport })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_invalid_response',
      providerOrigin: 'https://dev.redeven.test',
      message: 'The Control Plane environment list is invalid.',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('posts authorization_code and code_verifier for the desktop connect exchange', async () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://dev.redeven.test',
      documentation_url: 'https://redeven.test/docs/control-plane-providers',
    });
    expect(provider).not.toBeNull();

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
      environments: [],
    })));

    await expect(exchangeProviderDesktopConnectAuthorization(provider!, {
      authorization_code: ' code_demo ',
      code_verifier: ' verifier_demo ',
    }, { transport })).resolves.toMatchObject({
      access_token: 'access_demo',
      refresh_token: 'refresh_demo',
      authorization_expires_at_unix_ms: 1_710_000_100_000,
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://dev.redeven.test/api/rcpp/v1/desktop/connect/exchange',
      method: 'POST',
      body_text: JSON.stringify({
        authorization_code: 'code_demo',
        code_verifier: 'verifier_demo',
      }),
    }));
  });
});
