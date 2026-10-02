import { randomBytes } from 'node:crypto';
import { GatewayClientError, type GatewayOpenSessionRequest, type GatewayOpenSessionResponse } from './gatewayClient';
import { createGatewayProxyTransport, GatewayProxyError, type GatewayProxyTransport } from './gatewayProxyTransport';
import type { GatewayRecord } from './gatewayStore';
import type { DesktopGatewayEnvironment } from '../shared/desktopGateway';
import { probeExternalLocalUIStartup, type RuntimeProbeOptions, type RuntimeProbeResult } from './runtimeState';
import type { StartupReport } from './startup';
import type { RuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import { startRuntimePlacementLoopbackProxy, type RuntimePlacementLoopbackProxy } from './runtimePlacementLoopbackProxy';
import { gatewaySessionArtifactURL } from './gatewaySessionArtifact';

export type GatewayEnvironmentAccess = Readonly<{
  response: GatewayOpenSessionResponse;
  startup: StartupReport;
  proxy?: GatewayProxyTransport;
  close: () => Promise<void>;
}>;

type AccessDependencies = Readonly<{
  openSession: (record: GatewayRecord, request: GatewayOpenSessionRequest, options: Readonly<{ signal?: AbortSignal }>) => Promise<Readonly<{ response: GatewayOpenSessionResponse; bridge_session?: RuntimePlacementBridgeSession }>>;
  closeSession: (record: GatewayRecord, sessionID: string) => Promise<void>;
  onRevokeFailure?: (gatewayID: string, environmentID: string, sessionID: string) => void;
  createProxy?: typeof createGatewayProxyTransport;
  probe?: (url: string, options: RuntimeProbeOptions) => Promise<RuntimeProbeResult<StartupReport>>;
}>;

export async function prepareGatewayEnvironmentAccess(
  record: GatewayRecord,
  environment: DesktopGatewayEnvironment,
  mode: 'direct_url' | 'gateway_proxy',
  dependencies: AccessDependencies,
  signal?: AbortSignal,
): Promise<GatewayEnvironmentAccess> {
  const capability = mode === 'gateway_proxy' ? 'open_via_gateway' : 'open_direct';
  if (!environment.access_capabilities?.includes(capability) || !environment.access_endpoint?.url) {
    throw new GatewayClientError('GATEWAY_CAPABILITY_UNSUPPORTED', 'This Gateway profile does not support the selected access mode.');
  }
  const { response, bridge_session: bridge } = await dependencies.openSession(record, {
    gateway_env_id: environment.gateway_env_id,
    requested_capability: 'env_app',
    access_mode: mode,
    client_nonce: randomBytes(24).toString('base64url'),
  }, { signal });
  let proxy: GatewayProxyTransport | undefined;
  let bridgeProxy: RuntimePlacementLoopbackProxy | undefined;
  let closeTask: Promise<void> | undefined;
  const close = () => closeTask ??= (async () => {
    const local = await Promise.allSettled([proxy?.close(), bridgeProxy?.close()]);
    try { await dependencies.closeSession(record, response.gateway_session_id); }
    catch (error) {
      dependencies.onRevokeFailure?.(record.gateway_id, environment.gateway_env_id, response.gateway_session_id);
      throw error;
    }
    const failure = local.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  })();
  try {
    if (signal?.aborted) throw new GatewayProxyError('GATEWAY_CANCELED');
    const artifact = response.connect_artifact;
    const expected = mode === 'gateway_proxy'
      ? record.connection.kind === 'url' ? 'gateway_proxy_artifact' : 'desktop_bridge_artifact'
      : 'local_direct_artifact';
    if (artifact.kind !== expected || !artifact.url) {
      throw new GatewayClientError('GATEWAY_ARTIFACT_UNSUPPORTED', 'Gateway returned an artifact for a different access mode.');
    }
    const targetURL = environment.access_endpoint.url;
    if (mode === 'gateway_proxy') {
      if (record.connection.kind !== 'url') {
        if (!bridge || artifact.gateway_session_id !== response.gateway_session_id) {
          throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway bridge artifact is missing its session identity.');
        }
        bridgeProxy = await startRuntimePlacementLoopbackProxy(bridge);
      }
      const accessURL = gatewaySessionArtifactURL(record, response,
        bridge && bridgeProxy ? { ...bridge, local_ui_url: bridgeProxy.url } : undefined);
      proxy = await (dependencies.createProxy ?? createGatewayProxyTransport)(accessURL, targetURL);
    } else if (new URL(artifact.url).href !== new URL(targetURL).href) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact does not match the catalog endpoint.');
    }
    const result = await (dependencies.probe ?? probeExternalLocalUIStartup)(targetURL, {
      signal, agent: proxy?.agent, gatewayEndpoint: true, timeoutMs: 15_000,
      shellCacheScope: `gateway:${record.gateway_id}:${response.gateway_session_id}`,
    });
    if (!result.ok) {
      if (mode === 'gateway_proxy') {
        const code = result.failure.code;
        if (code === 'GATEWAY_UNREACHABLE' || code === 'GATEWAY_SESSION_EXPIRED' || code === 'GATEWAY_CANCELED') throw new GatewayProxyError(code);
        throw new GatewayProxyError('GATEWAY_TARGET_UNAVAILABLE');
      }
      throw new GatewayClientError('GATEWAY_DIRECT_TARGET_UNAVAILABLE', 'Desktop cannot reach the direct Runtime URL.');
    }
    if (signal?.aborted) throw new GatewayProxyError('GATEWAY_CANCELED');
    // The selected catalog endpoint owns this transport. Advertised Runtime
    // addresses cannot move a successful probe to a different network route.
    return { response, proxy, close, startup: { ...result.value, local_ui_url: targetURL, local_ui_urls: [targetURL] } };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
