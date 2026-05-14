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

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function requestRuntimeControl(
  endpoint: DesktopRuntimeControlEndpoint,
  path: string,
  options: Readonly<{
    method: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
  }>,
): Promise<RuntimeControlEnvelope> {
  const baseURL = compact(endpoint.base_url);
  const token = compact(endpoint.token);
  const desktopOwnerID = compact(endpoint.desktop_owner_id);
  if (!baseURL || !token || !desktopOwnerID) {
    return Promise.reject(new RuntimeControlError('RUNTIME_CONTROL_UNAVAILABLE', 'Runtime control endpoint is incomplete.'));
  }

  const url = new URL(path, baseURL);
  const body = options.body == null ? '' : JSON.stringify(options.body);
  const requestImpl = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const req = requestImpl(url, {
      method: options.method,
      timeout: Math.max(1, Math.floor(options.timeoutMs ?? 20_000)),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Redeven-Desktop-Owner-ID': desktopOwnerID,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      response.setEncoding('utf8');
      let raw = '';
      response.on('data', (chunk: string) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '{}') as RuntimeControlEnvelope;
          if (parsed.ok === false || (response.statusCode ?? 500) >= 400) {
            const code = compact(parsed.error?.code) || 'RUNTIME_CONTROL_FAILED';
            const message = compact(parsed.error?.message) || `Runtime control failed with status ${response.statusCode ?? 'unknown'}.`;
            reject(new RuntimeControlError(code, message, response.statusCode ?? null));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(new RuntimeControlError(
            'RUNTIME_CONTROL_INVALID_RESPONSE',
            error instanceof Error ? error.message : 'Runtime control returned invalid JSON.',
            response.statusCode ?? null,
          ));
        }
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
    if (body) {
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
  const envelope = await requestRuntimeControl(endpoint, '/v1/provider-link', { method: 'GET' });
  return parseProviderLinkStatus(envelope.data);
}

export async function connectProviderLink(
  endpoint: DesktopRuntimeControlEndpoint,
  request: RuntimeControlProviderLinkRequest,
): Promise<RuntimeControlProviderLinkStatus> {
  const envelope = await requestRuntimeControl(endpoint, '/v1/provider-link/connect', {
    method: 'POST',
    body: request,
  });
  return parseProviderLinkStatus(envelope.data);
}

export async function disconnectProviderLink(
  endpoint: DesktopRuntimeControlEndpoint,
): Promise<RuntimeControlProviderLinkStatus> {
  const envelope = await requestRuntimeControl(endpoint, '/v1/provider-link/disconnect', {
    method: 'POST',
  });
  return parseProviderLinkStatus(envelope.data);
}
