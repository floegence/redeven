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

function errorResponseWithRetry(message: string, status: number, retryAfterMs: number): Response {
  return new Response(JSON.stringify({
    error: {
      message,
      code: 'ACCESS_PASSWORD_RETRY_LATER',
      retry_after_ms: retryAfterMs,
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function flatAppserverErrorResponse(message: string, status: number, code: string): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: message,
    error_code: code,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('localApi access credentials', () => {
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

    const mod = await import('./localApi');
    await expect(mod.localApiRequestCredentials()).resolves.toBe('same-origin');
  });

  it('uses omit credentials when local runtime is not available', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));

    const mod = await import('./localApi');
    await expect(mod.localApiRequestCredentials()).resolves.toBe('omit');
  });

  it('applies same-origin credentials to local API fetches on localhost', async () => {
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

    const mod = await import('./localApi');
    const out = await mod.fetchLocalApiJSON<{ ok: boolean }>('/_redeven_proxy/api/settings', { method: 'GET' });

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves multipart uploads while adding the local resume-token header', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));
    const auth = await import('./localAccessAuth');
    auth.writeLocalAccessResumeToken('resume123');

    const mod = await import('./localApi');
    const form = new FormData();
    form.append('file', new Blob(['demo']), 'demo.txt');

    const init = await mod.prepareLocalApiRequestInit({ method: 'POST', body: form });
    const headers = new Headers(init.headers);

    expect(init.credentials).toBe('same-origin');
    expect(headers.get(auth.getLocalAccessResumeHeaderName())).toBe('resume123');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('uploads files through the shared local API helper and returns the upload url', async () => {
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

    const mod = await import('./localApi');
    const out = await mod.uploadLocalApiFile(new File(['demo'], 'demo.txt', { type: 'text/plain' }));

    expect(out).toBe('/_redeven_proxy/api/ai/uploads/upl_demo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects upload responses that do not contain a url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.uploadLocalApiFile(new File(['demo'], 'demo.txt', { type: 'text/plain' })))
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

    const mod = await import('./localApi');
    const out = await mod.getEnvAppAccessStatus();

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

    const mod = await import('./localApi');
    const out = await mod.unlockEnvAppAccess('secret');

    expect(out).toEqual({ unlocked: true, resume_token: 'resume123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces nested local API error messages instead of [object Object]', async () => {
    const fetchMock = vi.fn(async () => errorResponse('invalid password', 401));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.unlockEnvAppAccess('wrong')).rejects.toThrow('invalid password');
  });

  it('preserves flat appserver error_code on HTTP failures', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));
    const fetchMock = vi.fn(async () => flatAppserverErrorResponse('confirmation required', 403, 'PLUGIN_CONFIRMATION_REQUIRED'));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.fetchLocalApiJSON('/_redeven_proxy/api/plugins/rpc', { method: 'POST' })).rejects.toMatchObject({
      name: 'LocalApiError',
      message: 'confirmation required',
      status: 403,
      code: 'PLUGIN_CONFIRMATION_REQUIRED',
    });
  });

  it('preserves the approval conflict contract for Flower resync handling', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));
    const fetchMock = vi.fn(async () => flatAppserverErrorResponse('approval state changed', 409, 'AI_APPROVAL_CONFLICT'));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.fetchLocalApiJSON('/_redeven_proxy/api/ai/threads/thread-approval/approvals', {
      method: 'POST',
    })).rejects.toMatchObject({
      name: 'LocalApiError',
      message: 'approval state changed',
      status: 409,
      code: 'AI_APPROVAL_CONFLICT',
    });
  });

  it('preserves flat appserver error_code on ok false envelopes', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));
    const fetchMock = vi.fn(async () => flatAppserverErrorResponse('permission denied', 200, 'PLUGIN_PERMISSION_DENIED'));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.fetchLocalApiJSON('/_redeven_proxy/api/plugins/rpc', { method: 'POST' })).rejects.toMatchObject({
      name: 'LocalApiError',
      message: 'permission denied',
      status: 200,
      code: 'PLUGIN_PERMISSION_DENIED',
    });
  });

  it('preserves retry-after metadata for local unlock cooldown responses', async () => {
    const fetchMock = vi.fn(async () => errorResponseWithRetry('Too many incorrect password attempts.', 429, 30_000));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./localApi');
    await expect(mod.unlockEnvAppAccess('wrong')).rejects.toMatchObject({
      message: 'Too many incorrect password attempts.',
      retryAfterMs: 30_000,
      status: 429,
      code: 'ACCESS_PASSWORD_RETRY_LATER',
    });
  });
});
