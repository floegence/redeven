import http from 'node:http';
import https from 'node:https';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import {
  normalizeRuntimeServiceSnapshot,
  type RuntimeServiceProviderLinkBinding,
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
  | 'v1/provider-link'
  | 'v1/provider-link/connect'
  | 'v1/provider-link/disconnect'
  | 'v1/code-workspace-engine/status'
  | 'v1/code-workspace-engine/import-sessions'
  | `v1/code-workspace-engine/import-sessions/${string}/chunks/${number}`
  | `v1/code-workspace-engine/import-sessions/${string}/complete`;

export type RuntimeControlProviderLinkStatus = Readonly<{
  linked?: boolean;
  binding: RuntimeServiceProviderLinkBinding;
  runtime_service: RuntimeServiceSnapshot;
}>;

export type RuntimeControlProviderLinkRequest = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  bootstrap_ticket: string;
  allow_relink_when_idle?: boolean;
  expected_current_binding?: Readonly<{
    provider_origin?: string;
    provider_id?: string;
    env_public_id?: string;
    binding_generation?: number;
  }>;
}>;

export type CodeWorkspaceEngineImportSessionRequest = Readonly<{
  manifest: unknown;
}>;

export type CodeWorkspaceEngineImportChunkResult = Readonly<{
  upload_id: string;
  received_bytes: number;
  expected_bytes: number;
  next_chunk_index: number;
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
    method: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    rawBody?: Buffer;
    contentType?: string;
    timeoutMs?: number;
  }>,
): Promise<RuntimeControlEnvelope> {
  const baseURL = compact(endpoint.base_url);
  const token = compact(endpoint.token);
  const desktopOwnerID = compact(endpoint.desktop_owner_id);
  if (!baseURL || !token || !desktopOwnerID) {
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
    const req = requestImpl(url, {
      method: options.method,
      timeout: Math.max(1, Math.floor(options.timeoutMs ?? 20_000)),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Redeven-Desktop-Owner-ID': desktopOwnerID,
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
    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

function parseProviderLinkStatus(data: unknown): RuntimeControlProviderLinkStatus {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const runtimeService = normalizeRuntimeServiceSnapshot(record.runtime_service ?? {});
  const binding = runtimeService.bindings?.provider_link;
  if (!binding) {
    throw new RuntimeControlError('PROVIDER_LINK_INVALID_RESPONSE', 'Runtime control did not return provider-link binding status.');
  }
  return {
    ...(typeof record.linked === 'boolean' ? { linked: record.linked } : {}),
    binding,
    runtime_service: runtimeService,
  };
}

export async function getProviderLinkStatus(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<RuntimeControlProviderLinkStatus> {
  const envelope = await requestRuntimeControl(endpoint, 'v1/provider-link', { method: 'GET' });
  return parseProviderLinkStatus(envelope.data);
}

export async function connectProviderLink(
  endpoint: DesktopRuntimeControlEndpoint,
  request: RuntimeControlProviderLinkRequest,
): Promise<RuntimeControlProviderLinkStatus> {
  const envelope = await requestRuntimeControl(endpoint, 'v1/provider-link/connect', {
    method: 'POST',
    body: request,
  });
  return parseProviderLinkStatus(envelope.data);
}

export async function disconnectProviderLink(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<RuntimeControlProviderLinkStatus> {
  const envelope = await requestRuntimeControl(endpoint, 'v1/provider-link/disconnect', {
    method: 'POST',
  });
  return parseProviderLinkStatus(envelope.data);
}

export async function getCodeWorkspaceEngineStatus(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<unknown> {
  const envelope = await requestRuntimeControl(endpoint, 'v1/code-workspace-engine/status', { method: 'GET' });
  return envelope.data;
}

export async function createCodeWorkspaceEngineImportSession(
  endpoint: DesktopRuntimeControlEndpoint,
  request: CodeWorkspaceEngineImportSessionRequest,
): Promise<unknown> {
  const envelope = await requestRuntimeControl(endpoint, 'v1/code-workspace-engine/import-sessions', {
    method: 'POST',
    body: request,
    timeoutMs: 60_000,
  });
  return envelope.data;
}

export async function appendCodeWorkspaceEngineImportChunk(
  endpoint: DesktopRuntimeControlEndpoint,
  uploadID: string,
  chunkIndex: number,
  chunk: Buffer,
): Promise<CodeWorkspaceEngineImportChunkResult> {
  const cleanUploadID = encodeURIComponent(compact(uploadID));
  const cleanChunkIndex = Math.max(0, Math.floor(chunkIndex));
  const envelope = await requestRuntimeControl(
    endpoint,
    `v1/code-workspace-engine/import-sessions/${cleanUploadID}/chunks/${cleanChunkIndex}`,
    {
      method: 'PUT',
      rawBody: chunk,
      contentType: 'application/octet-stream',
      timeoutMs: 120_000,
    },
  );
  return parseCodeWorkspaceEngineImportChunkResult(envelope.data);
}

export async function completeCodeWorkspaceEngineImportSession(
  endpoint: DesktopRuntimeControlEndpoint,
  uploadID: string,
): Promise<unknown> {
  const cleanUploadID = encodeURIComponent(compact(uploadID));
  const envelope = await requestRuntimeControl(
    endpoint,
    `v1/code-workspace-engine/import-sessions/${cleanUploadID}/complete`,
    {
      method: 'POST',
      timeoutMs: 120_000,
    },
  );
  return envelope.data;
}

function parseCodeWorkspaceEngineImportChunkResult(data: unknown): CodeWorkspaceEngineImportChunkResult {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const uploadID = compact(record.upload_id);
  const receivedBytes = Number(record.received_bytes);
  const expectedBytes = Number(record.expected_bytes);
  const nextChunkIndex = Number(record.next_chunk_index);
  if (!uploadID || !Number.isFinite(receivedBytes) || !Number.isFinite(expectedBytes) || !Number.isFinite(nextChunkIndex)) {
    throw new RuntimeControlError('CODE_WORKSPACE_ENGINE_INVALID_RESPONSE', 'Runtime control did not return a valid workspace engine chunk result.');
  }
  return {
    upload_id: uploadID,
    received_bytes: Math.max(0, Math.floor(receivedBytes)),
    expected_bytes: Math.max(0, Math.floor(expectedBytes)),
    next_chunk_index: Math.max(0, Math.floor(nextChunkIndex)),
  };
}
