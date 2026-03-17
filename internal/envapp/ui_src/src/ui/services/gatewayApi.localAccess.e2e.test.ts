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

  it('uses same-origin credentials when local runtime is available', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));

    const mod = await import('./gatewayApi');
    await expect(mod.gatewayRequestCredentials()).resolves.toBe('same-origin');
  });

  it('uses omit credentials when local runtime is not available', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));

    const mod = await import('./gatewayApi');
    await expect(mod.gatewayRequestCredentials()).resolves.toBe('omit');
  });

  it('applies same-origin credentials to gateway fetches on localhost', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));
    const auth = await import('./localAccessAuth');
    auth.writeLocalAccessResumeToken('resume123');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get(auth.getLocalAccessResumeHeaderName())).toBe('resume123');
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    const out = await mod.fetchGatewayJSON<{ ok: boolean }>('/_redeven_proxy/api/settings', { method: 'GET' });

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves multipart uploads while adding the local resume-token header', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));
    const auth = await import('./localAccessAuth');
    auth.writeLocalAccessResumeToken('resume123');

    const mod = await import('./gatewayApi');
    const form = new FormData();
    form.append('file', new Blob(['demo']), 'demo.txt');

    const init = await mod.prepareGatewayRequestInit({ method: 'POST', body: form });
    const headers = new Headers(init.headers);

    expect(init.credentials).toBe('same-origin');
    expect(headers.get(auth.getLocalAccessResumeHeaderName())).toBe('resume123');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('uploads files through the shared gateway helper and returns the upload url', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));
    const auth = await import('./localAccessAuth');
    auth.writeLocalAccessResumeToken('resume123');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/_redeven_proxy/api/ai/uploads');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get(auth.getLocalAccessResumeHeaderName())).toBe('resume123');
      expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
      return jsonResponse({ url: '/_redeven_proxy/api/ai/uploads/upl_demo' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    const out = await mod.uploadGatewayFile(new File(['demo'], 'demo.txt', { type: 'text/plain' }));

    expect(out).toBe('/_redeven_proxy/api/ai/uploads/upl_demo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects upload responses that do not contain a url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./gatewayApi');
    await expect(mod.uploadGatewayFile(new File(['demo'], 'demo.txt', { type: 'text/plain' })))
      .rejects
      .toThrow('Upload response missing url');
  });

  it('fetches remote access status without same-origin cookies on sandbox hosts', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));
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
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));
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
