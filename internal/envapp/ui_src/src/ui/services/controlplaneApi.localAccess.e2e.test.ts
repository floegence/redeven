// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), {
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
      expect(String(input)).toBe('/api/local/access/status');
      expect(init?.credentials).toBe('same-origin');
      return jsonResponse({ password_required: true, unlocked: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const runtime = await mod.getLocalRuntime();

    expect(runtime).toMatchObject({
      mode: 'local',
      env_public_id: 'env_local',
    });
    expect(String(runtime?.direct_ws_url ?? '')).toContain('/_redeven_direct/ws');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('uses same-origin credentials when minting local direct connect info', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/local/direct/connect_info');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      return jsonResponse({
        ws_url: 'ws://localhost/_redeven_direct/ws',
        channel_id: 'ch_local',
        e2ee_psk_b64u: 'secret',
        channel_init_expire_at_unix_s: 1,
        default_suite: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.mintLocalDirectConnectInfo();

    expect(out.channel_id).toBe('ch_local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redeems entry tickets via the Flowersec browser helper contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/v1/channel/init/entry?endpoint_id=env_demo');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer ticket-1');
      expect(JSON.parse(String(init?.body))).toEqual({ endpoint_id: 'env_demo', floe_app: 'com.floegence.redeven.agent' });
      return new Response(
        JSON.stringify({
          grant_client: {
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
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const out = await mod.channelInitEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
    });

    expect(out.channel_id).toBe('ch_remote');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
