import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import {
  type DesktopFlowerHostSecretCodec,
  type DesktopFlowerHostPaths,
  resolveDesktopFlowerHostSecret,
} from './desktopFlowerHostState';
import type {
  DesktopFlowerHostTargetSessionGrant,
  DesktopFlowerHostTargetSessionRequest,
} from './flowerHostBridge';

type SecretResolverServer = Readonly<{
  baseURL: string;
  token: string;
  close: () => Promise<void>;
}>;

type FlowerHostResolverErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'unsupported_secret_kind'
  | 'target_session_unavailable'
  | 'target_session_invalid'
  | 'secret_resolver_error';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

class TargetSessionGrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetSessionGrantValidationError';
  }
}

async function readRequestJSON(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeJSON(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function writeError(
  response: ServerResponse,
  status: number,
  code: FlowerHostResolverErrorCode,
  message: string,
): void {
  writeJSON(response, status, {
    ok: false,
    error: {
      code,
      message: compact(message) || 'Flower Host secret resolver request failed.',
    },
  });
}

function resolverErrorFromUnknown(error: unknown): { code: FlowerHostResolverErrorCode; message: string } {
  return {
    code: 'secret_resolver_error',
    message: error instanceof Error ? error.message : compact(error) || 'Flower Host secret resolver request failed.',
  };
}

function requirePayloadObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new TargetSessionGrantValidationError(`${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requirePayloadString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TargetSessionGrantValidationError(`${field} must be a string.`);
  }
  const text = value.trim();
  if (!text) {
    throw new TargetSessionGrantValidationError(`${field} is required.`);
  }
  return text;
}

function requirePayloadBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TargetSessionGrantValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function requirePayloadExpiration(value: unknown, field: string): number {
  const expiresAt = Number(value);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TargetSessionGrantValidationError(`${field} must be a future millisecond timestamp.`);
  }
  return expiresAt;
}

function normalizeTargetSessionGrant(
  grant: DesktopFlowerHostTargetSessionGrant,
): DesktopFlowerHostTargetSessionGrant {
  const record = requirePayloadObject(grant, 'target session grant');
  const grantClient = requirePayloadObject(record.grant_client, 'target session grant_client');
  requirePayloadString(grantClient.channel_id, 'target session grant_client.channel_id');
  const capabilities = requirePayloadObject(record.capabilities, 'target session capabilities');
  return {
    target_id: requirePayloadString(record.target_id, 'target session target_id'),
    provider_origin: requirePayloadString(record.provider_origin, 'target session provider_origin'),
    env_public_id: requirePayloadString(record.env_public_id, 'target session env_public_id'),
    grant_client: grantClient,
    capabilities: {
      can_read: requirePayloadBoolean(capabilities.can_read, 'target session capabilities.can_read'),
      can_write: requirePayloadBoolean(capabilities.can_write, 'target session capabilities.can_write'),
      can_execute: requirePayloadBoolean(capabilities.can_execute, 'target session capabilities.can_execute'),
    },
    expires_at_unix_ms: requirePayloadExpiration(record.expires_at_unix_ms, 'target session expires_at_unix_ms'),
  };
}

function targetSessionGrantPayload(
  grant: DesktopFlowerHostTargetSessionGrant,
): DesktopFlowerHostTargetSessionGrant {
  const normalized = normalizeTargetSessionGrant(grant);
  return {
    target_id: normalized.target_id,
    provider_origin: normalized.provider_origin,
    env_public_id: normalized.env_public_id,
    grant_client: normalized.grant_client,
    capabilities: normalized.capabilities,
    expires_at_unix_ms: normalized.expires_at_unix_ms,
  };
}

export async function startFlowerHostSecretResolver(
  paths: DesktopFlowerHostPaths,
  codec: DesktopFlowerHostSecretCodec,
  openTargetSession?: (request: DesktopFlowerHostTargetSessionRequest) => Promise<DesktopFlowerHostTargetSessionGrant>,
): Promise<SecretResolverServer> {
  const token = `fhs_${crypto.randomBytes(24).toString('base64url')}`;
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/status') {
      if (compact(request.headers.authorization) !== `Bearer ${token}`) {
        writeError(response, 401, 'unauthorized', 'Unauthorized Flower Host secret resolver request.');
        return;
      }
      writeJSON(response, 200, { ok: true, data: { state: 'ready' } });
      return;
    }
    if (request.method !== 'POST' || (request.url !== '/v1/secrets/resolve' && request.url !== '/v1/targets/open-session')) {
      writeError(response, 404, 'not_found', 'Flower Host secret resolver route was not found.');
      return;
    }
    if (compact(request.headers.authorization) !== `Bearer ${token}`) {
      writeError(response, 401, 'unauthorized', 'Unauthorized Flower Host secret resolver request.');
      return;
    }
    try {
      if (request.url === '/v1/targets/open-session') {
        if (!openTargetSession) {
          writeError(response, 503, 'target_session_unavailable', 'Target session broker is unavailable.');
          return;
        }
        const body = await readRequestJSON(request) as DesktopFlowerHostTargetSessionRequest;
        const grant = await openTargetSession(body);
        writeJSON(response, 200, {
          ok: true,
          data: targetSessionGrantPayload(grant),
        });
        return;
      }
      const body = await readRequestJSON(request) as { provider_id?: unknown; kind?: unknown };
      const providerID = compact(body.provider_id);
      const kind = compact(body.kind);
      if (kind !== 'provider_api_key' && kind !== 'web_search_api_key') {
        writeError(response, 400, 'unsupported_secret_kind', 'Unsupported secret kind.');
        return;
      }
      const value = await resolveDesktopFlowerHostSecret(
        paths,
        providerID,
        kind,
        codec,
      );
      writeJSON(response, 200, {
        ok: true,
        configured: value !== '',
        ...(value ? { value } : {}),
      });
    } catch (error) {
      const failure = error instanceof TargetSessionGrantValidationError
        ? { code: 'target_session_invalid' as const, message: error.message }
        : resolverErrorFromUnknown(error);
      writeError(response, 400, failure.code, failure.message);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Flower Host secret resolver failed to bind a loopback port.');
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    token,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}
