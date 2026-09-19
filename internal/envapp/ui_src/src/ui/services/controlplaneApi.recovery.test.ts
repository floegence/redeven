// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectionController, type ConnectionSnapshot } from '@floegence/flowersec-core/browser';
import { createLocalDirectArtifactSource } from './controlplaneApi';

// Exercise the published source and controller together. A reachable endpoint
// returns an authorization response to end the test without opening a transport.
describe('local artifact recovery with the published connection controller', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['network', 'gateway', 'runtime'] as const)('automatically reacquires after a %s interruption', async (failure) => {
    let reachable = false;
    const fetch = vi.fn(async () => {
      if (reachable) return new Response('{}', { status: 401 });
      if (failure === 'network') throw new TypeError('Failed to fetch');
      return new Response(failure === 'gateway' ? '<h1>Bad Gateway</h1>' : JSON.stringify({ error: { code: 'AGENT_OFFLINE' } }), {
        status: failure === 'gateway' ? 502 : 503,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const controller = await createConnectionController(await createLocalDirectArtifactSource({ transport: 'public_tls' }));
    let snapshot: ConnectionSnapshot | undefined;
    controller.subscribe((value) => { snapshot = value; });
    try {
      controller.start();
      await vi.waitFor(() => expect(controller.state).toBe('waiting'));
      expect(snapshot).toMatchObject({ failure: { code: 'connection_failed' }, retryDisposition: { kind: 'retryable' } });
      expect(snapshot?.nextRetryAtUnixMilliseconds).toBeGreaterThan(Date.now());
      reachable = true;
      await vi.waitFor(() => expect(controller.state).toBe('failed'));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(snapshot?.retryDisposition?.kind).toBe('terminal');
    } finally { await controller.close(); }
  });

  it('cancels an unavailable endpoint without issuing another acquisition', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const controller = await createConnectionController(await createLocalDirectArtifactSource({ transport: 'public_tls' }));
    controller.start();
    await vi.waitFor(() => expect(controller.state).toBe('waiting'));
    await controller.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetch).toHaveBeenCalledOnce();
    expect(controller.retryNow()).toBe(false);
  });

  it('preserves the server retry deadline and rejects an early manual retry', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
      status: 429,
      headers: { 'retry-after': '5' },
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = await createConnectionController(await createLocalDirectArtifactSource({ transport: 'public_tls' }));
    let snapshot: ConnectionSnapshot | undefined;
    controller.subscribe((value) => { snapshot = value; });
    const startedAt = Date.now();
    try {
      controller.start();
      await vi.waitFor(() => expect(controller.state).toBe('waiting'));
      expect(snapshot?.retryDisposition?.kind).toBe('retry_after');
      expect(snapshot?.nextRetryAtUnixMilliseconds).toBeGreaterThanOrEqual(startedAt + 5_000);
      expect(controller.retryNow()).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
    } finally { await controller.close(); }
  });
});
