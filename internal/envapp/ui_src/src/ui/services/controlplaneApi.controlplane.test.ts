// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registeredSource = Object.freeze({ acquire: vi.fn() });
const createControlplaneArtifactSource = vi.fn((_options: Record<string, unknown>) => registeredSource);

vi.mock('@floegence/floe-webapp-boot/artifact-source', () => ({
  createControlplaneArtifactSource,
}));

describe('controlplaneApi controlplane helper usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    registeredSource.acquire.mockReset();
    createControlplaneArtifactSource.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.redevenDesktopSessionContext;
  });

  it('does not renew or navigate an active workspace for expired background version metadata', async () => {
    const renew = vi.fn(async () => false);
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({ local_environment_id: 'cloud', renderer_storage_scope_id: 'cloud', target_route: 'remote_desktop', session_source: 'provider_environment', env_public_id: 'env_demo' }),
      renewProviderSession: renew,
    };
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 'INVALID_ENV_SESSION' } }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./controlplaneApi');
    await expect(mod.getControlplaneAgentLatestVersion('env_demo')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(renew).not.toHaveBeenCalled();
  });

  it('renews an expired Desktop Cloud sandbox session once without navigating the workspace', async () => {
    const renew = vi.fn(async () => true);
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({ local_environment_id: 'cloud', renderer_storage_scope_id: 'cloud', target_route: 'remote_desktop', session_source: 'provider_environment', env_public_id: 'env_demo' }),
      renewProviderSession: renew,
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INVALID_ENV_SESSION' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { entry_ticket: 'fresh-ticket' } })));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./controlplaneApi');
    expect(await mod.mintEnvProxyEntryTicket({ endpointId: 'env_demo', floeApp: 'com.floegence.redeven.agent', codeSpaceId: 'env-ui' })).toBe('fresh-ticket');
    expect(renew).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('preserves rejected Cloud authority after bounded renewal (%s)', async (renewed) => {
    const renew = vi.fn(async () => renewed);
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({ local_environment_id: 'cloud', renderer_storage_scope_id: 'cloud', target_route: 'remote_desktop', session_source: 'provider_environment', env_public_id: 'env_demo' }),
      renewProviderSession: renew,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INVALID_ENV_SESSION' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./controlplaneApi');
    await expect(mod.mintEnvProxyEntryTicket({ endpointId: 'env_demo', floeApp: 'com.floegence.redeven.agent', codeSpaceId: 'env-ui' })).rejects.toMatchObject({ status: 401 });
    expect(renew).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(renewed ? 2 : 1);
  });

  it.each([401, 403, 429, 502, 503])('preserves ticket HTTP failure status for the artifact source (%s)', async (status) => {
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({ local_environment_id: 'cloud', renderer_storage_scope_id: 'cloud', target_route: 'remote_desktop', session_source: 'provider_environment', env_public_id: 'env_demo' }),
      renewProviderSession: async () => false,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: status === 401 ? 'INVALID_ENV_SESSION' : 'REQUEST_FAILED' } }), { status })));
    const mod = await import('./controlplaneApi');
    await mod.createEnvProxyArtifactSource({ endpointId: () => 'env_demo', floeApp: 'com.floegence.redeven.agent', codeSpaceId: 'env-ui' });
    const sourceOptions = createControlplaneArtifactSource.mock.calls[0]?.[0] as { fetch: typeof globalThis.fetch };
    const response = await sourceOptions.fetch('https://localhost/v1/connect/artifact/entry', { signal: new AbortController().signal });
    expect(response.status).toBe(status);
    const actualBoot = await vi.importActual<typeof import('@floegence/floe-webapp-boot/artifact-source')>('@floegence/floe-webapp-boot/artifact-source');
    const source = actualBoot.createControlplaneArtifactSource(sourceOptions as Parameters<typeof actualBoot.createControlplaneArtifactSource>[0]);
    await expect(source.acquire({ signal: new AbortController().signal })).resolves.toMatchObject({
      kind: 'failure', disposition: { kind: status === 401 || status === 403 ? 'terminal' : 'retryable' },
    });
  });

  it.each([[503, 'retryable'], [403, 'terminal']] as const)('classifies uppercase artifact API errors (%s)', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/floeproxy/entry')
      ? Response.json({ data: { entry_ticket: 'fresh' } })
      : Response.json({ error: { code: 'AGENT_OFFLINE' } }, { status })));
    const mod = await import('./controlplaneApi');
    await mod.createEnvProxyArtifactSource({ endpointId: () => 'env_demo', floeApp: 'com.floegence.redeven.agent', codeSpaceId: 'env-ui' });
    const actualBoot = await vi.importActual<typeof import('@floegence/floe-webapp-boot/artifact-source')>('@floegence/floe-webapp-boot/artifact-source');
    const source = actualBoot.createControlplaneArtifactSource(createControlplaneArtifactSource.mock.calls[0]?.[0] as Parameters<typeof actualBoot.createControlplaneArtifactSource>[0]);
    await expect(source.acquire({ signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'failure', disposition: { kind } });
  });

  it('returns one stable registered source and redeems a fresh entry ticket inside each acquire fetch', async () => {
    const controller = new AbortController();
    const prepareAcquire = vi.fn();
    let ticket = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/srv/v1/floeproxy/entry') {
        ticket += 1;
        return new Response(JSON.stringify({ data: { entry_ticket: `ticket-${ticket}` } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ v: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./controlplaneApi');
    const source = await mod.createEnvProxyArtifactSource({
      endpointId: () => 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      codeSpaceId: 'env-ui',
      traceId: 'trace-1',
      prepareAcquire,
    });

    expect(source).toBe(registeredSource);
    expect(createControlplaneArtifactSource).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://localhost',
      endpointId: 'dynamic_env',
      entryTicket: 'dynamic_entry_ticket',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
      correlation: { traceId: 'trace-1' },
      commitSpend: expect.any(Function),
      validateSpendBinding: expect.any(Function),
    }));
    const sourceOptions = createControlplaneArtifactSource.mock.calls[0]?.[0] as {
      fetch: typeof globalThis.fetch;
    };
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    };
    await sourceOptions.fetch('https://v1/connect/artifact/entry', init);
    await sourceOptions.fetch('https://v1/connect/artifact/entry', init);

    expect(prepareAcquire).toHaveBeenCalledTimes(2);
    expect(prepareAcquire).toHaveBeenNthCalledWith(1, {
      endpointId: 'env_demo',
      signal: controller.signal,
    });
    const artifactCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/v1/connect/artifact/entry'));
    expect(artifactCalls).toHaveLength(2);
    expect(artifactCalls.map(([input]) => String(input))).toEqual([
      'https://localhost/v1/connect/artifact/entry',
      'https://localhost/v1/connect/artifact/entry',
    ]);
    expect(new Headers(artifactCalls[0]?.[1]?.headers).get('authorization')).toBe('Bearer ticket-1');
    expect(new Headers(artifactCalls[1]?.[1]?.headers).get('authorization')).toBe('Bearer ticket-2');
    expect(JSON.parse(String(artifactCalls[0]?.[1]?.body))).toEqual({
      endpoint_id: 'env_demo',
      payload: { floe_app: 'com.floegence.redeven.agent' },
      correlation: { trace_id: 'trace-1' },
    });
  });

  it('commits remote spend through the Portal exact bearer contract', async () => {
    const response = new Response(null, { status: 204 });
    const readBody = vi.spyOn(response, 'text').mockRejectedValue(new Error('204 response body is unavailable'));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./controlplaneApi');
    await mod.createEnvProxyArtifactSource({
      endpointId: () => 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      codeSpaceId: 'env-ui',
    });
    const sourceOptions = createControlplaneArtifactSource.mock.calls[0]?.[0] as {
      commitSpend: (request: Record<string, any>, signal?: AbortSignal) => Promise<void>;
    };
    const signal = new AbortController().signal;

    await sourceOptions.commitSpend({
      attemptId: 'attempt-id',
      receipt: 'receipt-token',
      artifactDigestB64u: 'artifact-digest',
      projectionDigestB64u: 'projection-digest',
      launcherOrigin: 'https://env.example',
      runtimeOrigin: 'https://env.example',
      appOrigin: 'https://env.example',
      consumer: 'trusted',
      targetBinding: {
        v: 1,
        kind: 'env',
        env_public_id: 'env_demo',
        floe_app: 'com.floegence.redeven.agent',
        launcher_kind: 'env',
        launcher_id: 'env_demo',
      },
      expiresAt: '2033-05-18T03:33:20Z',
    }, signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('/api/srv/v1/floeproxy/artifact/spend');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(signal);
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer receipt-token');
    expect(readBody).not.toHaveBeenCalled();
    expect(JSON.parse(String(init?.body))).toEqual({
      v: 1,
      attempt_id: 'attempt-id',
      artifact_digest_b64u: 'artifact-digest',
      projection_digest_b64u: 'projection-digest',
      runtime_origin: 'https://env.example',
      app_origin: 'https://env.example',
      consumer: 'trusted',
      target_binding: {
        v: 1,
        kind: 'env',
        env_public_id: 'env_demo',
        floe_app: 'com.floegence.redeven.agent',
        launcher_kind: 'env',
        launcher_id: 'env_demo',
      },
      expires_at: '2033-05-18T03:33:20Z',
    });
  });
});
