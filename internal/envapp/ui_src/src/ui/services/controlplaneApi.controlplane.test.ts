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
      baseUrl: 'http://localhost:3000',
      endpointId: 'dynamic_env',
      entryTicket: 'dynamic_entry_ticket',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
      correlation: { traceId: 'trace-1' },
      commitSpend: expect.any(Function),
      validateSpendBinding: expect.any(Function),
    }));
    expect(createControlplaneArtifactSource.mock.calls[0]?.[0]).not.toHaveProperty('allowLoopbackHTTP');
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
      'http://localhost:3000/v1/connect/artifact/entry',
      'http://localhost:3000/v1/connect/artifact/entry',
    ]);
    expect(new Headers(artifactCalls[0]?.[1]?.headers).get('authorization')).toBe('Bearer ticket-1');
    expect(new Headers(artifactCalls[1]?.[1]?.headers).get('authorization')).toBe('Bearer ticket-2');
    expect(JSON.parse(String(artifactCalls[0]?.[1]?.body))).toEqual({
      endpoint_id: 'env_demo',
      payload: { floe_app: 'com.floegence.redeven.agent' },
      correlation: { trace_id: 'trace-1' },
    });
  });

  it('forwards loopback HTTP permission only when the caller selects it', async () => {
    const mod = await import('./controlplaneApi');
    const source = await mod.createEnvProxyArtifactSource({
      endpointId: () => 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      codeSpaceId: 'env-ui',
      allowLoopbackHTTP: true,
    });

    expect(source).toBe(registeredSource);
    expect(createControlplaneArtifactSource).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://localhost:3000',
      endpointId: 'dynamic_env',
      entryTicket: 'dynamic_entry_ticket',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
      allowLoopbackHTTP: true,
      commitSpend: expect.any(Function),
      validateSpendBinding: expect.any(Function),
    }));
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
