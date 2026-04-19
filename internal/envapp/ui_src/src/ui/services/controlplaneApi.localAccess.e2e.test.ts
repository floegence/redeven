// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number, extras?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { message, ...extras } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('controlplaneApi local access flow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    window.history.replaceState(null, document.title, '/_redeven_proxy/env/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects local runtime from public access status even while locked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/local/access/status') {
        expect(init?.credentials).toBe('same-origin');
        return jsonResponse({ password_required: true, unlocked: false });
      }
      if (String(input) === '/api/local/runtime') {
        expect(init?.credentials).toBe('same-origin');
        return jsonResponse({ message: 'locked' }, 423);
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const runtime = await mod.getLocalRuntime();

    expect(runtime).toMatchObject({
      mode: 'local',
      env_public_id: 'env_local',
    });
    expect(String(runtime?.direct_ws_url ?? '')).toContain('/_redeven_direct/ws');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads desktop-managed runtime metadata after the local session is unlocked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/local/access/status') {
        expect(init?.credentials).toBe('same-origin');
        return jsonResponse({ password_required: true, unlocked: true });
      }
      if (String(input) === '/api/local/runtime') {
        expect(init?.credentials).toBe('same-origin');
        return jsonResponse({
          mode: 'local',
          env_public_id: 'env_local',
          direct_ws_url: 'ws://127.0.0.1:43123/_redeven_direct/ws',
          desktop_managed: true,
          effective_run_mode: 'hybrid',
          remote_enabled: true,
        });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const runtime = await mod.refreshLocalRuntime();

    expect(runtime).toEqual({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://127.0.0.1:43123/_redeven_direct/ws',
      desktop_managed: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
    });
  });

  it('posts unlock with same-origin credentials so the local session cookie can be stored', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/local/access/unlock');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(String(init?.body)).toBe(JSON.stringify({ password: 'secret' }));
      return jsonResponse({ unlocked: true, resume_token: 'resume123' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.unlockLocalAccess('secret');

    expect(out).toEqual({ unlocked: true, resume_token: 'resume123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts unlock responses that only return a resume token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ resume_token: 'resume123' }));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.unlockLocalAccess('secret');

    expect(out).toEqual({ unlocked: true, resume_token: 'resume123' });
  });

  it('preserves retry-after metadata for unlock cooldown responses', async () => {
    const fetchMock = vi.fn(async () => errorResponse('Too many incorrect password attempts.', 429, {
      code: 'ACCESS_PASSWORD_RETRY_LATER',
      retry_after_ms: 30_000,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    await expect(mod.unlockLocalAccess('wrong')).rejects.toMatchObject({
      message: 'Too many incorrect password attempts.',
      retryAfterMs: 30_000,
      status: 429,
      code: 'ACCESS_PASSWORD_RETRY_LATER',
    });
  });

  it('uses same-origin credentials when minting local direct connect artifacts', async () => {
    const auth = await import('./localAccessAuth');
    auth.writeLocalAccessResumeToken('resume123');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/local/direct/connect_artifact');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get(auth.getLocalAccessResumeHeaderName())).toBe('resume123');
      return jsonResponse({
        connect_artifact: {
          v: 1,
          transport: 'direct',
          direct_info: {
            ws_url: 'ws://localhost/_redeven_direct/ws',
            channel_id: 'ch_local',
            e2ee_psk_b64u: 'secret',
            channel_init_expire_at_unix_s: 1,
            default_suite: 1,
          },
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.mintLocalDirectConnectArtifact();

    expect(out.transport).toBe('direct');
    if (out.transport !== 'direct') {
      throw new Error('Expected direct connect artifact');
    }
    expect(out.direct_info.channel_id).toBe('ch_local');
    expect(String(out.direct_info.ws_url)).toBe('ws://localhost/_redeven_direct/ws?redeven_access_resume=resume123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redeems entry tickets via the canonical connect artifact contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/v1/connect/artifact/entry');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer ticket-1');
      expect(JSON.parse(String(init?.body))).toEqual({
        endpoint_id: 'env_demo',
        payload: {
          floe_app: 'com.floegence.redeven.agent',
        },
      });
      return new Response(
        JSON.stringify({
          connect_artifact: {
            v: 1,
            transport: 'tunnel',
            tunnel_grant: {
              tunnel_url: 'wss://example.com/ws',
              channel_id: 'ch_remote',
              token: 'token',
              role: 1,
              idle_timeout_seconds: 10,
              channel_init_expire_at_unix_s: 1,
              e2ee_psk_b64u: 'secret',
              allowed_suites: [1],
              default_suite: 1,
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.connectArtifactEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
    });

    expect(out.transport).toBe('tunnel');
    if (out.transport !== 'tunnel') {
      throw new Error('Expected tunnel connect artifact');
    }
    expect(out.tunnel_grant.channel_id).toBe('ch_remote');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
