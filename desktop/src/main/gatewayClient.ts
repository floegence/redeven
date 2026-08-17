import http from 'node:http';
import https from 'node:https';

import {
  normalizeGatewayBaseURL,
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
  DesktopGatewayRuntimeManagementCapability,
} from '../shared/desktopGateway';
import { desktopGatewayProfileURLHasEmbeddedCredentials } from '../shared/desktopGateway';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';

const GATEWAY_PROTOCOL_VERSION = 'redeven-gateway-v2';
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
  kind: 'url' | 'ssh_host' | 'ssh_container';
  url?: string;
  origin_label?: string;
  ssh_destination?: string;
  ssh_port?: number;
  auth_mode?: 'key_agent' | 'password';
  ssh_runtime_root?: string;
  container_engine?: string;
  container_id?: string;
  container_runtime_root?: string;
}>;

export type GatewayEnvProfileUpsertRequest = Readonly<{
  gateway_env_id?: string;
  display_name: string;
  access_route: GatewayEnvProfileAccessRoute;
  ssh_secret?: Readonly<{
    mode: 'keep' | 'replace' | 'clear';
    password?: string;
  }>;
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

export type GatewayRuntimeOperationKind = 'start' | 'stop' | 'restart' | 'update_runtime' | 'reconcile';
export type GatewayRuntimeArtifactPolicy = 'published_release' | 'custom_build';
export type GatewayRuntimeOperationState =
  | 'preflighting'
  | 'awaiting_confirmation'
  | 'awaiting_artifact'
  | 'staging'
  | 'commit_ready'
  | 'confirmation_required'
  | 'fencing'
  | 'committing'
  | 'recovering'
  | 'manual_recovery_required'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type GatewayRuntimeOperationPrepareRequest = Readonly<{
  operation_id: string;
  authorized_client_key_id: string;
  gateway_env_id: string;
  lifecycle_target_id: string;
  target_generation: number;
  operation: GatewayRuntimeOperationKind;
  desired_runtime: Readonly<{
    version: string;
    platform: string;
    architecture: string;
    artifact_policy: GatewayRuntimeArtifactPolicy;
  }>;
  build_inputs?: unknown;
  idempotency_key: string;
  authorization_permit?: string;
}>;

export type GatewayRuntimeManagementCapabilityRequest = Readonly<{
  gateway_env_id: string;
}>;

export type GatewayRuntimeWorkloadSnapshot = Readonly<{
  runtime_binary_version?: string;
  snapshot_revision: number;
  process_inventory_digest: string;
  workload_identity_digest: string;
  workload_identities?: readonly string[];
  workload: Readonly<{
    knowledge: 'known' | 'unknown';
    affected_process_count?: number;
    active_session_count?: number;
    protected_workload_present: boolean;
  }>;
  observed_at_unix_ms: number;
}>;

export type GatewayRuntimeOperation = Readonly<{
  protocol_version: string;
  operation_id: string;
  idempotency_key: string;
  lifecycle_target_id: string;
  target_generation: number;
  gateway_env_id: string;
  kind: GatewayRuntimeOperationKind;
  authorized_client_key_id: string;
  desired_runtime: GatewayRuntimeOperationPrepareRequest['desired_runtime'];
  state: GatewayRuntimeOperationState;
  expected_snapshot: GatewayRuntimeWorkloadSnapshot;
  expires_at_unix_ms?: number;
  maximum_expires_at_unix_ms?: number;
  confirmed_risk_summary_digest?: string;
  artifact?: Readonly<{
    size_bytes: number;
    archive_sha256: string;
    executable_sha256: string;
    manifest_sha256: string;
    policy: GatewayRuntimeArtifactPolicy;
  }>;
  failure?: Readonly<{ code: string; message: string; retryable?: boolean }>;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  observer_redacted?: boolean;
}>;

export type GatewayRuntimeOperationPrepareResponse = Readonly<{
  protocol_version: string;
  operation: GatewayRuntimeOperation;
  confirmation_required: boolean;
  artifact_max_bytes: number;
}>;

export type GatewayRuntimeOperationListRequest = Readonly<{
  gateway_env_id: string;
  lifecycle_target_id: string;
  target_generation: number;
}>;

export type GatewayRuntimeOperationListResponse = Readonly<{
  protocol_version: 'redeven-gateway-v2';
  operations: readonly GatewayRuntimeOperation[];
}>;

export type GatewayRuntimeOperationConfirmationRequest = Readonly<{
  snapshot_revision: number;
  process_inventory_digest: string;
  workload_identity_digest: string;
  risk_summary_digest: string;
}>;

export type GatewayRuntimeOperationReconcileRequest = Readonly<{
  authorization_permit?: string;
}>;

export type GatewayRuntimeArtifactMetadata = Readonly<{
  size_bytes: number;
  archive_sha256: string;
  executable_sha256: string;
  manifest: unknown;
  manifest_signature?: string;
  manifest_certificate?: string;
  build_attestation?: unknown;
}>;

export type GatewayRuntimeOperationEventsResponse = Readonly<{
  protocol_version: string;
  operation_id: string;
  events: readonly Readonly<{
    sequence: number;
    operation_id: string;
    lifecycle_target_id: string;
    target_generation: number;
    operation: GatewayRuntimeOperationKind;
    state: GatewayRuntimeOperationState;
    reason_code?: string;
    timestamp_unix_ms: number;
  }>[];
}>;

export type GatewayConnectArtifact = Readonly<{
  kind: 'local_direct_artifact' | 'desktop_bridge_artifact';
  url?: string;
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
  | 'gateway/v2/pairing/challenge'
  | 'gateway/v2/pairing/complete'
  | 'gateway/v2/catalog'
  | 'gateway/v2/open-session'
  | 'gateway/v2/env-profiles/upsert'
  | 'gateway/v2/env-profiles/delete'
  | 'gateway/v2/runtime-management/capability'
  | 'gateway/v2/runtime-operations/prepare'
  | 'gateway/v2/runtime-operations/list'
  | 'gateway/v2/runtime-operations/{operation_id}'
  | 'gateway/v2/runtime-operations/{operation_id}/confirm'
  | 'gateway/v2/runtime-operations/{operation_id}/artifact'
  | 'gateway/v2/runtime-operations/{operation_id}/commit'
  | 'gateway/v2/runtime-operations/{operation_id}/cancel'
  | 'gateway/v2/runtime-operations/{operation_id}/renew-deadline'
  | 'gateway/v2/runtime-operations/{operation_id}/reconcile'
  | 'gateway/v2/runtime-operations/{operation_id}/events';

type GatewayRoute = Exclude<GatewayRouteTemplate, `gateway/v2/runtime-operations/{operation_id}${string}`>
  | `gateway/v2/runtime-operations/${string}`;

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
    return redactedDetail.slice(0, 240);
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

function responseStatusCode(raw: string): number {
  const match = /^HTTP\/1\.[01]\s+(\d{3})\b/u.exec(raw);
  const statusCode = Number(match?.[1]);
  return Number.isInteger(statusCode) ? statusCode : 500;
}

function responseBody(raw: string): string {
  const splitAt = raw.indexOf('\r\n\r\n');
  if (splitAt < 0) {
    return raw;
  }
  const header = raw.slice(0, splitAt).toLowerCase();
  const body = raw.slice(splitAt + 4);
  if (!/\r\ntransfer-encoding:\s*chunked\b/u.test(header)) {
    return body;
  }
  return decodeChunkedResponseBody(body);
}

function decodeChunkedResponseBody(body: string): string {
  let offset = 0;
  let decoded = '';
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset);
    if (lineEnd < 0) {
      return body;
    }
    const sizeText = body.slice(offset, lineEnd).split(';', 1)[0]?.trim() ?? '';
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) {
      return body;
    }
    offset = lineEnd + 2;
    if (size === 0) {
      return decoded;
    }
    decoded += body.slice(offset, offset + size);
    offset += size + 2;
  }
  return decoded;
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
  route: Extract<GatewayRoute, 'gateway/v2/pairing/challenge' | 'gateway/v2/pairing/complete'>,
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

function requestGatewayBridgeJSON(
  bridge: RuntimePlacementBridgeSessionHandle,
  record: GatewayRecord,
  route: GatewayRoute,
  body: unknown | undefined,
  options: GatewayTransportCallOptions,
  method: GatewayHTTPMethod = 'POST',
): Promise<GatewayHTTPDataResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let raw = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stream: ReturnType<RuntimePlacementBridgeSessionHandle['openStream']> | null = null;
    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const closeStream = () => {
      void stream?.close().catch(() => undefined);
    };
    const onAbort = () => {
      settle(() => {
        closeStream();
        reject(abortError());
      });
    };
    try {
      throwIfCanceled(options.signal);
      stream = bridge.openStream('gateway_protocol');
    } catch (error) {
      reject(error instanceof GatewayClientError
        ? error
        : new GatewayClientError('GATEWAY_BRIDGE_UNAVAILABLE', error instanceof Error ? error.message : 'Gateway bridge is unavailable.', null, true));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      settle(() => {
        closeStream();
        reject(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway request timed out.', null, true));
      });
    }, gatewayTimeoutMs(options.timeoutMs));
    stream.onData((chunk) => {
      raw += chunk.toString('utf8');
    });
    stream.onClose(() => {
      settle(() => {
        try {
          resolve({
            data: parseGatewayHTTPResponse(responseBody(raw), responseStatusCode(raw)),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    stream.onError((error) => {
      settle(() => {
        reject(new GatewayClientError('GATEWAY_BRIDGE_FAILED', error.message || 'Gateway bridge stream failed.', null, true));
      });
    });
    void (async () => {
      try {
        const authHeaders = options.authenticated === false
          ? {}
          : await createGatewayAuthHeaders({
              record,
              method,
              route: `/${route}`,
              body,
              secret_store: options.secretStore,
            });
        const payload = body == null ? '' : JSON.stringify(body);
        const request = [
          `${method} /${route} HTTP/1.1`,
          'Host: redeven-gateway.local',
          'Accept: application/json',
          'X-Redeven-Gateway-Transport: desktop_bridge',
          ...Object.entries(authHeaders).map(([key, value]) => `${key}: ${value}`),
          ...(payload ? [`Content-Length: ${Buffer.byteLength(payload, 'utf8')}`] : []),
          'Connection: close',
          '',
          payload,
        ].join('\r\n');
        await stream!.write(Buffer.from(request, 'utf8'));
      } catch (error) {
        settle(() => {
          closeStream();
          reject(error instanceof GatewayClientError ? error : new GatewayClientError(
            'GATEWAY_BRIDGE_WRITE_FAILED',
            error instanceof Error ? error.message : 'Gateway bridge request failed.',
            null,
            true,
          ));
        });
      }
    })();
  });
}

function runtimeOperationRoute(
  operationID: string,
  suffix: '' | '/confirm' | '/artifact' | '/commit' | '/cancel' | '/renew-deadline' | '/reconcile' | '/events' = '',
): GatewayRoute {
  const normalized = compact(operationID);
  if (!normalized) {
    throw new GatewayClientError('GATEWAY_RUNTIME_OPERATION_ID_REQUIRED', 'Runtime operation ID is required.');
  }
  return `gateway/v2/runtime-operations/${encodeURIComponent(normalized)}${suffix}`;
}

function runtimeArtifactMetadataHeader(metadata: GatewayRuntimeArtifactMetadata): string {
  return Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url');
}

function requestGatewayURLArtifact(
  record: GatewayRecord,
  route: GatewayRoute,
  metadata: GatewayRuntimeArtifactMetadata,
  artifact: Buffer,
  options: GatewayTransportCallOptions,
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
  const requestImpl = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    void createGatewayAuthHeaders({
      record,
      method: 'PUT',
      route: `/${route}`,
      body: metadata,
      secret_store: options.secretStore,
    }).then((authHeaders) => {
      const req = requestImpl(url, {
        method: 'PUT',
        timeout: gatewayTimeoutMs(options.timeoutMs),
        headers: {
          Accept: 'application/json',
          ...authHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Length': artifact.length,
          'X-Redeven-Runtime-Artifact-Metadata': runtimeArtifactMetadataHeader(metadata),
        },
      }, (response) => {
        response.setEncoding('utf8');
        let raw = '';
        response.on('data', (chunk: string) => { raw += chunk; });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 500;
          try {
            resolve({ data: parseGatewayHTTPResponse(raw, statusCode) });
          } catch (error) {
            reject(error);
          }
        });
      });
      const onAbort = () => req.destroy(abortError());
      options.signal?.addEventListener('abort', onAbort, { once: true });
      req.on('timeout', () => req.destroy(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway artifact upload timed out.', null, true)));
      req.on('error', (error) => {
        reject(error instanceof GatewayClientError
          ? error
          : new GatewayClientError('GATEWAY_UNREACHABLE', error.message || 'Desktop could not upload the Runtime artifact.', null, true));
      });
      req.on('close', () => options.signal?.removeEventListener('abort', onAbort));
      req.end(artifact);
    }).catch(reject);
  });
}

function requestGatewayBridgeArtifact(
  bridge: RuntimePlacementBridgeSessionHandle,
  record: GatewayRecord,
  route: GatewayRoute,
  metadata: GatewayRuntimeArtifactMetadata,
  artifact: Buffer,
  options: GatewayTransportCallOptions,
): Promise<GatewayHTTPDataResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let raw = '';
    let stream: ReturnType<RuntimePlacementBridgeSessionHandle['openStream']> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const closeStream = () => { void stream?.close().catch(() => undefined); };
    const onAbort = () => settle(() => { closeStream(); reject(abortError()); });
    try {
      throwIfCanceled(options.signal);
      stream = bridge.openStream('gateway_protocol');
    } catch (error) {
      reject(new GatewayClientError('GATEWAY_BRIDGE_UNAVAILABLE', error instanceof Error ? error.message : 'Gateway bridge is unavailable.', null, true));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => settle(() => {
      closeStream();
      reject(new GatewayClientError('GATEWAY_TIMEOUT', 'Gateway artifact upload timed out.', null, true));
    }), gatewayTimeoutMs(options.timeoutMs));
    stream.onData((chunk) => { raw += chunk.toString('utf8'); });
    stream.onClose(() => settle(() => {
      try {
        resolve({ data: parseGatewayHTTPResponse(responseBody(raw), responseStatusCode(raw)) });
      } catch (error) {
        reject(error);
      }
    }));
    stream.onError((error) => settle(() => reject(new GatewayClientError('GATEWAY_BRIDGE_FAILED', error.message, null, true))));
    void (async () => {
      try {
        const authHeaders = await createGatewayAuthHeaders({
          record,
          method: 'PUT',
          route: `/${route}`,
          body: metadata,
          secret_store: options.secretStore,
        });
        const header = [
          `PUT /${route} HTTP/1.1`,
          'Host: redeven-gateway.local',
          'Accept: application/json',
          'X-Redeven-Gateway-Transport: desktop_bridge',
          ...Object.entries(authHeaders)
            .filter(([key]) => key.toLowerCase() !== 'content-type')
            .map(([key, value]) => `${key}: ${value}`),
          'Content-Type: application/octet-stream',
          `Content-Length: ${artifact.length}`,
          `X-Redeven-Runtime-Artifact-Metadata: ${runtimeArtifactMetadataHeader(metadata)}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n');
        await stream!.write(Buffer.concat([Buffer.from(header, 'utf8'), artifact]));
      } catch (error) {
        settle(() => {
          closeStream();
          reject(error instanceof GatewayClientError ? error : new GatewayClientError(
            'GATEWAY_BRIDGE_WRITE_FAILED',
            error instanceof Error ? error.message : 'Gateway artifact upload failed.',
            null,
            true,
          ));
        });
      }
    })();
  });
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
    case 'start':
    case 'stop':
    case 'restart':
    case 'update_runtime':
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
    case 'env_open_session':
    case 'env_profile_write':
    case 'env_lifecycle':
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
  switch (compact(value)) {
    case 'url':
    case 'ssh_host':
    case 'ssh_container':
      return compact(value) as DesktopGatewayEnvironmentProfileAccessRoute['kind'];
    default:
      return null;
  }
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
    ...(compact(candidate.ssh_destination) ? { ssh_destination: compact(candidate.ssh_destination) } : {}),
    ...(Number.isFinite(Number(candidate.ssh_port)) && Number(candidate.ssh_port) > 0
      ? { ssh_port: Math.floor(Number(candidate.ssh_port)) }
      : {}),
    ...(compact(candidate.auth_mode) === 'password' ? { auth_mode: 'password' } : {}),
    ...((candidate as { ssh_password_configured?: unknown }).ssh_password_configured === true ? { ssh_password_configured: true } : {}),
    ...(compact(candidate.ssh_runtime_root) ? { ssh_runtime_root: compact(candidate.ssh_runtime_root) } : {}),
    ...(compact(candidate.container_engine) ? { container_engine: compact(candidate.container_engine) } : {}),
    ...(compact(candidate.container_id) ? { container_id: compact(candidate.container_id) } : {}),
    ...(compact(candidate.container_runtime_root) ? { container_runtime_root: compact(candidate.container_runtime_root) } : {}),
  };
  if (route.kind === 'url' && (!route.url || desktopGatewayProfileURLHasEmbeddedCredentials(route.url))) {
    return undefined;
  }
  if ((route.kind === 'ssh_host' || route.kind === 'ssh_container') && !route.ssh_destination) {
    return undefined;
  }
  if (route.kind === 'ssh_container' && !route.container_id) {
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
  return {
    managed: true,
    access_route_kind: kind,
  };
}

export function normalizeGatewayRuntimeManagementCapability(value: unknown): DesktopGatewayEnvironment['runtime_management'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const authorizationValue = candidate.authorization && typeof candidate.authorization === 'object'
    ? candidate.authorization as Record<string, unknown>
    : {};
  const support = compact(candidate.support);
  const authorization = compact(authorizationValue.state);
  const readiness = compact(candidate.readiness);
  if (
    (support !== 'supported' && support !== 'unsupported' && support !== 'unknown')
    || (authorization !== 'allowed' && authorization !== 'denied' && authorization !== 'unknown')
    || (readiness !== 'ready' && readiness !== 'setup_required' && readiness !== 'temporarily_unavailable' && readiness !== 'unknown')
  ) {
    return undefined;
  }
  const presentationState = support === 'unsupported'
    ? 'unsupported'
    : support === 'unknown'
      ? 'unknown'
      : authorization === 'denied'
        ? 'denied'
        : authorization === 'unknown'
          ? 'unknown'
          : readiness === 'ready'
            ? 'allowed'
            : readiness;
  const targetValue = candidate.target && typeof candidate.target === 'object'
    ? candidate.target as Record<string, unknown>
    : null;
  const targetID = compact(targetValue?.lifecycle_target_id);
  const targetGeneration = Number(targetValue?.target_generation);
  const grants = Array.isArray(authorizationValue.grants)
    ? authorizationValue.grants.map(compact).filter((grant): grant is 'manage_runtime' | 'deploy_custom_runtime' | 'manage_runtime_binding' => (
      grant === 'manage_runtime' || grant === 'deploy_custom_runtime' || grant === 'manage_runtime_binding'
    ))
    : [];
  const operations = Array.isArray(candidate.operations)
    ? candidate.operations.map((operation) => {
      try { return normalizeGatewayRuntimeOperationKind(operation); } catch { return null; }
    }).filter((operation): operation is GatewayRuntimeOperationKind => operation !== null)
    : [];
  const artifactPolicies = Array.isArray(candidate.artifact_policies)
    ? candidate.artifact_policies.map(compact).filter((policy): policy is GatewayRuntimeArtifactPolicy => policy === 'published_release' || policy === 'custom_build')
    : [];
  const compatibilityCandidate = candidate.compatibility && typeof candidate.compatibility === 'object'
    ? candidate.compatibility as Record<string, unknown>
    : null;
  const runtimePlatform = compact(compatibilityCandidate?.runtime_platform);
  const runtimeArchitecture = compact(compatibilityCandidate?.runtime_architecture);
  const compatibilityEpoch = Number(compatibilityCandidate?.compatibility_epoch);
  const compatibility = authorization === 'allowed' && compatibilityCandidate
    && (runtimePlatform === 'linux' || runtimePlatform === 'darwin')
    && (runtimeArchitecture === 'amd64' || runtimeArchitecture === 'arm64')
    && compact(compatibilityCandidate.gateway_protocol) !== ''
    && compact(compatibilityCandidate.runtime_service_protocol) !== ''
    && Number.isSafeInteger(compatibilityEpoch) && compatibilityEpoch > 0
    ? {
        ...(compact(compatibilityCandidate.gateway_version) ? { gateway_version: compact(compatibilityCandidate.gateway_version) } : {}),
        gateway_protocol: compact(compatibilityCandidate.gateway_protocol),
        ...(compact(compatibilityCandidate.runtime_binary_version) ? { runtime_binary_version: compact(compatibilityCandidate.runtime_binary_version) } : {}),
        runtime_platform: runtimePlatform,
        runtime_architecture: runtimeArchitecture,
        runtime_service_protocol: compact(compatibilityCandidate.runtime_service_protocol),
        compatibility_epoch: compatibilityEpoch,
        capabilities: Array.isArray(compatibilityCandidate.capabilities)
          ? [...new Set(compatibilityCandidate.capabilities.map(compact).filter(Boolean))].sort()
          : [],
        ...(compact(compatibilityCandidate.runtime_artifact_sha256) ? { runtime_artifact_sha256: compact(compatibilityCandidate.runtime_artifact_sha256) } : {}),
      } as const
    : undefined;
  const authorized = support === 'supported' && authorization === 'allowed';
  const executableReady = authorized && readiness === 'ready';
  const visibleGrants = authorized ? grants : [];
  return {
    support,
    authorization: {
      state: authorization,
      ...(visibleGrants.length > 0 ? { grants: [...new Set(visibleGrants)] } : {}),
    },
    readiness,
    presentation_state: presentationState,
    ...(executableReady && targetID && Number.isSafeInteger(targetGeneration) && targetGeneration > 0
      ? { target: { lifecycle_target_id: targetID, target_generation: targetGeneration } }
      : {}),
    ...(executableReady && compatibility ? { compatibility } : {}),
    ...(executableReady && operations.length > 0 ? { operations: [...new Set(operations)] } : {}),
    ...(executableReady && artifactPolicies.length > 0 ? { artifact_policies: [...new Set(artifactPolicies)] } : {}),
    ...(authorized && readiness === 'setup_required' && Array.isArray(candidate.binding_actions)
      ? { binding_actions: [...new Set(candidate.binding_actions.map(compact).filter(Boolean))] }
      : {}),
    ...(executableReady && compact(candidate.supervision_mode) ? { supervision_mode: compact(candidate.supervision_mode) } : {}),
    ...(compact(candidate.reason_code) ? { reason_code: compact(candidate.reason_code) } : {}),
    checked_at_unix_ms: Number.isSafeInteger(Number(candidate.checked_at_unix_ms)) ? Number(candidate.checked_at_unix_ms) : 0,
  };
}

function requireGatewayRuntimeManagementCapability(value: unknown): DesktopGatewayRuntimeManagementCapability {
  const capability = normalizeGatewayRuntimeManagementCapability(value);
  if (!capability) {
    throw new GatewayClientError('GATEWAY_RUNTIME_CAPABILITY_INVALID', 'Gateway Runtime management capability response is invalid.');
  }
  return capability;
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
  const controlCapabilities = Array.isArray(candidate.control_capabilities)
    ? candidate.control_capabilities.map(normalizeEnvironmentCapability).filter((item): item is DesktopGatewayEnvironmentCapability => !!item)
    : [];
  const normalizedAccessCapabilities = [...new Set(accessCapabilities)];
  const normalizedControlCapabilities = [...new Set(controlCapabilities)];
  const profileAccessRoute = normalizeGatewayEnvironmentProfileAccessRoute(candidate.profile_access_route);
  const profile = normalizeGatewayEnvironmentProfile(candidate.profile);
  const runtimeManagement = normalizeGatewayRuntimeManagementCapability(candidate.runtime_management);
  return {
    gateway_env_id: gatewayEnvID,
    display_name: compact(candidate.display_name) || gatewayEnvID,
    env_kind: compact(candidate.env_kind) === 'managed_local_env' ? 'managed_local_env' : 'reachable_env',
    state: normalizeEnvironmentState(candidate.state),
    capabilities: [...new Set([...normalizedAccessCapabilities, ...normalizedControlCapabilities])],
    access_capabilities: normalizedAccessCapabilities,
    control_capabilities: normalizedControlCapabilities,
    ...(profile ? { profile } : {}),
    ...(profileAccessRoute ? { profile_access_route: profileAccessRoute } : {}),
    ...(runtimeManagement ? { runtime_management: runtimeManagement } : {}),
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

function normalizeGatewayRuntimeOperationKind(value: unknown): GatewayRuntimeOperationKind {
  switch (compact(value)) {
    case 'start':
    case 'stop':
    case 'restart':
    case 'update_runtime':
    case 'reconcile':
      return compact(value) as GatewayRuntimeOperationKind;
    default:
      throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation kind is unsupported.');
  }
}

function normalizeGatewayRuntimeOperationState(value: unknown): GatewayRuntimeOperationState {
  switch (compact(value)) {
    case 'preflighting':
    case 'awaiting_confirmation':
    case 'awaiting_artifact':
    case 'staging':
    case 'commit_ready':
    case 'confirmation_required':
    case 'fencing':
    case 'committing':
    case 'recovering':
    case 'manual_recovery_required':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return compact(value) as GatewayRuntimeOperationState;
    default:
      throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation state is unsupported.');
  }
}

function finiteInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', `Gateway Runtime operation ${field} is invalid.`);
  }
  return number;
}

export function normalizeGatewayRuntimeOperation(value: unknown): GatewayRuntimeOperation {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const operationID = compact(candidate.operation_id);
  const gatewayEnvID = compact(candidate.gateway_env_id);
  const lifecycleTargetID = compact(candidate.lifecycle_target_id);
  const authorizedClientKeyID = compact(candidate.authorized_client_key_id);
  const observerRedacted = candidate.observer_redacted === true;
  const desired = candidate.desired_runtime && typeof candidate.desired_runtime === 'object'
    ? candidate.desired_runtime as Record<string, unknown>
    : {};
  const snapshot = candidate.expected_snapshot && typeof candidate.expected_snapshot === 'object'
    ? candidate.expected_snapshot as Record<string, unknown>
    : {};
  const workload = snapshot.workload && typeof snapshot.workload === 'object'
    ? snapshot.workload as Record<string, unknown>
    : {};
  if (!operationID || !gatewayEnvID || !lifecycleTargetID || (!observerRedacted && !authorizedClientKeyID)) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation identity is incomplete.');
  }
  const artifactPolicy = compact(desired.artifact_policy);
  if (artifactPolicy !== 'published_release' && artifactPolicy !== 'custom_build') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime artifact policy is unsupported.');
  }
  const knowledge = compact(workload.knowledge);
  if (knowledge !== 'known' && knowledge !== 'unknown') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime workload knowledge is invalid.');
  }
  const artifact = candidate.artifact && typeof candidate.artifact === 'object'
    ? candidate.artifact as Record<string, unknown>
    : null;
  const failure = candidate.failure && typeof candidate.failure === 'object'
    ? candidate.failure as Record<string, unknown>
    : null;
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    operation_id: operationID,
    idempotency_key: compact(candidate.idempotency_key),
    lifecycle_target_id: lifecycleTargetID,
    target_generation: finiteInteger(candidate.target_generation, 'target_generation'),
    gateway_env_id: gatewayEnvID,
    kind: normalizeGatewayRuntimeOperationKind(candidate.kind),
    authorized_client_key_id: authorizedClientKeyID,
    desired_runtime: {
      version: compact(desired.version),
      platform: compact(desired.platform),
      architecture: compact(desired.architecture),
      artifact_policy: artifactPolicy,
    },
    state: normalizeGatewayRuntimeOperationState(candidate.state),
    expected_snapshot: {
      ...(compact(snapshot.runtime_binary_version) ? { runtime_binary_version: compact(snapshot.runtime_binary_version) } : {}),
      snapshot_revision: finiteInteger(snapshot.snapshot_revision, 'snapshot_revision'),
      process_inventory_digest: compact(snapshot.process_inventory_digest),
      workload_identity_digest: compact(snapshot.workload_identity_digest),
      ...(Array.isArray(snapshot.workload_identities)
        ? { workload_identities: snapshot.workload_identities.map(compact).filter(Boolean) }
        : {}),
      workload: {
        knowledge,
        ...(Number.isSafeInteger(Number(workload.affected_process_count))
          ? { affected_process_count: Number(workload.affected_process_count) }
          : {}),
        ...(Number.isSafeInteger(Number(workload.active_session_count))
          ? { active_session_count: Number(workload.active_session_count) }
          : {}),
        protected_workload_present: workload.protected_workload_present === true,
      },
      observed_at_unix_ms: finiteInteger(snapshot.observed_at_unix_ms, 'observed_at_unix_ms'),
    },
    ...(Number.isSafeInteger(Number(candidate.expires_at_unix_ms)) ? { expires_at_unix_ms: Number(candidate.expires_at_unix_ms) } : {}),
    ...(Number.isSafeInteger(Number(candidate.maximum_expires_at_unix_ms)) ? { maximum_expires_at_unix_ms: Number(candidate.maximum_expires_at_unix_ms) } : {}),
    ...(compact(candidate.confirmed_risk_summary_digest) ? { confirmed_risk_summary_digest: compact(candidate.confirmed_risk_summary_digest) } : {}),
    ...(artifact ? {
      artifact: {
        size_bytes: finiteInteger(artifact.size_bytes, 'artifact.size_bytes'),
        archive_sha256: compact(artifact.archive_sha256),
        executable_sha256: compact(artifact.executable_sha256),
        manifest_sha256: compact(artifact.manifest_sha256),
        policy: compact(artifact.policy) as GatewayRuntimeArtifactPolicy,
      },
    } : {}),
    ...(failure ? {
      failure: {
        code: compact(failure.code),
        message: compact(failure.message),
        ...(failure.retryable === true ? { retryable: true } : {}),
      },
    } : {}),
    created_at_unix_ms: finiteInteger(candidate.created_at_unix_ms, 'created_at_unix_ms'),
    updated_at_unix_ms: finiteInteger(candidate.updated_at_unix_ms, 'updated_at_unix_ms'),
    ...(observerRedacted ? { observer_redacted: true } : {}),
  };
}

export function normalizeGatewayRuntimeOperationListResponse(value: unknown): GatewayRuntimeOperationListResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation list response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.operations)) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime operation list is invalid.');
  }
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    operations: candidate.operations.map(normalizeGatewayRuntimeOperation),
  };
}

export function normalizeGatewayRuntimeOperationPrepareResponse(value: unknown): GatewayRuntimeOperationPrepareResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime prepare response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    operation: normalizeGatewayRuntimeOperation(candidate.operation),
    confirmation_required: candidate.confirmation_required === true,
    artifact_max_bytes: finiteInteger(candidate.artifact_max_bytes, 'artifact_max_bytes'),
  };
}

export function normalizeGatewayRuntimeOperationEventsResponse(value: unknown): GatewayRuntimeOperationEventsResponse {
  if (!value || typeof value !== 'object') {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime events response is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const operationID = compact(candidate.operation_id);
  if (!operationID || !Array.isArray(candidate.events)) {
    throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway Runtime events response is incomplete.');
  }
  return {
    protocol_version: normalizeProtocolVersion(candidate.protocol_version),
    operation_id: operationID,
    events: candidate.events.map((value) => {
      const event = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      return {
        sequence: finiteInteger(event.sequence, 'event.sequence'),
        operation_id: compact(event.operation_id),
        lifecycle_target_id: compact(event.lifecycle_target_id),
        target_generation: finiteInteger(event.target_generation, 'event.target_generation'),
        operation: normalizeGatewayRuntimeOperationKind(event.operation),
        state: normalizeGatewayRuntimeOperationState(event.state),
        ...(compact(event.reason_code) ? { reason_code: compact(event.reason_code) } : {}),
        timestamp_unix_ms: finiteInteger(event.timestamp_unix_ms, 'event.timestamp_unix_ms'),
      };
    }),
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
  if (request.access_route.auth_mode === 'password') {
    throw new Error('Gateway profile SSH password auth is not supported.');
  }
  if (request.ssh_secret) {
    throw new Error('Gateway profile SSH secrets are not supported.');
  }
  const routeURL = normalizeGatewayProfileURL(request.access_route.url);
  return {
    protocol_version: GATEWAY_PROTOCOL_VERSION,
    profile: {
      ...(compact(request.gateway_env_id) ? { gateway_env_id: compact(request.gateway_env_id) } : {}),
      display_name: compact(request.display_name),
      access_route: {
        kind: request.access_route.kind,
        ...(routeURL ? { url: routeURL } : {}),
        ...(compact(request.access_route.origin_label) ? { origin_label: compact(request.access_route.origin_label) } : {}),
        ...(compact(request.access_route.ssh_destination) ? { ssh_destination: compact(request.access_route.ssh_destination) } : {}),
        ...(Number.isFinite(Number(request.access_route.ssh_port)) && Number(request.access_route.ssh_port) > 0
          ? { ssh_port: Math.floor(Number(request.access_route.ssh_port)) }
          : {}),
        ...(request.access_route.auth_mode === 'key_agent' ? { auth_mode: 'key_agent' } : {}),
        ...(compact(request.access_route.ssh_runtime_root) ? { ssh_runtime_root: compact(request.access_route.ssh_runtime_root) } : {}),
        ...(compact(request.access_route.container_engine) ? { container_engine: compact(request.access_route.container_engine) } : {}),
        ...(compact(request.access_route.container_id) ? { container_id: compact(request.access_route.container_id) } : {}),
        ...(compact(request.access_route.container_runtime_root) ? { container_runtime_root: compact(request.access_route.container_runtime_root) } : {}),
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
  if (kind === 'local_direct_artifact') {
    const url = compact(candidate.url);
    if (!url) {
      throw new GatewayClientError('GATEWAY_INVALID_ARTIFACT', 'Gateway direct artifact is missing its URL.');
    }
    const normalizedURL = assertLocalDirectArtifactURL(url);
    return {
      kind,
      url: normalizedURL,
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

export class GatewayURLClient {
  constructor(private readonly secretStore: GatewaySecretStore) {}

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v2/catalog', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const catalog = normalizeGatewayCatalogResponse(data.data);
    this.assertGatewayIdentity(record, catalog.gateway.gateway_id, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }

  async pairingChallenge(
    record: GatewayRecord,
    request: Readonly<{
      protocol_version: 'redeven-gateway-v2';
	      client_nonce: string;
	      client_public_key: string;
	      binding_audience: string;
	      pairing_code?: string;
	    }>,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingChallengeResponse> {
    const data = await requestGatewayPairingJSON(record, 'gateway/v2/pairing/challenge', request, options);
    return normalizePairingChallengeResponse(data);
  }

  async completePairing(
    record: GatewayRecord,
    request: GatewayPairingCompleteRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingCompleteResponse> {
    const data = await requestGatewayPairingJSON(record, 'gateway/v2/pairing/complete', request, options);
    return normalizePairingCompleteResponse(data);
  }

  async openSession(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayOpenSessionResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v2/open-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
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

  async upsertEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileUpsertRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileUpsertResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v2/env-profiles/upsert', gatewayEnvProfilePayload(request), {
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
    const data = await requestGatewayJSON(record, 'gateway/v2/env-profiles/delete', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileDeleteResponse(data.data);
  }

  async prepareRuntimeOperation(
    record: GatewayRecord,
    request: GatewayRuntimeOperationPrepareRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayRuntimeOperationPrepareResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v2/runtime-operations/prepare', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayRuntimeOperationPrepareResponse(data.data);
  }

  async listRuntimeOperations(record: GatewayRecord, request: GatewayRuntimeOperationListRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperationListResponse> {
    const data = await requestGatewayJSON(record, 'gateway/v2/runtime-operations/list', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperationListResponse(data.data);
  }

  async runtimeManagementCapability(
    record: GatewayRecord,
    request: GatewayRuntimeManagementCapabilityRequest,
    options: GatewayRequestOptions = {},
  ): Promise<DesktopGatewayRuntimeManagementCapability> {
    const data = await requestGatewayJSON(record, 'gateway/v2/runtime-management/capability', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return requireGatewayRuntimeManagementCapability(data.data);
  }

  async getRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID), undefined, {
      secretStore: this.secretStore, ...options,
    }, 'GET');
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async confirmRuntimeOperation(record: GatewayRecord, operationID: string, request: GatewayRuntimeOperationConfirmationRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/confirm'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async uploadRuntimeOperationArtifact(record: GatewayRecord, operationID: string, metadata: GatewayRuntimeArtifactMetadata, artifact: Buffer, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    if (metadata.size_bytes !== artifact.length) {
      throw new GatewayClientError('GATEWAY_RUNTIME_ARTIFACT_SIZE_MISMATCH', 'Runtime artifact size does not match its metadata.');
    }
    const data = await requestGatewayURLArtifact(record, runtimeOperationRoute(operationID, '/artifact'), metadata, artifact, {
      secretStore: this.secretStore, ...options,
    });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async commitRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/commit'), undefined, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async cancelRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/cancel'), undefined, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async renewRuntimeOperation(record: GatewayRecord, operationID: string, expiresAtUnixMS: number, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/renew-deadline'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      expires_at_unix_ms: Math.floor(expiresAtUnixMS),
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async reconcileRuntimeOperation(record: GatewayRecord, operationID: string, request: GatewayRuntimeOperationReconcileRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/reconcile'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async runtimeOperationEvents(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperationEventsResponse> {
    const data = await requestGatewayJSON(record, runtimeOperationRoute(operationID, '/events'), undefined, { secretStore: this.secretStore, ...options }, 'GET');
    return normalizeGatewayRuntimeOperationEventsResponse(data.data);
  }

  private assertGatewayIdentity(record: GatewayRecord, observedGatewayID: string, observedFingerprint: string | undefined): void {
    const profile: GatewayTrustProfile | undefined = record.trust_profile;
    if (record.gateway_id !== observedGatewayID) {
      throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'Gateway response does not match the saved Gateway.');
    }
    if (profile) {
      if (!observedFingerprint) {
        throw new GatewayClientError('GATEWAY_FINGERPRINT_REQUIRED', 'Gateway response did not include the pinned fingerprint.');
      }
      assertGatewayFingerprint(profile, observedFingerprint);
    }
  }
}

export class GatewayBridgeClient {
  constructor(
    private readonly secretStore: GatewaySecretStore,
    private readonly bridge: RuntimePlacementBridgeSessionHandle,
  ) {}

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/catalog', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const catalog = normalizeGatewayCatalogResponse(data.data);
    this.assertGatewayIdentity(record, catalog.gateway.gateway_id, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }

  async pairingChallenge(
    record: GatewayRecord,
    request: Readonly<{
      protocol_version: 'redeven-gateway-v2';
	      client_nonce: string;
	      client_public_key: string;
	      binding_audience: string;
	      pairing_code?: string;
	    }>,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayPairingChallengeResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/pairing/challenge', request, {
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
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/pairing/complete', request, {
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
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/open-session', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: request.gateway_env_id,
      requested_capability: request.requested_capability,
      client_nonce: request.client_nonce,
      bridge_session_id: request.bridge_session_id,
      route_id: request.route_id,
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

  async upsertEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileUpsertRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayEnvProfileUpsertResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/env-profiles/upsert', gatewayEnvProfilePayload(request), {
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
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/env-profiles/delete', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayEnvProfileDeleteResponse(data.data);
  }

  async prepareRuntimeOperation(
    record: GatewayRecord,
    request: GatewayRuntimeOperationPrepareRequest,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayRuntimeOperationPrepareResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/runtime-operations/prepare', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return normalizeGatewayRuntimeOperationPrepareResponse(data.data);
  }

  async listRuntimeOperations(record: GatewayRecord, request: GatewayRuntimeOperationListRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperationListResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/runtime-operations/list', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperationListResponse(data.data);
  }

  async runtimeManagementCapability(
    record: GatewayRecord,
    request: GatewayRuntimeManagementCapabilityRequest,
    options: GatewayRequestOptions = {},
  ): Promise<DesktopGatewayRuntimeManagementCapability> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, 'gateway/v2/runtime-management/capability', {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      gateway_env_id: compact(request.gateway_env_id),
    }, {
      secretStore: this.secretStore,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return requireGatewayRuntimeManagementCapability(data.data);
  }

  async getRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID), undefined, { secretStore: this.secretStore, ...options }, 'GET');
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async confirmRuntimeOperation(record: GatewayRecord, operationID: string, request: GatewayRuntimeOperationConfirmationRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/confirm'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async uploadRuntimeOperationArtifact(record: GatewayRecord, operationID: string, metadata: GatewayRuntimeArtifactMetadata, artifact: Buffer, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    if (metadata.size_bytes !== artifact.length) {
      throw new GatewayClientError('GATEWAY_RUNTIME_ARTIFACT_SIZE_MISMATCH', 'Runtime artifact size does not match its metadata.');
    }
    const data = await requestGatewayBridgeArtifact(this.bridge, record, runtimeOperationRoute(operationID, '/artifact'), metadata, artifact, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async commitRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/commit'), undefined, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async cancelRuntimeOperation(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/cancel'), undefined, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async renewRuntimeOperation(record: GatewayRecord, operationID: string, expiresAtUnixMS: number, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/renew-deadline'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      expires_at_unix_ms: Math.floor(expiresAtUnixMS),
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async reconcileRuntimeOperation(record: GatewayRecord, operationID: string, request: GatewayRuntimeOperationReconcileRequest, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperation> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/reconcile'), {
      protocol_version: GATEWAY_PROTOCOL_VERSION,
      ...request,
    }, { secretStore: this.secretStore, ...options });
    return normalizeGatewayRuntimeOperation(data.data);
  }

  async runtimeOperationEvents(record: GatewayRecord, operationID: string, options: GatewayRequestOptions = {}): Promise<GatewayRuntimeOperationEventsResponse> {
    const data = await requestGatewayBridgeJSON(this.bridge, record, runtimeOperationRoute(operationID, '/events'), undefined, { secretStore: this.secretStore, ...options }, 'GET');
    return normalizeGatewayRuntimeOperationEventsResponse(data.data);
  }

  private assertGatewayIdentity(record: GatewayRecord, observedGatewayID: string, observedFingerprint: string | undefined): void {
    const profile: GatewayTrustProfile | undefined = record.trust_profile;
    if (record.gateway_id !== observedGatewayID) {
      throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'Gateway response does not match the saved Gateway.');
    }
    if (profile) {
      if (!observedFingerprint) {
        throw new GatewayClientError('GATEWAY_FINGERPRINT_REQUIRED', 'Gateway response did not include the pinned fingerprint.');
      }
      assertGatewayFingerprint(profile, observedFingerprint);
    }
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
  return typeof value === 'string' ? value.slice(0, 240) : value;
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
