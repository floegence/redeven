import { describe, expect, it, vi, afterEach } from 'vitest';

const electronState = vi.hoisted(() => ({
  netFetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: {
    fetch: electronState.netFetch,
  },
}));

import {
  DesktopProviderRequestError,
  electronDesktopProviderTransport,
} from './controlPlaneProviderTransport';

describe('controlPlaneProviderTransport', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses Electron net.fetch and returns normalized response metadata', async () => {
    electronState.netFetch.mockResolvedValueOnce(new Response('{"ok":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    }));

    const response = await electronDesktopProviderTransport({
      url: 'https://cp.example.invalid/.well-known/redeven-provider.json',
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      timeout_ms: 15_000,
    });

    expect(response).toEqual({
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
      body_text: '{"ok":true}',
    });
    expect(electronState.netFetch).toHaveBeenCalledTimes(1);
    const [, requestOptions] = electronState.netFetch.mock.calls[0];
    expect(requestOptions.method).toBe('GET');
    expect(requestOptions.headers.get('Accept')).toBe('application/json');
    expect(requestOptions.signal).toBeTruthy();
  });

  it('normalizes untrusted certificate failures', async () => {
    const error = new Error('unable to verify the first certificate') as Error & { code?: string };
    error.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
    electronState.netFetch.mockRejectedValueOnce(error);

    await expect(electronDesktopProviderTransport({
      url: 'https://dev.redeven.test/.well-known/redeven-provider.json',
      timeout_ms: 15_000,
    })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_tls_untrusted',
      providerOrigin: 'https://dev.redeven.test',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('normalizes timeout failures', async () => {
    electronState.netFetch.mockRejectedValueOnce(new DOMException('The operation timed out.', 'AbortError'));

    await expect(electronDesktopProviderTransport({
      url: 'https://dev.redeven.test/.well-known/redeven-provider.json',
      timeout_ms: 15_000,
    })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_timeout',
      providerOrigin: 'https://dev.redeven.test',
    } satisfies Partial<DesktopProviderRequestError>);
  });

  it('reports unreadable response bodies as invalid responses', async () => {
    electronState.netFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
      text: vi.fn().mockRejectedValue(new Error('broken stream')),
    } as unknown as Response);

    await expect(electronDesktopProviderTransport({
      url: 'https://dev.redeven.test/.well-known/redeven-provider.json',
      timeout_ms: 15_000,
    })).rejects.toMatchObject({
      name: 'DesktopProviderRequestError',
      code: 'provider_invalid_response',
      status: 200,
      providerOrigin: 'https://dev.redeven.test',
    } satisfies Partial<DesktopProviderRequestError>);
  });
});
