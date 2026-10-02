import type { ConnectionController, Session } from '@floegence/flowersec-core';
import { createConnectionController, createHTTPDirectConnectionControllerV1, createPrivateLoopbackConnectionControllerV1 } from '@floegence/flowersec-core/browser';
import { createProxyRuntime, installWebSocketPatch, type ProxyRuntime } from '@floegence/flowersec-core/proxy';
import { createControlplaneArtifactSource, createHTTPDirectControlplaneArtifactSource, createPrivateLoopbackControlplaneArtifactSource, type ControlplaneArtifactSourceOptions } from '@floegence/floe-webapp-boot/artifact-source';
import { clearAcquisitionSource, synchronizeAcquisitionSourceSnapshot, type SpendBindingView } from '@floegence/floe-webapp-boot';
import { MAX_WS_FRAME_BYTES, registerCodeAppProxyBridge } from './runtimeBridge';

export type WindowTransportConfig = Readonly<{ kind: 'direct' | 'private' | 'tunnel'; forward_id: string; base: string }>;
export type WindowTransport = Readonly<{
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  WebSocket: typeof WebSocket;
  dispose(): void;
}>;

declare global {
  interface Window {
    redevenWindowTransport?: WindowTransport;
    floeHostTransport?: Pick<WindowTransport, 'WebSocket'>;
  }
}

const carrierPath = '/flowersec/v3/direct';

export function validateWindowSpend(binding: SpendBindingView, config: WindowTransportConfig, origin: string): void {
  const target = binding.targetBinding as Record<string, unknown> | null;
  if (binding.consumer !== 'trusted' || binding.launcherOrigin !== origin || binding.runtimeOrigin !== origin || binding.appOrigin !== origin ||
      !target || Object.keys(target).sort().join(',') !== 'env_public_id,floe_app,forward_id,kind,v' ||
      target.v !== 1 || target.kind !== 'window' || target.env_public_id !== 'env_local' ||
      target.floe_app !== 'com.floegence.redeven.portforward' || target.forward_id !== config.forward_id) {
    throw new Error('Window transport authority mismatch');
  }
}

// This is product route mapping only. Flowersec owns framing, multiplexing,
// encryption, stream bounds and WebSocket adaptation for every viewer backend.
export function windowTransportPath(input: string, base: string, origin: string): string {
  const url = new URL(input, origin);
  const expected = new URL(origin);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.host !== expected.host ||
      url.protocol.replace('ws', 'http') !== expected.protocol || url.username || url.password || url.hash ||
      (base && !url.pathname.startsWith(base + '/'))) throw new Error('Window transport route mismatch');
  return (base ? url.pathname.slice(base.length) : url.pathname) + url.search;
}

export function create(config: WindowTransportConfig): WindowTransport {
  if (window.redevenWindowTransport) throw new Error('Window transport is already owned');
  if (!['direct','private','tunnel'].includes(config.kind) || !/^[a-z0-9-]+$/.test(config.forward_id) ||
      (config.base !== '' && config.base !== '/pf/' + config.forward_id)) throw new Error('Invalid window transport configuration');
  const origin = window.location.origin;
  const networkFetch = window.fetch.bind(window);
  let closed = false;
  let cached: { session: Session; runtime: ProxyRuntime } | undefined;
  let controller: Promise<ConnectionController> | undefined;
  let release = () => {};
  const bridge = config.kind === 'tunnel' ? registerCodeAppProxyBridge() : undefined;
  const path = (input: string) => windowTransportPath(input, config.kind === 'tunnel' ? '' : config.base, origin);

  async function startController(): Promise<ConnectionController> {
    const options: ControlplaneArtifactSourceOptions = {
      baseUrl: origin, endpointId: config.forward_id,
      fetch: (_input, init) => networkFetch(config.base + '/_redeven_window/connect', {
        method: 'POST', signal: init?.signal, credentials: 'same-origin', cache: 'no-store',
      }),
      validateSpendBinding: binding => validateWindowSpend(binding, config, origin),
      commitSpend: async (request, signal) => {
        const response = await networkFetch(config.base + '/_redeven_window/spend', {
          method: 'POST', signal, credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attempt_id: request.attemptId, receipt: request.receipt,
            artifact_digest_b64u: request.artifactDigestB64u, projection_digest_b64u: request.projectionDigestB64u,
            launcher_origin: request.launcherOrigin, runtime_origin: request.runtimeOrigin, app_origin: request.appOrigin,
            consumer: request.consumer, target_binding: request.targetBinding, expires_at: request.expiresAt }),
        });
        if (!response.ok) throw new Error('Window transport admission failed');
      },
    };
    const source = config.kind === 'private' ? createPrivateLoopbackControlplaneArtifactSource(options)
      : window.location.protocol === 'http:' ? createHTTPDirectControlplaneArtifactSource(options) : createControlplaneArtifactSource(options);
    const current = config.kind === 'private'
      ? await createPrivateLoopbackConnectionControllerV1(source as ReturnType<typeof createPrivateLoopbackControlplaneArtifactSource>, { origin })
      : window.location.protocol === 'http:'
        ? await createHTTPDirectConnectionControllerV1(source as ReturnType<typeof createHTTPDirectControlplaneArtifactSource>, { origin })
        : await createConnectionController(source as ReturnType<typeof createControlplaneArtifactSource>);
    if (closed) { await current.close(); clearAcquisitionSource(source); throw new Error('Window transport closed'); }
    const unsubscribe = current.subscribe(snapshot => {
      synchronizeAcquisitionSourceSnapshot(source, snapshot);
      if (snapshot.currentSession !== cached?.session) { cached?.runtime.dispose(); cached = undefined; }
    });
    release = () => { unsubscribe(); clearAcquisitionSource(source); void current.close(); };
    current.start();
    return current;
  }

  async function runtime(signal?: AbortSignal): Promise<ProxyRuntime> {
    if (closed) throw new Error('Window transport closed');
    if (bridge) return bridge.runtime;
    controller ??= startController();
    const owner = await controller;
    if (owner.state === 'failed') owner.retryNow();
    const session = await owner.waitForSession({ signal });
    if (closed) throw new Error('Window transport closed');
    if (cached?.session !== session) {
      cached?.runtime.dispose();
      cached = { session, runtime: createProxyRuntime({ session, externalOrigin: origin,
        maxWsFrameBytes: MAX_WS_FRAME_BYTES, maxWsBufferedAmountBytes: MAX_WS_FRAME_BYTES * 2,
        pathPolicy: { allowedPathPrefixes: ['/'], allowedWebSocketPathPrefixes: ['/'] } }) };
    }
    return cached.runtime;
  }

  installWebSocketPatch({
    runtime: {
      limits: { maxWsFrameBytes: MAX_WS_FRAME_BYTES, maxWsBufferedAmountBytes: MAX_WS_FRAME_BYTES * 2 } as ProxyRuntime['limits'],
      async openWebSocketStream(input, options) {
        const route = path(input);
        return (await runtime(options?.signal)).openWebSocketStream(route, options);
      },
    },
    // Only Flowersec's own authenticated carrier uses the browser socket. All
    // graphical protocols must enter the SDK's multiplexed stream adapter.
    shouldProxy: url => !(config.kind !== 'tunnel' && url.origin === origin.replace(/^http/, 'ws') && url.pathname === carrierPath && !url.search && !url.hash),
  });
  const transport: WindowTransport = Object.freeze({
    async fetch(input, init) {
      const request = new Request(input instanceof Request ? input : new URL(String(input), window.location.href), init);
      const route = path(request.url);
      return (await runtime(request.signal)).fetch(new Request(new URL(route, origin), request));
    },
    WebSocket: window.WebSocket,
    dispose() {
      if (closed) return;
      closed = true; cached?.runtime.dispose(); cached = undefined;
      release(); bridge?.dispose();
      // Do not restore raw network constructors while a viewer realm survives.
    },
  });
  window.redevenWindowTransport = transport;
  window.addEventListener('pagehide', event => { if (!event.persisted) transport.dispose(); });
  return transport;
}

// Prepared Xpra documents request the parent-owned carrier before Client.js.
// No credentials, native transport or reconnection controller live in the iframe.
if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-floe-host-transport')) {
  const parent = window.parent;
  if (parent === window || parent.location.origin !== window.location.origin ||
      (parent.document.getElementById('application') as HTMLIFrameElement | null)?.contentWindow !== window || !parent.redevenWindowTransport) {
    throw new Error('Host application transport owner is unavailable');
  }
  window.floeHostTransport = Object.freeze({ WebSocket: parent.redevenWindowTransport.WebSocket });
}
