// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gatewayApi access credentials', () => {
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

  it('fetches remote access status without same-origin cookies on sandbox hosts', async () => {
    window.history.replaceState(null, document.title, '/_redeven_proxy/env/');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/_redeven_proxy/api/access/status');
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('omit');
      return jsonResponse({ password_required: true, unlocked: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    const out = await mod.getGatewayAccessStatus();

    expect(out).toEqual({ password_required: true, unlocked: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts remote unlock without same-origin cookies and accepts resume-token-only responses', async () => {
    window.history.replaceState(null, document.title, '/_redeven_proxy/env/');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/_redeven_proxy/api/access/unlock');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      expect(String(init?.body)).toBe(JSON.stringify({ password: 'secret' }));
      return jsonResponse({ resume_token: 'resume123' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    const out = await mod.unlockGatewayAccess('secret');

    expect(out).toEqual({ unlocked: true, resume_token: 'resume123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces nested gateway error messages instead of [object Object]', async () => {
    const fetchMock = vi.fn(async () => errorResponse('invalid password', 401));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    await expect(mod.unlockGatewayAccess('wrong')).rejects.toThrow('invalid password');
  });
});
