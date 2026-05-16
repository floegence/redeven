import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import {
  connectProviderLink,
  getProviderLinkStatus,
  RuntimeControlError,
  runtimeControlServiceURL,
} from './runtimeControlClient';

type TestServer = Readonly<{
  origin: string;
  requests: readonly http.IncomingMessage[];
  bodies: readonly string[];
  close: () => Promise<void>;
}>;

const servers: TestServer[] = [];

function endpoint(baseURL: string): DesktopRuntimeControlEndpoint {
  return {
    protocol_version: 'redeven-runtime-control-v1',
    base_url: baseURL,
    token: 'runtime-control-token',
    desktop_owner_id: 'desktop-owner',
  };
}

async function startServer(
  respond: (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void,
): Promise<TestServer> {
  const requests: http.IncomingMessage[] = [];
  const bodies: string[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push(request);
      bodies.push(body);
      respond(request, body, response);
    });
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
    throw new Error('test server did not expose a TCP port');
  }
  const fixture: TestServer = {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    bodies,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  servers.push(fixture);
  return fixture;
}

function providerLinkResponse(): unknown {
  return {
    ok: true,
    data: {
      linked: true,
      runtime_service: {
        effective_run_mode: 'local',
        remote_enabled: true,
        capabilities: {
          provider_link: {
            supported: true,
            bind_method: 'runtime_control_v1',
          },
        },
        bindings: {
          provider_link: {
            state: 'linked',
            provider_origin: 'https://provider.example.invalid',
            provider_id: 'provider-1',
            env_public_id: 'env-1',
            binding_generation: 1,
            remote_enabled: true,
          },
        },
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('runtimeControlClient', () => {
  it('resolves runtime-control API routes relative to a service root with a path prefix', async () => {
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(providerLinkResponse()));
    });

    const result = await connectProviderLink(endpoint(`${server.origin}/__redeven_runtime_control/`), {
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'provider-1',
      env_public_id: 'env-1',
      bootstrap_ticket: 'ticket-1',
    });

    expect(result.binding.state).toBe('linked');
    expect(server.requests[0]?.url).toBe('/__redeven_runtime_control/v1/provider-link/connect');
    expect(server.requests[0]?.headers.authorization).toBe('Bearer runtime-control-token');
    expect(server.requests[0]?.headers['x-redeven-desktop-owner-id']).toBe('desktop-owner');
    expect(JSON.parse(server.bodies[0] ?? '{}')).toMatchObject({
      provider_id: 'provider-1',
      env_public_id: 'env-1',
    });
  });

  it('treats a base URL without trailing slash as the runtime-control service root', async () => {
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(providerLinkResponse()));
    });

    await getProviderLinkStatus(endpoint(`${server.origin}/__redeven_runtime_control`));

    expect(server.requests[0]?.url).toBe('/__redeven_runtime_control/v1/provider-link');
  });

  it('resolves ordinary loopback runtime-control roots without adding a bridge prefix', () => {
    expect(runtimeControlServiceURL(
      endpoint('http://127.0.0.1:43124/'),
      'v1/provider-link/disconnect',
    ).toString()).toBe('http://127.0.0.1:43124/v1/provider-link/disconnect');
  });

  it('rejects routes that would escape the runtime-control service root', () => {
    expect(() => runtimeControlServiceURL(
      endpoint('http://127.0.0.1:43124/__redeven_runtime_control/'),
      '/v1/provider-link' as never,
    )).toThrow(RuntimeControlError);
    expect(() => runtimeControlServiceURL(
      endpoint('http://127.0.0.1:43124/__redeven_runtime_control/'),
      'https://example.invalid/v1/provider-link' as never,
    )).toThrow(RuntimeControlError);
  });

  it('returns a structured HTTP error when runtime-control responds with non-JSON failure text', async () => {
    const server = await startServer((_request, _body, response) => {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('404 page not found\n');
    });

    await expect(getProviderLinkStatus(endpoint(`${server.origin}/__redeven_runtime_control/`)))
      .rejects.toMatchObject({
        code: 'RUNTIME_CONTROL_HTTP_ERROR',
        statusCode: 404,
        message: 'Runtime control returned HTTP 404: 404 page not found',
      });
  });

  it('keeps runtime-control envelope errors instead of replacing them with transport errors', async () => {
    const server = await startServer((_request, _body, response) => {
      response.writeHead(409, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: false,
        error: {
          code: 'PROVIDER_LINK_BUSY',
          message: 'Runtime has active work.',
        },
      }));
    });

    await expect(getProviderLinkStatus(endpoint(server.origin)))
      .rejects.toMatchObject({
        code: 'PROVIDER_LINK_BUSY',
        statusCode: 409,
        message: 'Runtime has active work.',
      });
  });

  it('reports non-JSON success responses as invalid runtime-control protocol responses', async () => {
    const server = await startServer((_request, _body, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });

    await expect(getProviderLinkStatus(endpoint(server.origin)))
      .rejects.toMatchObject({
        code: 'RUNTIME_CONTROL_INVALID_RESPONSE',
        statusCode: 200,
        message: 'Runtime control returned a non-JSON response.',
      });
  });
});
