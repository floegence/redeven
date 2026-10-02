import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createWebSocketStream, WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { prepareGatewayEnvironmentAccess } from './gatewayEnvironmentAccess';
import type { GatewayRecord } from './gatewayStore';
import type { GatewayOpenSessionResponse } from './gatewayClient';
import type { DesktopGatewayEnvironment } from '../shared/desktopGateway';
import { GatewayProxyError, type GatewayProxyTransport } from './gatewayProxyTransport';
import type { RuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

const record: GatewayRecord = {
  schema_version: 3, gateway_id: 'gw_one', display_name: 'Gateway', local_enabled: true,
  connection: { kind: 'url', base_url: 'https://gateway.example/' }, created_at_ms: 1, updated_at_ms: 1,
};
const environment: DesktopGatewayEnvironment = {
  gateway_env_id: 'env_one', display_name: 'Runtime', env_kind: 'reachable_env', state: 'available',
  capabilities: ['open_direct', 'open_via_gateway'], access_capabilities: ['open_direct', 'open_via_gateway'],
  access_endpoint: { kind: 'url', url: 'https://runtime.example/' }, origin: { kind: 'network_target', label: 'Runtime' },
};

function fixture(mode: 'direct_url' | 'gateway_proxy' = 'gateway_proxy') {
  const response: GatewayOpenSessionResponse = {
    protocol_version: 'redeven-gateway-v3', gateway_env_id: 'env_one', gateway_session_id: 'gws_one',
    connect_artifact: { kind: mode === 'direct_url' ? 'local_direct_artifact' : 'gateway_proxy_artifact',
      url: mode === 'direct_url' ? 'https://runtime.example/' : `https://gateway.example/gateway/v3/access/${'a'.repeat(43)}/`,
      gateway_session_id: 'gws_one', expires_at_unix_ms: Date.now() + 60_000, artifact_nonce: 'nonce', proof: 'proof' },
  };
  const proxy: GatewayProxyTransport = {
    proxyURL: 'http://127.0.0.1:12345', targetURL: 'https://runtime.example/', token: 'main-only-token',
    agent: new http.Agent(), openConnection: vi.fn(), close: vi.fn(async () => undefined), subscribeFailure: () => () => undefined,
  };
  const dependencies = {
    openSession: vi.fn(async () => ({ response })), closeSession: vi.fn(async () => undefined),
    createProxy: vi.fn(async () => proxy), onRevokeFailure: vi.fn(),
    probe: vi.fn(async () => ({ ok: true as const, value: { local_ui_url: 'https://advertised.example/', local_ui_urls: ['https://advertised.example/'] } })),
  };
  return { response, proxy, dependencies };
}

describe('Gateway environment access owner', () => {
  it('opens explicit proxy mode, probes only through its agent, and pins the selected endpoint', async () => {
    const { dependencies, proxy } = fixture();
    const access = await prepareGatewayEnvironmentAccess(record, environment, 'gateway_proxy', dependencies);
    expect(dependencies.openSession).toHaveBeenCalledWith(record, expect.objectContaining({ access_mode: 'gateway_proxy', gateway_env_id: 'env_one', client_nonce: expect.any(String) }), { signal: undefined });
    expect(dependencies.probe).toHaveBeenCalledWith('https://runtime.example/', expect.objectContaining({ agent: proxy.agent, gatewayEndpoint: true }));
    expect(access.startup.local_ui_url).toBe('https://runtime.example/');
    await Promise.all([access.close(), access.close()]);
    expect(proxy.close).toHaveBeenCalledTimes(1);
    expect(dependencies.closeSession).toHaveBeenCalledExactlyOnceWith(record, 'gws_one');
  });

  it('uses the direct route only when explicitly selected', async () => {
    const { dependencies } = fixture('direct_url');
    const access = await prepareGatewayEnvironmentAccess(record, environment, 'direct_url', dependencies);
    expect(dependencies.createProxy).not.toHaveBeenCalled();
    expect(dependencies.probe).toHaveBeenCalledWith('https://runtime.example/', expect.objectContaining({ agent: undefined }));
    await access.close();
  });

  it('does not silently try direct after proxy failure and revokes the created session', async () => {
    const { dependencies } = fixture();
    dependencies.createProxy.mockRejectedValue(new GatewayProxyError('GATEWAY_UNREACHABLE'));
    await expect(prepareGatewayEnvironmentAccess(record, environment, 'gateway_proxy', dependencies)).rejects.toMatchObject({ code: 'GATEWAY_UNREACHABLE' });
    expect(dependencies.openSession).toHaveBeenCalledTimes(1);
    expect(dependencies.probe).not.toHaveBeenCalled();
    expect(dependencies.closeSession).toHaveBeenCalledExactlyOnceWith(record, 'gws_one');
  });

  it('rejects a mismatched artifact and never probes it', async () => {
    const { dependencies } = fixture('direct_url');
    await expect(prepareGatewayEnvironmentAccess(record, environment, 'gateway_proxy', dependencies)).rejects.toMatchObject({ code: 'GATEWAY_ARTIFACT_UNSUPPORTED' });
    expect(dependencies.probe).not.toHaveBeenCalled();
    expect(dependencies.closeSession).toHaveBeenCalledTimes(1);
  });

  it('requires a specific capability rather than aggregate open or catalog availability', async () => {
    const { dependencies } = fixture();
    await expect(prepareGatewayEnvironmentAccess(record, { ...environment, access_capabilities: ['open'] }, 'gateway_proxy', dependencies)).rejects.toMatchObject({ code: 'GATEWAY_CAPABILITY_UNSUPPORTED' });
    expect(dependencies.openSession).not.toHaveBeenCalled();
  });

  it('cleans up cancellation after issuance and preserves the cancellation cause if revoke fails', async () => {
    const { dependencies } = fixture();
    const controller = new AbortController();
    controller.abort();
    dependencies.closeSession.mockRejectedValue(new Error('Gateway disconnected'));
    await expect(prepareGatewayEnvironmentAccess(record, environment, 'gateway_proxy', dependencies, controller.signal)).rejects.toMatchObject({ code: 'GATEWAY_CANCELED' });
    expect(dependencies.createProxy).not.toHaveBeenCalled();
    expect(dependencies.closeSession).toHaveBeenCalledTimes(1);
    expect(dependencies.onRevokeFailure).toHaveBeenCalledExactlyOnceWith('gw_one', 'env_one', 'gws_one');
  });

  it('carries proxy access through the managed Gateway bridge and closes only its session streams', async () => {
    const runtime = http.createServer((_request, response) => response.end('Runtime through managed bridge'));
    runtime.listen(0, '127.0.0.1'); await once(runtime, 'listening');
    const runtimePort = (runtime.address() as net.AddressInfo).port;
    const gateway = http.createServer();
    const wsServer = new WebSocketServer({ server: gateway });
    wsServer.on('connection', (ws, request) => {
      expect(request.url).toBe(`/gateway/v3/access/${'a'.repeat(43)}/_tunnel`);
      const stream = createWebSocketStream(ws);
      const upstream = net.connect(runtimePort, '127.0.0.1');
      stream.pipe(upstream).pipe(stream);
      stream.on('error', () => upstream.destroy());
      stream.once('close', () => upstream.destroy());
      upstream.on('error', () => stream.destroy());
      upstream.once('close', () => stream.destroy());
    });
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
    const surfaces: string[] = [];
    const bridgeSockets = new Set<net.Socket>();
    const bridge = {
      placement_target_id: desktopRuntimeTargetID({ kind: 'local_host' }, { kind: 'host_process', runtime_root: '/tmp/gateway-fixture' }, 'managed-gateway'), local_ui_url: '',
      openStream: (surface: string) => {
        surfaces.push(surface);
        const socket = net.connect((gateway.address() as net.AddressInfo).port, '127.0.0.1');
        bridgeSockets.add(socket);
        socket.once('close', () => bridgeSockets.delete(socket));
        return {
          id: 'bridge-stream',
          onData: (callback: (chunk: Buffer) => void) => { socket.on('data', callback); },
          onClose: (callback: () => void) => { socket.once('close', callback); },
          onError: (callback: (error: Error) => void) => { socket.on('error', callback); },
          write: async (chunk: Buffer) => { socket.write(chunk); },
          closeWrite: async () => { socket.end(); },
          close: async () => { socket.destroy(); },
        };
      },
    } as RuntimePlacementBridgeSession;
    const managedRecord: GatewayRecord = { ...record, connection: { kind: 'local_host', runtime_root: '/tmp/gateway-fixture' } };
    const { response } = fixture();
    const managedResponse: GatewayOpenSessionResponse = { ...response,
      connect_artifact: { ...response.connect_artifact, kind: 'desktop_bridge_artifact',
        url: `/gateway/v3/access/${'a'.repeat(43)}/`, bridge_session_id: bridge.placement_target_id, route_id: 'env_app:gw_one' } };
    const closeSession = vi.fn(async () => undefined);
    let access: Awaited<ReturnType<typeof prepareGatewayEnvironmentAccess>> | undefined;
    try {
      access = await prepareGatewayEnvironmentAccess(managedRecord, { ...environment, access_endpoint: { kind: 'url', url: 'http://runtime.invalid:4567/' } }, 'gateway_proxy', {
        openSession: async () => ({ response: managedResponse, bridge_session: bridge }), closeSession,
        probe: async (url, options) => {
          const body = await new Promise<string>((resolve, reject) => {
            const request = http.get(url, { agent: options.agent }, reply => {
              let text = ''; reply.on('data', chunk => { text += String(chunk); }); reply.once('end', () => resolve(text));
            });
            request.once('error', reject);
          });
          expect(body).toBe('Runtime through managed bridge');
          return { ok: true, value: { local_ui_url: url, local_ui_urls: [url] } };
        },
      });
      expect(surfaces).toEqual(['gateway_protocol']);
      await access.close();
      expect(closeSession).toHaveBeenCalledExactlyOnceWith(managedRecord, 'gws_one');
      await expect(access.proxy!.openConnection()).rejects.toMatchObject({ code: 'GATEWAY_CANCELED' });
    } finally {
      await access?.close();
      for (const socket of bridgeSockets) socket.destroy();
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close();
      await Promise.all([new Promise<void>(resolve => gateway.close(() => resolve())), new Promise<void>(resolve => runtime.close(() => resolve()))]);
    }
  });
});
