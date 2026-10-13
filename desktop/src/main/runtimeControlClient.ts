import {normalizeRuntimeCloudStatus, normalizeCloudRouteOperation, type RuntimeCloudOperation} from '../shared/runtimeCloud';
import { normalizeGatewayJoinPreview, type GatewayJoinPreview, type GatewayPreviewInput, type GatewayMembershipStatus, type GatewayMembershipOperation } from '../shared/gatewayJoin';
import { parseSecurityResult, type SecurityRequest, type SecurityResult } from '../shared/runtimeSecurity';
import http from 'node:http';
import https from 'node:https';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import { parseLocalUIProtocol, type DesktopSettingsDraft } from '../shared/settingsIPC';
import {
  normalizeRuntimeServiceSnapshot,
  type RuntimeServiceCloudLinkBinding,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export class RuntimeControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = 'RuntimeControlError';
  }
}

type RuntimeControlEnvelope = Readonly<{
  ok?: boolean;
  data?: unknown;
  error?: Readonly<{
    code?: unknown;
    message?: unknown;
  }>;
}>;

type RuntimeControlServiceRoute =
  | 'v2/cloud/retry' | 'v2/cloud/route/preflight' | 'v2/cloud/route/commit' | `v2/cloud/route/operations/${string}`
  | 'v2/gateway/preview'
  | 'v2/gateway/join'
  | 'v2/gateway/replace'
  | 'v2/gateway/update-endpoints'
  | 'v2/gateway/status'
  | 'v2/gateway/retry'
  | 'v2/gateway/leave' | 'v2/gateway/publish'
  | 'v2/tessiven/host'
  | 'v2/tessiven/preflight'
  | 'v2/tessiven/resources'
	| 'v2/cloud-link'
	| 'v2/cloud-link/connect'
	| 'v2/cloud-link/disconnect'
	| 'v2/code-workspace-engine/status'
  | 'v2/runtime/access'
  | 'v2/runtime/security';

export type RuntimeAccessSettings = Readonly<{
  local_ui_bind: string;
  local_ui_protocol?: 'http' | 'https';
  local_ui_password_configured: boolean;
  restart_required?: boolean;
  runtime_started_at_unix_ms?: number;
}>;

export function parseRuntimeAccessSettings(data: unknown): RuntimeAccessSettings {
  const value = data as Partial<RuntimeAccessSettings> | null;
  if (!value || typeof value.local_ui_bind !== 'string' || typeof value.local_ui_password_configured !== 'boolean') {
    throw new RuntimeControlError('RUNTIME_ACCESS_INVALID_RESPONSE', 'Runtime did not return its access settings.');
  }
  return {
    local_ui_bind: value.local_ui_bind,
    local_ui_protocol: parseLocalUIProtocol(value.local_ui_protocol),
    local_ui_password_configured: value.local_ui_password_configured,
    ...(typeof value.restart_required === 'boolean' ? { restart_required: value.restart_required } : {}),
    ...(typeof value.runtime_started_at_unix_ms === 'number' ? { runtime_started_at_unix_ms: value.runtime_started_at_unix_ms } : {}),
  };
}

export async function getRuntimeAccessSettings(endpoint: DesktopRuntimeControlEndpoint): Promise<RuntimeAccessSettings> {
  return parseRuntimeAccessSettings((await requestRuntimeControl(endpoint, 'v2/runtime/access', { method: 'GET' })).data);
}

export async function saveRuntimeAccessSettings(endpoint: DesktopRuntimeControlEndpoint, draft: DesktopSettingsDraft): Promise<RuntimeAccessSettings> {
  return parseRuntimeAccessSettings((await requestRuntimeControl(endpoint, 'v2/runtime/access', {
    method: 'PUT',
    body: {
      local_ui_bind: draft.local_ui_bind,
      local_ui_protocol: parseLocalUIProtocol(draft.local_ui_protocol),
      local_ui_password_mode: draft.local_ui_password_mode,
      local_ui_password: draft.local_ui_password,
    },
  })).data);
}

export type RuntimeControlCloudLinkStatus = Readonly<{
  linked?: boolean;
  binding: RuntimeServiceCloudLinkBinding;
  runtime_service: RuntimeServiceSnapshot;
}>;

export type RuntimeControlCloudLinkRequest = Readonly<{
  cloud_origin: string;
  cloud_id: string;
  env_public_id: string;
	runtime_link_ticket: string;
  allow_relink_when_idle?: boolean;
  renew_current_binding?: boolean;
  expected_current_binding?: Readonly<{
    cloud_origin?: string;
    cloud_id?: string;
    env_public_id?: string;
    access_point_origin?: string;
    binding_generation?: number;
  }>;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeControlBodySummary(raw: string): string {
  return compact(raw).replace(/\s+/gu, ' ').slice(0, 160);
}

function parseRuntimeControlEnvelope(raw: string): RuntimeControlEnvelope | null {
  try {
    return JSON.parse(raw || '{}') as RuntimeControlEnvelope;
  } catch {
    return null;
  }
}

export function runtimeControlServiceURL(
  endpoint: DesktopRuntimeControlEndpoint,
  route: RuntimeControlServiceRoute,
): URL {
  const baseURL = compact(endpoint.base_url);
  if (!baseURL) {
    throw new RuntimeControlError('RUNTIME_CONTROL_UNAVAILABLE', 'Runtime control endpoint is incomplete.');
  }
  if (route.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(route)) {
    throw new RuntimeControlError('RUNTIME_CONTROL_INVALID_ROUTE', 'Runtime control route must be relative to the service root.');
  }
  let root: URL;
  try {
    root = new URL(baseURL);
  } catch {
    throw new RuntimeControlError('RUNTIME_CONTROL_INVALID_ENDPOINT', 'Runtime control endpoint URL is invalid.');
  }
  if (root.protocol !== 'http:' && root.protocol !== 'https:') {
    throw new RuntimeControlError('RUNTIME_CONTROL_INVALID_ENDPOINT', 'Runtime control endpoint must use HTTP or HTTPS.');
  }
  if (!root.pathname.endsWith('/')) {
    root.pathname = `${root.pathname}/`;
  }
  return new URL(route, root);
}

function requestRuntimeControl(
  endpoint: DesktopRuntimeControlEndpoint,
  route: RuntimeControlServiceRoute,
  options: Readonly<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    rawBody?: Buffer;
    contentType?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }>,
): Promise<RuntimeControlEnvelope> {
  const baseURL = compact(endpoint.base_url);
  const token = compact(endpoint.token);
	if (!baseURL || !token) {
    return Promise.reject(new RuntimeControlError('RUNTIME_CONTROL_UNAVAILABLE', 'Runtime control endpoint is incomplete.'));
  }

  let url: URL;
  try {
    url = runtimeControlServiceURL(endpoint, route);
  } catch (error) {
    return Promise.reject(error);
  }
  const body = options.rawBody ?? (options.body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(options.body), 'utf8'));
  const requestImpl = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new RuntimeControlError('RUNTIME_CONTROL_CANCELED', 'Runtime control request was canceled.'));
      return;
    }
    const req = requestImpl(url, {
      method: options.method,
      // Placement proxy sockets bind one surface. The shared agent may hold a
      // Local UI socket at this same origin; each control request needs its own.
      agent: false,
      timeout: Math.max(1, Math.floor(options.timeoutMs ?? 20_000)),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body.length > 0 ? {
          'Content-Type': options.contentType ?? (options.rawBody ? 'application/octet-stream' : 'application/json'),
          'Content-Length': body.length,
        } : {}),
      },
    }, (response) => {
      response.setEncoding('utf8');
      let raw = '';
      response.on('data', (chunk: string) => {
        raw += chunk;
      });
      response.on('end', () => {
        const statusCode = response.statusCode ?? 500;
        const parsed = parseRuntimeControlEnvelope(raw);
        if (!parsed) {
          if (statusCode >= 400) {
            const summary = runtimeControlBodySummary(raw);
            reject(new RuntimeControlError(
              'RUNTIME_CONTROL_HTTP_ERROR',
              `Runtime control returned HTTP ${statusCode}${summary ? `: ${summary}` : '.'}`,
              statusCode,
            ));
            return;
          }
          reject(new RuntimeControlError(
            'RUNTIME_CONTROL_INVALID_RESPONSE',
            'Runtime control returned a non-JSON response.',
            statusCode,
          ));
          return;
        }
        if (parsed.ok === false || statusCode >= 400) {
          const code = compact(parsed.error?.code) || 'RUNTIME_CONTROL_FAILED';
          const message = compact(parsed.error?.message) || `Runtime control failed with status ${statusCode}.`;
          reject(new RuntimeControlError(code, message, statusCode));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => {
      req.destroy(new RuntimeControlError('RUNTIME_CONTROL_TIMEOUT', 'Runtime control request timed out.'));
    });
    req.on('error', (error) => {
      reject(error instanceof RuntimeControlError
        ? error
        : new RuntimeControlError('RUNTIME_CONTROL_UNREACHABLE', error.message || 'Desktop could not reach Runtime control.'));
    });
    const abort = () => {
      req.destroy(new RuntimeControlError('RUNTIME_CONTROL_CANCELED', 'Runtime control request was canceled.'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    req.once('close', () => {
      options.signal?.removeEventListener('abort', abort);
    });
    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

function parseCloudLinkStatus(data: unknown): RuntimeControlCloudLinkStatus {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const runtimeService = normalizeRuntimeServiceSnapshot(record.runtime_service ?? {});
  const binding = runtimeService.bindings?.cloud_link;
  if (!binding) {
    throw new RuntimeControlError('CLOUD_LINK_INVALID_RESPONSE', 'Runtime control did not return cloud-link binding status.');
  }
  return {
    ...(typeof record.linked === 'boolean' ? { linked: record.linked } : {}),
    binding,
    runtime_service: runtimeService,
  };
}

export async function getCloudLinkStatus(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<RuntimeControlCloudLinkStatus> {
	const envelope = await requestRuntimeControl(endpoint, 'v2/cloud-link', { method: 'GET' });
  return parseCloudLinkStatus(envelope.data);
}

export async function connectCloudLink(
  endpoint: DesktopRuntimeControlEndpoint,
  request: RuntimeControlCloudLinkRequest,
): Promise<RuntimeControlCloudLinkStatus> {
	const envelope = await requestRuntimeControl(endpoint, 'v2/cloud-link/connect', {
    method: 'POST',
    body: request,
  });
  return parseCloudLinkStatus(envelope.data);
}

export async function disconnectCloudLink(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<RuntimeControlCloudLinkStatus> {
	const envelope = await requestRuntimeControl(endpoint, 'v2/cloud-link/disconnect', {
    method: 'POST',
  });
  return parseCloudLinkStatus(envelope.data);
}

export async function getCodeWorkspaceEngineStatus(
  endpoint: DesktopRuntimeControlEndpoint,
  signal?: AbortSignal,
): Promise<unknown> {
	const envelope = await requestRuntimeControl(endpoint, 'v2/code-workspace-engine/status', { method: 'GET', signal });
  return envelope.data;
}

export async function manageRuntimeSecurity(endpoint: DesktopRuntimeControlEndpoint, request: SecurityRequest): Promise<SecurityResult> {
 return parseSecurityResult((await requestRuntimeControl(endpoint, 'v2/runtime/security', { method: 'POST', body: request })).data);
}

export async function requestTessivenTarget(endpoint: DesktopRuntimeControlEndpoint, payload: unknown, signal?: AbortSignal): Promise<unknown> {
  return (await requestRuntimeControl(endpoint, 'v2/tessiven/resources', { method: 'POST', body: payload, signal, timeoutMs: 30000 })).data;
}

export async function manageRuntimeGateway(endpoint: DesktopRuntimeControlEndpoint, operation: GatewayMembershipOperation, previewID?: string, gatewayID?: string, routeImpactAcknowledged?: boolean): Promise<GatewayMembershipStatus> {
  const confirming = ['join','replace','update-endpoints'].includes(operation);
  if (confirming !== Boolean(previewID)) throw new RuntimeControlError('GATEWAY_JOIN_INVALID', 'Confirmation requires a verified preview.');
  const result = (await requestRuntimeControl(endpoint, `v2/gateway/${operation}`, {
    method: operation === 'status' ? 'GET' : 'POST',
    ...(operation === 'status' ? {} : {body: { ...(confirming ? {preview_id: previewID} : {}), ...(gatewayID ? {gateway_id: gatewayID} : {}), ...(routeImpactAcknowledged ? {route_impact_acknowledged: true} : {}) }}), timeoutMs: 30_000,
  })).data;
  function parse(value: unknown, child = false): GatewayMembershipStatus {
    const data = value as Record<string, unknown> | undefined;
    if (!data || !['not_joined','joining','gateway_offline','joined','reauthorization_required','removal_pending'].includes(String(data.phase)) || typeof data.joined !== 'boolean'
      || child && (typeof data.gateway_id !== 'string' || typeof data.member_id !== 'string' || data.memberships !== undefined)
      || data.memberships !== undefined && (!Array.isArray(data.memberships) || data.memberships.length > 16)) throw new RuntimeControlError('GATEWAY_JOIN_INVALID_RESPONSE','The Runtime did not return Gateway membership status.');
    return {joined: data.joined, phase: data.phase as GatewayMembershipStatus['phase'],
      ...Object.fromEntries(['gateway_id','gateway_name','last_endpoint_id','member_id','existing_environment_id'].filter(key => typeof data[key] === 'string').map(key => [key,data[key]])),
      ...(Array.isArray(data.endpoints) ? {endpoints: data.endpoints as GatewayMembershipStatus['endpoints']} : {}),
      ...(typeof data.cloud_enrollment_required === 'boolean' ? {cloud_enrollment_required:data.cloud_enrollment_required} : {}),
      ...(typeof data.route_selected === 'boolean' ? {route_selected:data.route_selected} : {}),
      ...(Array.isArray(data.memberships) ? {memberships:data.memberships.map(item => parse(item,true))} : {}),
    };
  }
  return parse(result);
}

export async function previewRuntimeGateway(endpoint: DesktopRuntimeControlEndpoint, input: GatewayPreviewInput): Promise<GatewayJoinPreview> {
 const result = await requestRuntimeControl(endpoint, 'v2/gateway/preview', { method: 'POST', body: input, timeoutMs: 30_000 });
 const preview = normalizeGatewayJoinPreview(result.data);
 if (!preview || preview.purpose !== input.purpose) throw new RuntimeControlError('GATEWAY_PREVIEW_INVALID_RESPONSE', 'The Runtime did not return a valid Gateway preview.');
 return preview;
}

export async function preflightTessivenSource(endpoint: DesktopRuntimeControlEndpoint, source: string, scope: {user_public_id:string;floe_app:string}, permissions: {read:boolean;write:boolean;execute:boolean;admin:boolean}, effect: 'read'|'resource'|'connect'|'lifecycle', signal?: AbortSignal): Promise<void> {
  await requestRuntimeControl(endpoint, 'v2/tessiven/preflight', {method:'POST',body:{source,scope,permissions,effect},signal,timeoutMs:5000});
}

export async function manageRuntimeCloud(endpoint: DesktopRuntimeControlEndpoint, request: RuntimeCloudOperation) {
 const path: RuntimeControlServiceRoute = request.operation === 'query' || request.operation === 'cancel' ? `v2/cloud/route/operations/${request.operation_id}` : request.operation === 'retry' ? 'v2/cloud/retry' : `v2/cloud/route/${request.operation}`;
 const body = request.operation === 'preflight' ? {operation_id: request.operation_id, expected_route_revision: request.expected_route_revision, selection: request.selection} : request.operation === 'commit' ? {operation_id: request.operation_id, confirmed: true} : request.operation === 'retry' ? {expected_association_revision: request.expected_association_revision} : undefined;
 const response = await requestRuntimeControl(endpoint, path, {method: request.operation === 'query' ? 'GET' : request.operation === 'cancel' ? 'DELETE' : 'POST', ...(body ? {body} : {}), timeoutMs: 30000});
 if (request.operation === 'retry') {
 const cloud = normalizeRuntimeCloudStatus(response.data);
 if (!cloud) throw new RuntimeControlError('CLOUD_STATUS_INVALID_RESPONSE','Runtime returned an invalid Cloud status.');
 return {};
 }
 const operation = normalizeCloudRouteOperation(response.data);
 if (!operation) throw new RuntimeControlError('CLOUD_ROUTE_INVALID_RESPONSE', 'The Runtime returned an invalid route operation. Query the original operation before retrying.');
 return {cloud_route_operation: operation};
}
