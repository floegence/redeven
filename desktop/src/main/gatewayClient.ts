import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import { openGatewayBridgeSocket } from './gatewayBridgeSocket';

import {
  normalizeGatewayBaseURL,
  gatewayProtocolID,
  type GatewayRecord,
  type GatewayTrustProfile,
  type GatewayURLConnection,
} from './gatewayStore';
import {
  assertGatewayConnectArtifactProof,
  assertGatewayFingerprint,
  createGatewayAuthHeaders,
  type GatewayPairingCompleteResponse,
  type GatewayPairingChallengeResponse,
  type GatewayPairingCompleteRequest,
  type GatewaySecretStore,
} from './gatewayTrust';
import type {
  DesktopGatewayCapability,
  DesktopGatewayEnvironment,
  DesktopGatewayEnvironmentCapability,
  DesktopGatewayEnvironmentProfileAccessRoute,
  DesktopGatewayEnvironmentOriginKind,
  DesktopGatewayEnvironmentState,
} from '../shared/desktopGateway';
import { desktopGatewayProfileURLHasEmbeddedCredentials } from '../shared/desktopGateway';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';

const GATEWAY_PROTOCOL_VERSION = 'redeven-gateway-v3';
const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = 20_000;

type GatewayRequestOptions = Readonly<{
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

export type GatewayCatalogResponse = Readonly<{
  protocol_version: string;
  gateway: Readonly<{
    gateway_id: string;
    display_name: string;
    status: 'online' | 'pairing_required' | 'trust_changed' | 'error' | 'unknown';
    capabilities: readonly DesktopGatewayCapability[];
    gateway_public_key_fingerprint?: string;
  }>;
  environments: readonly DesktopGatewayEnvironment[];
}>;

export type GatewayOpenSessionRequest = Readonly<{
  gateway_env_id: string;
  requested_capability: 'env_app' | 'terminal' | 'files' | 'web_service' | 'port_forward';
  client_nonce: string;
  access_mode?: 'direct_url' | 'gateway_proxy';
  bridge_session_id?: string;
  route_id?: string;
}>;

export type GatewayOpenSessionResponse = Readonly<{
  protocol_version: string;
  gateway_session_id: string;
  gateway_env_id: string;
  connect_artifact: GatewayConnectArtifact;
  diagnostics_hint?: Readonly<{
    gateway_env_id: string;
    connection_kind: string;
  }>;
}>;

export type GatewayEnvProfileAccessRoute = Readonly<{
  kind: 'url';
  url?: string;
  origin_label?: string;
}>;

export type GatewayEnvProfileUpsertRequest = Readonly<{
  gateway_env_id?: string;
  display_name: string;
  access_route: GatewayEnvProfileAccessRoute;
  access_mode?: 'direct_url' | 'gateway_proxy';
}>;

export type GatewayEnvProfileUpsertResponse = Readonly<{
  protocol_version: string;
  environment: DesktopGatewayEnvironment;
}>;

export type GatewayEnvProfileDeleteRequest = Readonly<{
  gateway_env_id: string;
}>;

export type GatewayEnvProfileDeleteResponse = Readonly<{
  protocol_version: string;
  gateway_env_id: string;
  deleted: boolean;
}>;

/* Runtime lifecycle is managed by Desktop direct channels, never by Gateway. */
/* Removed Gateway Runtime lifecycle protocol types. */
export type GatewayConnectArtifact = Readonly<{
  kind: 'local_direct_artifact' | 'gateway_proxy_artifact' | 'desktop_bridge_artifact';
  url?: string;
  gateway_session_id?: string;
  bridge_session_id?: string;
  route_id?: string;
  expires_at_unix_ms: number;
  artifact_nonce: string;
  proof: string;
}>;

type GatewayHTTPEnvelope = Readonly<{
  ok?: boolean;
  data?: unknown;
  error?: Readonly<{
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    redacted_detail?: unknown;
  }>;
}>;

type GatewayRouteTemplate =
  | 'gateway/v3/pairing/challenge'
  | 'gateway/v3/pairing/complete'
  | 'gateway/v3/catalog'
  | 'gateway/v3/open-session'
  | 'gateway/v3/close-session'
  | 'gateway/v3/env-profiles/check'
  | 'gateway/v3/env-profiles/upsert'
  | 'gateway/v3/env-profiles/delete';

type GatewayRoute = GatewayRouteTemplate;

type GatewayHTTPMethod = 'GET' | 'POST' | 'PUT';

type GatewayTransportCallOptions = GatewayRequestOptions & Readonly<{
  secretStore: GatewaySecretStore;
  authenticated?: boolean;
}>;

type GatewayHTTPDataResult = Readonly<{
  data: unknown;
}>;

export class GatewayClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GatewayClientError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function parseEnvelope(raw: string): GatewayHTTPEnvelope | null {
  try {
    return JSON.parse(raw || '{}') as GatewayHTTPEnvelope;
  } catch {
    return null;
  }
}

function gatewayErrorMessage(envelope: GatewayHTTPEnvelope, statusCode: number): string {
  const redactedDetail = compact(envelope.error?.redacted_detail);
  if (redactedDetail) {
    return String(redactGatewayDiagnosticValue(redactedDetail));
  }
  const code = compact(envelope.error?.code);
  return code
    ? `Gateway request failed with ${code}.`
    : `Gateway request failed with status ${statusCode}.`;
}

function gatewayURL(connection: GatewayURLConnection, route: GatewayRoute): URL {
  const baseURL = normalizeGatewayBaseURL(connection.base_url);
  const url = new URL(route, baseURL);
  if (url.protocol !== 'https:') {
    if (url.protocol !== 'http:' || !connection.allow_loopback_http || !isLoopbackHost(url.hostname)) {
      throw new GatewayClientError('GATEWAY_URL_INSECURE', 'Gateway URL must use HTTPS unless loopback development mode is enabled.');
    }
  }
  return url;
}

function abortError(): GatewayClientError {
  const error = new GatewayClientError('GATEWAY_CANCELED', 'Gateway request was canceled.', null, true);
  error.name = 'AbortError';
  return error;
}

function gatewayTimeoutMs(value: unknown): number {
  return Math.max(1, Math.floor(Number(value) || DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS));
}

function throwIfCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function parseGatewayHTTPResponse(raw: string, statusCode: number): unknown {
  const parsed = parseEnvelope(raw);
  if (statusCode === 404 && !parsed) {
    throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol mismatch. Update Gateway and Desktop to matching versions.', statusCode);
  }
  if (!parsed) {
    throw new GatewayClientError(
      'GATEWAY_INVALID_RESPONSE',
      statusCode >= 400
        ? `Gateway returned HTTP ${statusCode} with a non-JSON response.`
        : 'Gateway returned a non-JSON response.',
      statusCode,
    );
  }
  if (parsed.ok === false || statusCode >= 400) {
    throw new GatewayClientError(
      compact(parsed.error?.code) || 'GATEWAY_REQUEST_FAILED',
      gatewayErrorMessage(parsed, statusCode),
      statusCode,
      parsed.error?.retryable === true,
    );
  }
  return Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed;
}

function isLoopbackHost(hostname: string): boolean {
  const host = compact(hostname).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function requestGatewayJSON(
  record: GatewayRecord,
  route: GatewayRoute,
  body: unknown | undefined,
  options: GatewayTransportCallOptions,
  method: GatewayHTTPMethod = 'POST',
): Promise<GatewayHTTPDataResult> {
  if (record.connection.kind !== 'url') {
    return Promise.reject(new GatewayClientError('GATEWAY_TRANSPORT_UNSUPPORTED', 'This Gateway transport is not handled by the URL client.'));
  }
  let url: URL;
  try {
    url = gatewayURL(record.connection, route);
  } catch (error) {
    return Promise.reject(error);
  }

  const payload = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
  const requestImpl = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    void createGatewayAuthHeaders({
      record,
      method,
      route: `/${route}`,
      body,
      secret_store: options.secretStore,
    }).then((authHeaders) => {
      const req = requestImpl(url, {
        method,
        timeout: gatewayTimeoutMs(options.timeoutMs),
        headers: {
          Accept: 'application/json',
          ...authHeaders,
          ...(payload.length > 0 ? { 'Content-Length': payload.length } : {}),
        },
      }, (response) => {
        response.setEncoding('utf8');
        let raw = '';
        response.on('data', (chunk: string) => {
          raw += chunk;
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 500;
          try {
            resolve({
              data: parseGatewayHTTPResponse(raw, statusCode),
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      const onAbort = () => {
        req.destroy(abortError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      req.on('timeout', () => {
        req.destroy(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway request timed out.', null, true));
      });
      req.on('error', (error) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(error instanceof GatewayClientError
          ? error
          : new GatewayClientError('GATEWAY_UNREACHABLE', error.message || 'Desktop could not reach the Gateway.', null, true));
      });
      req.on('close', () => {
        options.signal?.removeEventListener('abort', onAbort);
      });
      if (payload.length > 0) {
        req.write(payload);
      }
      req.end();
    }).catch(reject);
  });
}

function requestGatewayPairingJSON(
  record: GatewayRecord,
  route: Extract<GatewayRoute, 'gateway/v3/pairing/challenge' | 'gateway/v3/pairing/complete'>,
  body: unknown,
  options: GatewayRequestOptions = {},
): Promise<unknown> {
  if (record.connection.kind !== 'url') {
    return Promise.reject(new GatewayClientError('GATEWAY_TRANSPORT_UNSUPPORTED', 'This Gateway transport is not handled by the URL client.'));
  }
  let url: URL;
  try {
    url = gatewayURL(record.connection, route);
  } catch (error) {
    return Promise.reject(error);
  }

  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const requestImpl = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const req = requestImpl(url, {
      method: 'POST',
      timeout: gatewayTimeoutMs(options.timeoutMs),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    }, (response) => {
      response.setEncoding('utf8');
      let raw = '';
      response.on('data', (chunk: string) => {
        raw += chunk;
      });
      response.on('end', () => {
        const statusCode = response.statusCode ?? 500;
        try {
          resolve(parseGatewayHTTPResponse(raw, statusCode));
        } catch (error) {
          reject(error);
        }
      });
    });
    const onAbort = () => {
      req.destroy(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', () => {
      req.destroy(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway request timed out.', null, true));
    });
    req.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(error instanceof GatewayClientError
        ? error
        : new GatewayClientError('GATEWAY_UNREACHABLE', error.message || 'Desktop could not reach the Gateway.', null, true));
    });
    req.on('close', () => {
      options.signal?.removeEventListener('abort', onAbort);
    });
    req.write(payload);
    req.end();
  });
}

async function requestGatewayBridgeJSON(
  bridge: RuntimePlacementBridgeSessionHandle,
  record: GatewayRecord,
  route: GatewayRoute,
  body: unknown | undefined,
  options: GatewayTransportCallOptions,
  method: GatewayHTTPMethod = 'POST',
): Promise<GatewayHTTPDataResult> {
  throwIfCanceled(options.signal);
  const authHeaders = options.authenticated === false ? {} : await createGatewayAuthHeaders({
    record, method, route: `/${route}`, body, secret_store: options.secretStore,
  });
  throwIfCanceled(options.signal);
  const payload = body == null ? '' : JSON.stringify(body);
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => {
    try { return openGatewayBridgeSocket(bridge) as net.Socket; }
    catch (error) {
      throw error instanceof GatewayClientError ? error
        : new GatewayClientError('GATEWAY_BRIDGE_UNAVAILABLE', 'Gateway bridge is unavailable.', null, true);
    }
  };
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, data?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve({ data });
      };
      const fail = (error: Error) => finish(error instanceof GatewayClientError ? error
        : new GatewayClientError('GATEWAY_BRIDGE_FAILED', 'Gateway bridge request failed.', null, true));
      const req = http.request('http://redeven-gateway.local', {
        agent, method, path: `/${route}`, headers: {
          Accept: 'application/json', 'X-Redeven-Gateway-Transport': 'desktop_bridge',
          ...authHeaders, 'Content-Length': Buffer.byteLength(payload), Connection: 'close',
        },
      }, response => {
        response.setEncoding('utf8');
        let raw = '';
        response.on('data', (chunk: string) => { raw += chunk; });
        response.once('error', fail);
        response.once('end', () => {
          try { finish(undefined, parseGatewayHTTPResponse(raw, response.statusCode ?? 500)); }
          catch (error) { finish(error); }
        });
      });
      const abort = () => req.destroy(abortError());
      const timer = setTimeout(() => req.destroy(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway request timed out.', null, true)), gatewayTimeoutMs(options.timeoutMs));
      req.once('error', fail);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort(); else req.end(payload);
    });
  } finally { agent.destroy(); }
}

function normalizeProtocolVersion(value: unknown): typeof GATEWAY_PROTOCOL_VERSION {
  const protocolVersion = typeof value === 'string' ? value : '';
  if (protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
    throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol version is not supported.');
  }
  return protocolVersion;
}

function normalizeEnvironmentState(value: unknown): DesktopGatewayEnvironmentState {
  switch (compact(value)) {
    case 'available':
    case 'starting':
    case 'stopped':
    case 'archived':
      return compact(value) as DesktopGatewayEnvironmentState;
    default:
      return 'unknown';
  }
}

function normalizeEnvironmentCapability(value: unknown): DesktopGatewayEnvironmentCapability | null {
  switch (compact(value)) {
    case 'open':
    case 'open_direct':
    case 'open_via_gateway':
    case 'terminal':
    case 'files':
    case 'web_service':
    case 'port_forward':
      return compact(value) as DesktopGatewayEnvironmentCapability;
    default:
      return null;
  }
}

function normalizeGatewayCapability(value: unknown): DesktopGatewayCapability | null {
  switch (compact(value)) {
    case 'env_catalog':
    case 'env_direct_open':
    case 'env_proxy_open':
    case 'env_profile_write':
    case 'terminal':
    case 'files':
    case 'web_service':
    case 'port_forward':
      return compact(value) as DesktopGatewayCapability;
    default:
      return null;
  }
}

function normalizeGatewayStatus(value: unknown): GatewayCatalogResponse['gateway']['status'] {
  switch (compact(value)) {
    case 'online':
    case 'pairing_required':
    case 'trust_changed':
    case 'error':
      return compact(value) as GatewayCatalogResponse['gateway']['status'];
    default:
      return 'unknown';
  }
}

function normalizeOriginKind(value: unknown): DesktopGatewayEnvironmentOriginKind {
  switch (compact(value)) {
    case 'gateway_host':
    case 'ssh_target':
    case 'container':
    case 'network_target':
      return compact(value) as DesktopGatewayEnvironmentOriginKind;
    default:
      return 'network_target';
  }
}

function normalizeProfileAccessRouteKind(value: unknown): DesktopGatewayEnvironmentProfileAccessRoute['kind'] | null {
  const kind = compact(value);
  return kind === 'url' || kind === 'ssh_host' || kind === 'ssh_container' ? kind : null;
}

function normalizeGatewayEnvironmentProfileAccessRoute(value: unknown): DesktopGatewayEnvironmentProfileAccessRoute | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const kind = normalizeProfileAccessRouteKind(candidate.kind);
  if (!kind) {
    return undefined;
  }
  const route: DesktopGatewayEnvironmentProfileAccessRoute = {
    kind,
    ...(compact(candidate.url) ? { url: compact(candidate.url) } : {}),
    ...(compact(candidate.origin_label) ? { origin_label: compact(candidate.origin_label) } : {}),
    ...(kind !== 'url' ? {
      ssh_destination: compact(candidate.ssh_destination), ssh_port: Number(candidate.ssh_port) || 22,
      auth_mode: compact(candidate.auth_mode), ssh_runtime_root: compact(candidate.ssh_runtime_root),
      ...(kind === 'ssh_container' ? { container_engine: compact(candidate.container_engine),
        container_id: compact(candidate.container_id), container_runtime_root: compact(candidate.container_runtime_root) } : {}),
    } : {}),
  };
  if (route.kind === 'url' && (!route.url || desktopGatewayProfileURLHasEmbeddedCredentials(route.url))) {
    return undefined;
  }
  return route;
}

function normalizeGatewayEnvironmentProfile(value: unknown): DesktopGatewayEnvironment['profile'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const kind = normalizeProfileAccessRouteKind(candidate.access_route_kind);
  if (candidate.managed !== true || !kind) {
    return undefined;
  }
  if (candidate.access_mode !== 'direct_url' && candidate.access_mode !== 'gateway_proxy') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway profile access_mode is invalid.');
  }
  return {
    managed: true,
    access_route_kind: kind,
    access_mode: candidate.access_mode,
  };
}

function normalizeGatewayEnvironment(value: unknown): DesktopGatewayEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const gatewayEnvID = compact(candidate.gateway_env_id);
  if (!gatewayEnvID || gatewayEnvID === 'env_local') {
    return null;
  }
  const origin = candidate.origin && typeof candidate.origin === 'object'
    ? candidate.origin as Record<string, unknown>
    : {};
  const accessCapabilities = Array.isArray(candidate.access_capabilities)
    ? candidate.access_capabilities.map(normalizeEnvironmentCapability).filter((item): item is DesktopGatewayEnvironmentCapability => !!item)
    : [];
  const normalizedAccessCapabilities = [...new Set(accessCapabilities)];
  const profileAccessRoute = normalizeGatewayEnvironmentProfileAccessRoute(candidate.profile_access_route);
  const accessEndpoint = normalizeGatewayEnvironmentProfileAccessRoute(candidate.access_endpoint);
  const profile = normalizeGatewayEnvironmentProfile(candidate.profile);
  return {
    gateway_env_id: gatewayEnvID,
    display_name: compact(candidate.display_name) || gatewayEnvID,
    env_kind: 'reachable_env',
    state: normalizeEnvironmentState(candidate.state),
    capabilities: normalizedAccessCapabilities,
    access_capabilities: normalizedAccessCapabilities,
    ...(profile ? { profile } : {}),
    ...(profileAccessRoute ? { profile_access_route: profileAccessRoute } : {}),
    ...(accessEndpoint ? { access_endpoint: accessEndpoint } : {}),
    origin: {
      kind: normalizeOriginKind(origin.kind),
      label: compact(origin.label),
    },
    ...(Number.isFinite(Number(candidate.last_seen_at_unix_ms)) && Number(candidate.last_seen_at_unix_ms) > 0
      ? { last_seen_at_unix_ms: Math.floor(Number(candidate.last_seen_at_unix_ms)) }
      : {}),
  };
}

function normalizeGatewayEnvProfileUpsertResponse(value: unknown): GatewayEnvProfileUpsertResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway profile save response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const environment = normalizeGatewayEnvironment(candidate.environment);
  if (!environment) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway profile save response is missing environment.');
  }
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    environment,
  };
}

function normalizeGatewayEnvProfileDeleteResponse(value: unknown): GatewayEnvProfileDeleteResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway profile delete response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const gatewayEnvID = compact(candidate.gateway_env_id);
  if (!gatewayEnvID) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway profile delete response is missing gateway_env_id.');
  }
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    gateway_env_id: gatewayEnvID,
    deleted: candidate.deleted === true,
  };
}

function normalizeGatewayProfileURL(value: string | undefined): string {
  const raw = compact(value);
  if (!raw) {
    return '';
  }
  if (desktopGatewayProfileURLHasEmbeddedCredentials(raw)) {
    throw new GatewayClientError('GATEWAY_PROFILE_URL_CREDENTIALS_UNSUPPORTED', 'Gateway target URL must not include embedded credentials.');
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return raw;
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function gatewayEnvProfilePayload(request: GatewayEnvProfileUpsertRequest): unknown {
  if (request.access_route.kind !== 'url') {
    throw new Error('Gateway profile access must use an explicit URL endpoint.');
  }
  const routeURL = normalizeGatewayProfileURL(request.access_route.url);
  return {
    protocol_version: GATEWAY_PROTOCOL_VERSION,
    profile: {
      ...(compact(request.gateway_env_id) ? { gateway_env_id: compact(request.gateway_env_id) } : {}),
      display_name: compact(request.display_name),
      ...(request.access_mode ? { access_mode: request.access_mode } : {}),
      access_route: {
        kind: 'url',
        ...(routeURL ? { url: routeURL } : {}),
        ...(compact(request.access_route.origin_label) ? { origin_label: compact(request.access_route.origin_label) } : {}),
      },
    },
  };
}

export function normalizeGatewayCatalogResponse(value: unknown): GatewayCatalogResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway catalog response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const gateway = candidate.gateway && typeof candidate.gateway === 'object'
    ? candidate.gateway as Record<string, unknown>
    : {};
  const gatewayID = compact(gateway.gateway_id);
  if (!gatewayID) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway catalog response is missing gateway_id.');
  }
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    gateway: {
      gateway_id: gatewayID,
      display_name: compact(gateway.display_name) || gatewayID,
      status: normalizeGatewayStatus(gateway.status),
      capabilities: Array.isArray(gateway.capabilities)
        ? [...new Set(gateway.capabilities.map(normalizeGatewayCapability).filter((item): item is DesktopGatewayCapability => !!item))]
        : [],
      ...(compact(gateway.gateway_public_key_fingerprint) ? { gateway_public_key_fingerprint: compact(gateway.gateway_public_key_fingerprint) } : {}),
    },
    environments: Array.isArray(candidate.environments)
      ? candidate.environments.map(normalizeGatewayEnvironment).filter((item): item is DesktopGatewayEnvironment => !!item)
      : [],
  };
}

function normalizePairingChallengeResponse(value: unknown): GatewayPairingChallengeResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway pairing challenge response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const gatewayPublicKey = typeof candidate.gateway_public_key === 'string' ? candidate.gateway_public_key : '';
  const response = {
    protocol_version: typeof candidate.protocol_version === 'string' ? candidate.protocol_version : '',
    gateway_id: compact(candidate.gateway_id),
    gateway_public_key: gatewayPublicKey,
    gateway_public_key_fingerprint: compact(candidate.gateway_public_key_fingerprint) || undefined,
    gateway_nonce: compact(candidate.gateway_nonce),
    pairing_code: compact(candidate.pairing_code) || undefined,
    expires_at_unix_ms: Number(candidate.expires_at_unix_ms),
    signature: compact(candidate.signature),
  };
  if (
    response.protocol_version !== GATEWAY_PROTOCOL_VERSION
    || !response.gateway_id
    || !compact(response.gateway_public_key)
    || !response.gateway_nonce
    || !Number.isFinite(response.expires_at_unix_ms)
    || !response.signature
  ) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway pairing challenge response is incomplete.');
  }
  return response;
}

function normalizePairingCompleteResponse(value: unknown): GatewayPairingCompleteResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway pairing completion response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const response: GatewayPairingCompleteResponse = {
    protocol_version: typeof candidate.protocol_version === 'string' ? candidate.protocol_version : '',
    gateway_id: compact(candidate.gateway_id),
    client_key_id: compact(candidate.client_key_id),
    paired_at_unix_ms: Number(candidate.paired_at_unix_ms),
    proof: compact(candidate.proof),
  };
  if (
    response.protocol_version !== GATEWAY_PROTOCOL_VERSION
    || !response.gateway_id
    || !response.client_key_id
    || !Number.isFinite(response.paired_at_unix_ms)
    || !response.proof
  ) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway pairing completion response is incomplete.');
  }
  return response;
}

function assertLocalDirectArtifactURL(rawURL: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact URL is invalid.');
  }
  if (parsed.username || parsed.password) {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact URL must not include embedded credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact URL must not include query or fragment data.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact URL must use HTTP or HTTPS.');
  }
  return parsed.toString();
}

function normalizeConnectArtifact(value: unknown): GatewayConnectArtifact {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway open-session response is missing connect_artifact.');
  }
  const candidate = value as Record<string, unknown>;
  const kind = compact(candidate.kind);
  const expiresAt = Number(candidate.expires_at_unix_ms);
  const artifactNonce = compact(candidate.artifact_nonce);
  const proof = compact(candidate.proof);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !artifactNonce || !proof) {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway connect artifact is invalid or expired.');
  }
  if (kind === 'local_direct_artifact' || kind === 'gateway_proxy_artifact') {
    const url = compact(candidate.url);
    if (!url) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact is missing its URL.');
    }
    const normalizedURL = assertLocalDirectArtifactURL(url);
    const gatewaySessionID = compact(candidate.gateway_session_id);
    if (kind === 'gateway_proxy_artifact' && !gatewaySessionID) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway proxy artifact is missing its session identity.');
    }
    return {
      kind,
      url: normalizedURL,
      ...(kind === 'gateway_proxy_artifact' ? { gateway_session_id: gatewaySessionID } : {}),
      expires_at_unix_ms: Math.floor(expiresAt),
      artifact_nonce: artifactNonce,
      proof,
    };
  }
  if (kind === 'desktop_bridge_artifact') {
    const bridgeSessionID = compact(candidate.bridge_session_id);
    const routeID = compact(candidate.route_id);
    if (!bridgeSessionID || !routeID) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway bridge artifact is incomplete.');
    }
    return {
      kind,
      ...(compact(candidate.url) ? { url: compact(candidate.url) } : {}),
      ...(compact(candidate.gateway_session_id) ? { gateway_session_id: compact(candidate.gateway_session_id) } : {}),
      bridge_session_id: bridgeSessionID,
      route_id: routeID,
      expires_at_unix_ms: Math.floor(expiresAt),
      artifact_nonce: artifactNonce,
      proof,
    };
  }
  throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway connect artifact kind is not supported.');
}

export function normalizeGatewayOpenSessionResponse(value: unknown): GatewayOpenSessionResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway open-session response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const gatewaySessionID = compact(candidate.gateway_session_id);
  const gatewayEnvID = compact(candidate.gateway_env_id);
  if (!gatewaySessionID || !gatewayEnvID) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway open-session response is missing session identity.');
  }
  const diagnostics = candidate.diagnostics_hint && typeof candidate.diagnostics_hint === 'object'
    ? candidate.diagnostics_hint as Record<string, unknown>
    : null;
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    gateway_session_id: gatewaySessionID,
    gateway_env_id: gatewayEnvID,
    connect_artifact: normalizeConnectArtifact(candidate.connect_artifact),
    ...(diagnostics ? {
      diagnostics_hint: {
        gateway_env_id: compact(diagnostics.gateway_env_id),
        connection_kind: compact(diagnostics.connection_kind),
      },
    } : {}),
  };
}

function assertProxyArtifactIdentity(record: GatewayRecord, response: GatewayOpenSessionResponse): void {
  const artifact = response.connect_artifact;
  if (artifact.kind !== 'gateway_proxy_artifact') return;
  const url = new URL(artifact.url!);
  const prefix = record.connection.kind === 'url' ? new URL('gateway/v3/access/', record.connection.base_url).pathname : '';
  if (record.connection.kind !== 'url' || url.origin !== new URL(record.connection.base_url).origin
    || artifact.gateway_session_id !== response.gateway_session_id
    || !url.pathname.startsWith(prefix) || !/^[A-Za-z0-9_-]{43}\/$/u.test(url.pathname.slice(prefix.length))) {
    throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway proxy artifact does not match its Gateway and session.');
  }
}

function assertGatewayIdentity(record: GatewayRecord, observedGatewayID: string, observedFingerprint: string | undefined): void {
  const profile: GatewayTrustProfile | undefined = record.trust_profile;
  if (gatewayProtocolID(record) !== observedGatewayID) {
    throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'Gateway response does not match the saved Gateway.');
  }
  if (profile) {
    if (!observedFingerprint) {
      throw new GatewayClientError('GATEWAY_FINGERPRINT_REQUIRED', 'Gateway response did not include the pinned fingerprint.');
    }
    assertGatewayFingerprint(profile, observedFingerprint);
  }
}

export class GatewayURLClient {
  constructor(private readonly secretStore: GatewaySecretStore) {}

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v3/catalog', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const catalog = normalizeGatewayCatalogResponse(data.data);
    assertGatewayIdentity(record, catalog.gateway.gateway_id, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }

  async pairingChallenge(
    record: GatewayRecord,
    request: Readonly<{
      protocol_version: 'redeven-gateway-v3';
	      client_nonce: string;
	      client_public_key: string;
	      binding_audience: string;
	      pairing_code?: string;
	    }>,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingChallengeResponse> {
    const data = await requestGatewayPairingJSON(record, 'gateway/v3/pairing/challenge', request, options);
    return normalizePairingChallengeResponse(data);
  }

  async completePairing(
    record: GatewayRecord,
    request: GatewayPairingCompleteRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingCompleteResponse> {
    const data = await requestGatewayPairingJSON(record, 'gateway/v3/pairing/complete', request, options);
    return normalizePairingCompleteResponse(data);
  }

  async openSession(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayOpenSessionResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v3/open-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
      ...(request.access_mode ? { access_mode: request.access_mode } : {}),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const response = normalizeGatewayOpenSessionResponse(data.data);
    assertProxyArtifactIdentity(record, response);
    if (response.gateway_env_id !== request.gateway_env_id) {
      throw new GatewayClientError('GATEWAY_ENV_ID_MISMATCH', 'Gateway open-session response does not match the requested environment.');
    }
    assertGatewayConnectArtifactProof({
      record,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
      gateway_session_id: response.gateway_session_id,
      artifact: response.connect_artifact,
    });
    return response;
  }

  async checkEnvironmentProfile(record: GatewayRecord, targetURL: string, clientNonce: string, options: GatewayRequestOptions = {}): Promise<unknown> {
    const data = await requestGatewayJSON(record, 'gateway/v3/env-profiles/check', {
      protocol_version: GATEWAY_PROTOCOL_VERSION, target_url: targetURL, client_nonce: clientNonce,
    }, { secretStore: this.secretStore, ...options });
    const response = data.data as { protocol_version?: string; access_identity?: unknown };
    if (response?.protocol_version !== GATEWAY_PROTOCOL_VERSION) throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol mismatch.');
    return response.access_identity;
  }

  async upsertEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileUpsertRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileUpsertResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v3/env-profiles/upsert', gatewayEnvProfilePayload(request), {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileUpsertResponse(data.data);
  }

  async closeSession(record: GatewayRecord, gatewaySessionID: string, options: GatewayRequestOptions = {}): Promise<void> {
    await requestGatewayJSON(record, 'gateway/v3/close-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_session_id: gatewaySessionID,
    }, { secretStore: this.secretStore, ...options });
  }

  async deleteEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileDeleteRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileDeleteResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v3/env-profiles/delete', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileDeleteResponse(data.data);
  }
}

export class GatewayBridgeClient {
  constructor(
    private readonly secretStore: GatewaySecretStore,
    private readonly bridge: RuntimePlacementBridgeSessionHandle,
  ) {}

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/catalog', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const catalog = normalizeGatewayCatalogResponse(data.data);
    assertGatewayIdentity(record, catalog.gateway.gateway_id, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }

  async closeSession(record: GatewayRecord, gatewaySessionID: string, options: GatewayRequestOptions = {}): Promise<void> {
    await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/close-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_session_id: gatewaySessionID,
    }, { secretStore: this.secretStore, ...options });
  }

  async pairingChallenge(
    record: GatewayRecord,
    request: Readonly<{
      protocol_version: 'redeven-gateway-v3';
	      client_nonce: string;
	      client_public_key: string;
	      binding_audience: string;
	      pairing_code?: string;
	    }>,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingChallengeResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/pairing/challenge', request, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      authenticated: false,
    });
    return normalizePairingChallengeResponse(data.data);
  }

  async completePairing(
    record: GatewayRecord,
    request: GatewayPairingCompleteRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingCompleteResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/pairing/complete', request, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      authenticated: false,
    });
    return normalizePairingCompleteResponse(data.data);
  }

  async openSession(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayOpenSessionResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/open-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
      bridge_session_id: request.bridge_session_id,
      route_id: request.route_id,
      ...(request.access_mode ? { access_mode: request.access_mode } : {}),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const response = normalizeGatewayOpenSessionResponse(data.data);
    if (response.gateway_env_id !== request.gateway_env_id) {
      throw new GatewayClientError('GATEWAY_ENV_ID_MISMATCH', 'Gateway open-session response does not match the requested environment.');
    }
    assertGatewayConnectArtifactProof({
      record,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
      gateway_session_id: response.gateway_session_id,
      artifact: response.connect_artifact,
    });
    return response;
  }

  async checkEnvironmentProfile(record: GatewayRecord, targetURL: string, clientNonce: string, options: GatewayRequestOptions = {}): Promise<unknown> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/env-profiles/check', {
      protocol_version: GATEWAY_PROTOCOL_VERSION, target_url: targetURL, client_nonce: clientNonce,
    }, { secretStore: this.secretStore, ...options });
    const response = data.data as { protocol_version?: string; access_identity?: unknown };
    if (response?.protocol_version !== GATEWAY_PROTOCOL_VERSION) throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Gateway protocol mismatch.');
    return response.access_identity;
  }

  async upsertEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileUpsertRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileUpsertResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/env-profiles/upsert', gatewayEnvProfilePayload(request), {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileUpsertResponse(data.data);
  }

  async deleteEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileDeleteRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileDeleteResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v3/env-profiles/delete', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileDeleteResponse(data.data);
  }
}

export function redactGatewayDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactGatewayDiagnosticValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      isSensitiveGatewayKey(key) ? '[redacted]' : redactGatewayDiagnosticValue(nested),
    ]));
  }
  return typeof value === 'string' ? value.replace(/(\/gateway\/v3\/access\/)[A-Za-z0-9_-]+/gu, '$1[redacted]').slice(0, 240) : value;
}

function isSensitiveGatewayKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered.includes('token')
    || lowered.includes('secret')
    || lowered.includes('password')
    || lowered.includes('authorization')
    || lowered.includes('cookie')
    || lowered.includes('signature')
    || lowered.includes('private_key')
    || lowered.includes('proof');
}
