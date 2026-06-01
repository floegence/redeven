import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import {
  type DesktopFlowerHostSecretCodec,
  type DesktopFlowerHostPaths,
  resolveDesktopFlowerHostSecret,
} from './desktopFlowerHostState';

type SecretResolverServer = Readonly<{
  baseURL: string;
  token: string;
  close: () => Promise<void>;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
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

export async function startFlowerHostSecretResolver(
  paths: DesktopFlowerHostPaths,
  codec: DesktopFlowerHostSecretCodec,
  resolveControlPlaneAccessToken?: (providerOrigin: string) => Promise<string>,
): Promise<SecretResolverServer> {
  const token = `fhs_${crypto.randomBytes(24).toString('base64url')}`;
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/secrets/resolve') {
      writeJSON(response, 404, { ok: false, error: 'not found' });
      return;
    }
    if (compact(request.headers.authorization) !== `Bearer ${token}`) {
      writeJSON(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const body = await readRequestJSON(request) as { provider_id?: unknown; provider_origin?: unknown; kind?: unknown };
      const providerID = compact(body.provider_id);
      const providerOrigin = compact(body.provider_origin);
      const kind = compact(body.kind);
      if (kind !== 'provider_api_key' && kind !== 'web_search_api_key' && kind !== 'control_plane_access_token') {
        writeJSON(response, 400, { ok: false, error: 'unsupported secret kind' });
        return;
      }
      if (kind === 'control_plane_access_token') {
        if (providerOrigin === '') {
          writeJSON(response, 400, { ok: false, error: 'provider_origin is required' });
          return;
        }
        if (!resolveControlPlaneAccessToken) {
          writeJSON(response, 200, { ok: true, configured: false });
          return;
        }
        const value = await resolveControlPlaneAccessToken(providerOrigin);
        writeJSON(response, 200, {
          ok: true,
          configured: value !== '',
          ...(value ? { value } : {}),
        });
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
      writeJSON(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
