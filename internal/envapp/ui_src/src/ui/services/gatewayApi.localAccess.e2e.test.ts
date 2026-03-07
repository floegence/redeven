// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gatewayApi local access credentials', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses same-origin credentials for loopback hosts', async () => {
    const mod = await import('./gatewayApi');
    expect(mod.gatewayRequestCredentialsForHost('localhost')).toBe('same-origin');
    expect(mod.gatewayRequestCredentialsForHost('127.0.0.1')).toBe('same-origin');
    expect(mod.gatewayRequestCredentialsForHost('::1')).toBe('same-origin');
  });

  it('uses omit credentials for non-loopback hosts', async () => {
    const mod = await import('./gatewayApi');
    expect(mod.gatewayRequestCredentialsForHost('env-1.example.com')).toBe('omit');
    expect(mod.gatewayRequestCredentialsForHost('dev.redeven.test')).toBe('omit');
  });

  it('applies same-origin credentials to gateway fetches on localhost', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('same-origin');
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    const out = await mod.fetchGatewayJSON<{ ok: boolean }>('/_redeven_proxy/api/settings', { method: 'GET' });

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
