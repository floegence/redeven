import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Session } from 'electron';
import { expect, it, vi } from 'vitest';
import { createLocalNativeCodeSpaceRoute } from './codespaceNativeRoute';
import {
  createNativeCodeSpaceGateway,
  CODESPACE_NATIVE_AUTH_HEADER,
} from './codespaceNativeGateway';
import type { DesktopSessionTransportKind } from './desktopSessionTransport';
import type { StartupReport } from './startup';

it.each<{ kind: DesktopSessionTransportKind; host: string }>([
  { kind: 'native_local_bridge', host: '127.0.0.1' },
  { kind: 'placement_bridge', host: '127.0.0.1' },
  { kind: 'gateway_bridge', host: '127.0.0.1' },
  { kind: 'external_local_ui', host: '127.0.0.1' },
  { kind: 'external_local_ui', host: '::1' },
])('reuses the selected $kind listener at $host and its bound instance', async ({ kind, host }) => {
  const instance = 'fixed-generation-12345678';
  const privateToken = Buffer.alloc(32, 7).toString('base64url');
  const privateBridge =
    kind === 'native_local_bridge' || kind === 'placement_bridge';
  const upstream = http.createServer((request, response) => {
    expect(request.headers['x-redeven-desktop-bridge-token']).toBe(
      privateBridge ? privateToken : undefined,
    );
    if (request.url === '/api/local/codespaces/demo') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ ok: true, data: { instance_id: instance } }),
      );
      return;
    }
    expect(request.url).toBe(
      `/api/local/codespaces/demo/${instance}/file%2Fname?x=%2F&x=2`,
    );
    expect(request.headers['x-redeven-code-access']).toBe('runtime-access');
    expect(
      request.headers[CODESPACE_NATIVE_AUTH_HEADER.toLowerCase()],
    ).toBeUndefined();
    expect(request.headers['x-redeven-code-origin']).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+$/u,
    );
    request.pipe(response);
  });
  upstream.listen(0, host);
  await once(upstream, 'listening');
  const baseURL = `http://${host.includes(':') ? `[${host}]` : host}:${(upstream.address() as AddressInfo).port}/`;
  const webSession = {
    fetch: vi.fn((url, init) => fetch(url, init)),
    cookies: { get: vi.fn(async () => [{ value: 'runtime-access' }]) },
  } as unknown as Session;
  const route = await createLocalNativeCodeSpaceRoute({
    transport: {
      kind,
      baseURL,
      allowedBaseURL: baseURL,
      entryURL: baseURL,
      displayURL: baseURL,
      partition: '',
      proxyPolicy: 'direct',
    },
    startup: { local_ui_bridge_token: privateToken } as StartupReport,
    webSession,
    codeSpaceID: 'demo',
    signal: new AbortController().signal,
  });
  const gateway = await createNativeCodeSpaceGateway(route);
  try {
    const response = await fetch(`${gateway.origin}/file%2Fname?x=%2F&x=2`, {
      method: 'POST',
      headers: { [CODESPACE_NATIVE_AUTH_HEADER]: gateway.token },
      body: 'native\x00body',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('native\x00body');
    expect(webSession.fetch).toHaveBeenCalledTimes(1);
  } finally {
    await gateway.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
