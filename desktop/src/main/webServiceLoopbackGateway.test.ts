import http from 'node:http';
import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  startWebServiceLoopbackGateway,
  WEB_SERVICE_LOOPBACK_AUTH_HEADER,
  type WebServiceLoopbackGateway,
} from './webServiceLoopbackGateway';

const gateways: WebServiceLoopbackGateway[] = [];
const servers: http.Server[] = [];
const serverSockets = new Set<net.Socket>();

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  for (const socket of serverSockets) socket.destroy();
  serverSockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  server.on('connection', (socket) => {
    serverSockets.add(socket);
    socket.once('close', () => serverSockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  return address.port;
}

async function request(url: string, token?: string): Promise<Readonly<{ status: number; headers: http.IncomingHttpHeaders; body: string }>> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: token ? { [WEB_SERVICE_LOOPBACK_AUTH_HEADER]: token } : {},
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
  });
}

describe('Web Service loopback gateway', () => {
  it('binds one guarded 127.0.0.1 origin and keeps both Desktop secrets out of the service route', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const upstream = http.createServer((req, response) => {
      receivedHeaders = req.headers;
      if (req.headers['x-test-protected-route'] !== 'bridge-secret') {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ path: req.url }));
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startWebServiceLoopbackGateway({
      forwardID: 'demo',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/demo/start?q=1#section`,
      targetURL: 'http://127.0.0.1:3080/',
      protectedRequestHeaders: { 'X-Test-Protected-Route': 'bridge-secret' },
      authorizationToken: 'a'.repeat(43),
    });
    gateways.push(gateway);

    expect(gateway.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(gateway.entryURL(`http://127.0.0.1:${upstreamPort}/pf/demo/start?q=1#section`))
      .toBe(`${gateway.origin}/start?q=1#section`);
    expect(gateway.entryURL(`http://pf-demo.localhost:${upstreamPort}/start?q=1#section`))
      .toBe(`${gateway.origin}/start?q=1#section`);
    expect((await request(`${gateway.origin}/models`)).status).toBe(401);
    expect((await request(`${gateway.origin}/models`, 'b'.repeat(43))).status).toBe(401);

    const accepted = await request(`${gateway.origin}/models?q=deepseek`, gateway.authorization_token);
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ path: '/pf/demo/models?q=deepseek' });
    expect(receivedHeaders[WEB_SERVICE_LOOPBACK_AUTH_HEADER.toLowerCase()]).toBeUndefined();
    expect(receivedHeaders['x-test-protected-route']).toBe('bridge-secret');
  });

  it('rewrites protected redirects, browser policy, cookies, and text resources to the isolated origin', async () => {
    const upstream = http.createServer((req, response) => {
      const origin = `http://${req.headers.host}`;
      if (req.url === '/pf/demo/relative') {
        response.writeHead(303, { Location: '/pf/demo/next?q=1#section' }).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        Location: `${origin}/pf/demo/next`,
        'Content-Security-Policy': `default-src 'self'; connect-src ${origin}`,
        'Set-Cookie': [`model=ready; Domain=pf-demo.localhost; Path=/; Secure; HttpOnly`],
      });
      response.end(`<a href="${origin}/pf/demo/settings">settings</a>`);
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startWebServiceLoopbackGateway({
      forwardID: 'demo',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/demo/`,
      targetURL: 'http://127.0.0.1:3080/',
      authorizationToken: 'c'.repeat(43),
    });
    gateways.push(gateway);

    const accepted = await request(gateway.origin, gateway.authorization_token);
    expect(accepted.headers.location).toBe(`${gateway.origin}/next`);
    expect(accepted.headers['content-security-policy']).toContain(gateway.origin);
    expect(accepted.headers['set-cookie']?.[0]).toBe('model=ready; Path=/; HttpOnly');
    expect(accepted.body).toContain(`${gateway.origin}/settings`);

    const relativeRedirect = await request(`${gateway.origin}/relative`, gateway.authorization_token);
    expect(relativeRedirect.status).toBe(303);
    expect(relativeRedirect.headers.location).toBe(`${gateway.origin}/next?q=1#section`);
  });

  it('keeps WebSocket upgrades inside the same authorized service gateway', async () => {
    const upstream = http.createServer();
    upstream.on('upgrade', (req, socket, head) => {
      expect(req.url).toBe('/pf/demo/socket?channel=models');
      expect(req.headers[WEB_SERVICE_LOOPBACK_AUTH_HEADER.toLowerCase()]).toBeUndefined();
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      if (head.length > 0) socket.write(head);
      socket.pipe(socket);
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startWebServiceLoopbackGateway({
      forwardID: 'demo',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/demo/`,
      targetURL: 'http://127.0.0.1:3080/',
      authorizationToken: 'd'.repeat(43),
    });
    gateways.push(gateway);

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(gateway.port, '127.0.0.1');
      let received = '';
      socket.once('connect', () => {
        socket.write([
          'GET /socket?channel=models HTTP/1.1',
          `Host: 127.0.0.1:${gateway.port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          `${WEB_SERVICE_LOOPBACK_AUTH_HEADER}: ${gateway.authorization_token}`,
          '',
          '',
        ].join('\r\n'));
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('latin1');
        if (received.includes('\r\n\r\n')) {
          socket.destroy();
          resolve(received);
        }
      });
      socket.once('error', reject);
    });
    expect(response).toContain('101 Switching Protocols');
  });

  it('streams event responses without waiting for the upstream connection to close', async () => {
    const upstream = http.createServer((_req, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: ready\n\n');
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startWebServiceLoopbackGateway({
      forwardID: 'events',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/events/`,
      targetURL: 'http://127.0.0.1:3080/',
      authorizationToken: 'g'.repeat(43),
    });
    gateways.push(gateway);

    const firstChunk = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${gateway.origin}/events`, {
        headers: { [WEB_SERVICE_LOOPBACK_AUTH_HEADER]: gateway.authorization_token },
      }, (response) => {
        response.once('data', (chunk: Buffer) => {
          resolve(chunk.toString('utf8'));
          response.destroy();
        });
      });
      req.once('error', reject);
    });
    expect(firstChunk).toBe('data: ready\n\n');
  });

  it('does not accept another service partition token and releases its port on close', async () => {
    const upstreamPort = await listen(http.createServer((_req, response) => response.end('ok')));
    const first = await startWebServiceLoopbackGateway({
      forwardID: 'first',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/first/`,
      targetURL: 'http://127.0.0.1:3000/',
      authorizationToken: 'e'.repeat(43),
    });
    const second = await startWebServiceLoopbackGateway({
      forwardID: 'second',
      protectedRouteURL: `http://127.0.0.1:${upstreamPort}/pf/second/`,
      targetURL: 'http://127.0.0.1:3001/',
      authorizationToken: 'f'.repeat(43),
    });
    gateways.push(first, second);

    expect((await request(first.origin, second.authorization_token)).status).toBe(401);
    expect((await request(first.origin, first.authorization_token)).status).toBe(200);
    await first.close();
    await expect(request(first.origin, first.authorization_token)).rejects.toBeTruthy();
  });
});
