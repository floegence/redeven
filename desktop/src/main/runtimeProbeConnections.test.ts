import http from 'node:http';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { probeExternalLocalUIHealth, probeLocalRuntimeBridgeStartup } from './runtimeState';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';

const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function createRuntime(options: { stallAssets?: boolean; missingAsset?: number } = {}) {
  const sockets = new Set<Socket>();
  const admitted = new Set<Socket>();
  const assets = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let peakConnections = 0;
  const server = http.createServer((request, response) => {
    // Each persistent connection consumes a bridge CONNECT stream. Requests
    // beyond its 64-stream capacity cannot reach the Runtime until one closes.
    if (!admitted.has(request.socket)) return;
    if (request.headers['x-redeven-desktop-bridge-token'] !== token) {
      response.writeHead(401).end();
    } else if (request.url === '/api/local/runtime/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: {
        status: 'online', password_required: false, pid: 42, started_at_unix_ms: 123,
        exposure: { scope: 'loopback', transport: 'http', password_required: false },
        runtime_service: { compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH,
          compatibility: 'compatible', open_readiness: { state: 'openable' } },
      } }));
    } else if (request.url === '/_redeven_proxy/env/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<div id="root"></div>' + Array.from({ length: 68 }, (_, i) =>
        `<script src="/_redeven_proxy/env/assets/${i}.js"></script>`).join(''));
    } else if (request.method === 'HEAD' && request.url?.startsWith('/_redeven_proxy/env/assets/')) {
      assets.add(request.url);
      if (!options.stallAssets) {
        const status = request.url.endsWith(`/${options.missingAsset}.js`) ? 404 : 200;
        const timer = setTimeout(() => {
          timers.delete(timer);
          response.writeHead(status, { 'Content-Length': '0' }).end();
        }, 20);
        timers.add(timer);
      }
    } else {
      response.writeHead(404).end();
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    if (admitted.size < 64) admitted.add(socket);
    peakConnections = Math.max(peakConnections, sockets.size);
    socket.once('close', () => { sockets.delete(socket); admitted.delete(socket); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    url, sockets, assets, peakConnections: () => peakConnections,
    startup: { local_ui_url: '', local_ui_urls: [], local_ui_bridge_url: url, local_ui_bridge_token: token },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

describe('Runtime probe connection ownership', () => {
  it('releases standalone health connections without changing the global agent', async () => {
    const runtime = await createRuntime();
    const maxSockets = http.globalAgent.maxSockets;
    try {
      expect(await probeExternalLocalUIHealth(runtime.url, {
        headers: { 'x-redeven-desktop-bridge-token': token },
      })).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(runtime.sockets.size).toBe(0));
      expect(http.globalAgent.maxSockets).toBe(maxSockets);
    } finally { await runtime.close(); }
  });

  it('verifies every asset above bridge capacity and releases owned connections', async () => {
    const runtime = await createRuntime();
    try {
      const result = await probeLocalRuntimeBridgeStartup(runtime.startup, { timeoutMs: 500 });
      expect(result).toMatchObject({ ok: true, value: { runtime_service: { open_readiness: { state: 'openable' } } } });
      expect(runtime.assets.size).toBe(68);
      expect(runtime.peakConnections()).toBeLessThanOrEqual(8);
      await vi.waitFor(() => expect(runtime.sockets.size).toBe(0));
    } finally { await runtime.close(); }
  });

  it('checks resources beyond the first batch instead of silently skipping them', async () => {
    const runtime = await createRuntime({ missingAsset: 67 });
    try {
      const result = await probeLocalRuntimeBridgeStartup(runtime.startup, { timeoutMs: 500 });
      expect(result).toMatchObject({ ok: true, value: { runtime_service: { open_readiness: {
        state: 'blocked', reason_code: 'env_app_shell_unavailable',
      } } } });
      expect(runtime.assets.size).toBe(68);
      await vi.waitFor(() => expect(runtime.sockets.size).toBe(0));
    } finally { await runtime.close(); }
  });

  it('preserves a supplied transport agent and its connection ownership', async () => {
    const runtime = await createRuntime();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 3 });
    const destroy = vi.spyOn(agent, 'destroy');
    try {
      const result = await probeLocalRuntimeBridgeStartup(runtime.startup, { agent, timeoutMs: 1500 });
      expect(result).toMatchObject({ ok: true, value: { runtime_service: { open_readiness: { state: 'openable' } } } });
      expect(runtime.assets.size).toBe(68);
      expect(agent.maxSockets).toBe(3);
      expect(destroy).not.toHaveBeenCalled();
      expect(runtime.sockets.size).toBeGreaterThan(0);
    } finally { agent.destroy(); await runtime.close(); }
  });

  it('cancels active and queued asset probes and releases owned connections', async () => {
    const runtime = await createRuntime({ stallAssets: true });
    const controller = new AbortController();
    try {
      const outcome = probeLocalRuntimeBridgeStartup(runtime.startup, { signal: controller.signal })
        .then(value => value, error => error as Error);
      await vi.waitFor(() => expect(runtime.assets.size).toBeGreaterThan(0));
      controller.abort();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(runtime.sockets.size).toBe(0));
      expect(runtime.assets.size).toBeLessThanOrEqual(8);
    } finally { controller.abort(); await runtime.close(); }
  });

  it('bounds queue time even when a caller-owned agent has no available socket', async () => {
    const runtime = await createRuntime();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    agent.maxSockets = 0;
    try {
      const result = await probeExternalLocalUIHealth(runtime.url, {
        agent, timeoutMs: 30, headers: { 'x-redeven-desktop-bridge-token': token },
      });
      expect(result).toEqual({ ok: false, failure: { kind: 'timeout', stage: 'runtime_health' } });
      expect(runtime.sockets.size).toBe(0);
    } finally { agent.destroy(); await runtime.close(); }
  });

  it('bounds the whole asset check and closes stalled connections', async () => {
    const runtime = await createRuntime({ stallAssets: true });
    try {
      const started = Date.now();
      const result = await probeLocalRuntimeBridgeStartup(runtime.startup, { timeoutMs: 60 });
      expect(result).toMatchObject({ ok: true, value: { runtime_service: { open_readiness: {
        state: 'starting', reason_code: 'env_app_shell_unreachable',
      } } } });
      expect(Date.now() - started).toBeLessThan(500);
      expect(runtime.assets.size).toBeLessThanOrEqual(8);
      await vi.waitFor(() => expect(runtime.sockets.size).toBe(0));
    } finally { await runtime.close(); }
  });

  it('cancels while queued on a caller-owned agent without destroying that agent', async () => {
    const runtime = await createRuntime();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    agent.maxSockets = 0;
    const destroy = vi.spyOn(agent, 'destroy');
    const controller = new AbortController();
    try {
      const outcome = probeExternalLocalUIHealth(runtime.url, { agent, signal: controller.signal })
        .then(value => value, error => error as Error);
      controller.abort();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(destroy).not.toHaveBeenCalled();
      expect(runtime.sockets.size).toBe(0);
    } finally { agent.destroy(); await runtime.close(); }
  });
});
