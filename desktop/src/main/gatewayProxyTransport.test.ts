import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import WebSocket, { createWebSocketStream, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatewayProxyTransport } from './gatewayProxyTransport';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(options: { stallTLS?: boolean } = {}) {
  const received: http.IncomingHttpHeaders[] = [];
  let tlsStarted: () => void = () => undefined;
  const pendingTLS = new Promise<void>(resolve => { tlsStarted = resolve; });
  const runtime = options.stallTLS ? net.createServer(socket => socket.on('data', tlsStarted)) : http.createServer((request, response) => {
    received.push(request.headers);
    if (request.url === '/stream') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: ready\n\n'); return; }
    if (request.url === '/redirect') { response.writeHead(302, { Location: 'http://runtime.invalid:4567/login' }); response.end(); return; }
    request.pipe(response);
  });
  const sockets = new Set<net.Socket>();
  runtime.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const runtimeWS = options.stallTLS ? undefined : new WebSocketServer({ server: runtime as http.Server });
  runtimeWS?.on('connection', socket => socket.on('message', data => socket.send(data)));
  runtime.listen(0, '127.0.0.1'); await once(runtime, 'listening');
  const port = (runtime.address() as net.AddressInfo).port;
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); runtimeWS?.close(); await new Promise<void>(resolve => runtime.close(() => resolve())); });
  const accessToken = randomBytes(32).toString('base64url');
  const accessPath = `/gateway/v3/access/${accessToken}/`;
  const gateway = http.createServer();
  const gatewayWS = new WebSocketServer({ noServer: true });
  let expired = false;
  gateway.on('upgrade', (request, socket, head) => {
    if (expired || request.url !== `${accessPath}_tunnel`) { socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); return; }
    gatewayWS.handleUpgrade(request, socket, head, ws => {
      const tunnel = createWebSocketStream(ws);
      const upstream = net.connect(port, '127.0.0.1');
      upstream.pipe(tunnel).pipe(upstream);
      tunnel.on('error', () => upstream.destroy());
      upstream.on('error', () => tunnel.destroy());
      tunnel.on('close', () => upstream.destroy());
      upstream.on('close', () => tunnel.destroy());
    });
  });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  cleanup.push(async () => { for (const ws of gatewayWS.clients) ws.terminate(); gatewayWS.close(); await new Promise<void>(resolve => gateway.close(() => resolve())); });
  const accessURL = `http://127.0.0.1:${(gateway.address() as net.AddressInfo).port}${accessPath}`;
  const transport = await createGatewayProxyTransport(accessURL, 'http://runtime.invalid:4567/');
  cleanup.push(transport.close);
  return { transport, received, accessToken, expire: () => { expired = true; }, accessURL, pendingTLS };
}

async function request(options: http.RequestOptions, body = Buffer.alloc(0)) {
  return await new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(options, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks), headers: response.headers }));
    });
    req.on('error', reject); req.end(body);
  });
}

describe('Gateway proxy network transport', () => {
  it('streams large binary data through Gateway without resolving the Runtime on Desktop', async () => {
    const { transport, received, accessToken } = await fixture();
    const body = randomBytes(2 * 1024 * 1024);
    const result = await request({ hostname: 'runtime.invalid', port: 4567, path: '/upload', method: 'POST', agent: transport.agent }, body);
    expect(result.body).toEqual(body);
    expect(received[0].host).toBe('runtime.invalid:4567');
    expect(JSON.stringify(received)).not.toContain(accessToken);
    await expect(request({ hostname: 'other.invalid', port: 4567, agent: transport.agent })).rejects.toMatchObject({ code: 'GATEWAY_TARGET_UNAVAILABLE' });
  });

  it('requires local proxy credentials and restricts HTTP and CONNECT to the selected target', async () => {
    const { transport, received } = await fixture();
    const port = Number(new URL(transport.proxyURL).port);
    const auth = `Basic ${Buffer.from(`redeven:${transport.token}`).toString('base64')}`;
    expect((await request({ hostname: '127.0.0.1', port, path: 'http://runtime.invalid:4567/' })).status).toBe(407);
    expect((await request({ hostname: '127.0.0.1', port, path: 'http://other.invalid/', headers: { 'Proxy-Authorization': auth } })).status).toBe(403);
    const result = await request({ hostname: '127.0.0.1', port, method: 'POST', path: 'http://runtime.invalid:4567/', headers: { 'Proxy-Authorization': auth, 'X-Forwarded-For': 'untrusted', 'X-Redeven-Desktop-Bridge-Token': 'private' } }, Buffer.from('hello'));
    expect(result.body.toString()).toBe('hello');
    expect(received[0]['proxy-authorization']).toBeUndefined();
    expect(received[0]['x-forwarded-for']).toBeUndefined();
    expect(received[0]['x-redeven-desktop-bridge-token']).toBeUndefined();
    const socket = net.connect(port, '127.0.0.1'); await once(socket, 'connect');
    socket.write(`CONNECT other.invalid:443 HTTP/1.1\r\nHost: other.invalid:443\r\nProxy-Authorization: ${auth}\r\n\r\n`);
    expect(String((await once(socket, 'data'))[0])).toContain('403 Forbidden'); socket.destroy();
  });

  it('preserves Runtime redirects and supports WebSocket messages', async () => {
    const { transport } = await fixture();
    const result = await request({ hostname: 'runtime.invalid', port: 4567, path: '/redirect', agent: transport.agent });
    expect(result.headers.location).toBe('http://runtime.invalid:4567/login');
    const socket = new WebSocket('ws://runtime.invalid:4567/ws', { agent: transport.agent });
    await once(socket, 'open'); socket.send('terminal output');
    expect(String((await once(socket, 'message'))[0])).toBe('terminal output');
    socket.terminate();
  });

  it('handles WebSocket upgrade on the authenticated loopback proxy without exposing credentials upstream', async () => {
    const { transport } = await fixture();
    const port = Number(new URL(transport.proxyURL).port);
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: 'ws://runtime.invalid:4567/ws',
        headers: { 'Proxy-Authorization': `Basic ${Buffer.from(`redeven:${transport.token}`).toString('base64')}`,
          Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
      req.once('upgrade', (response, socket) => { expect(response.statusCode).toBe(101); resolve(socket); });
      req.once('response', response => { response.resume(); reject(new Error(`Unexpected status ${response.statusCode}`)); });
      req.once('error', reject);
    });
    const message = Buffer.from('loopback WebSocket');
    // One masked text frame with a zero mask is sufficient to exercise the upgrade stream.
    socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | message.length, 0, 0, 0, 0]), message]));
    expect(String((await once(socket, 'data'))[0])).toContain('loopback WebSocket');
    socket.destroy();
  });

  it('cancels a pending TLS handshake when its Desktop session is closed', async () => {
    const { accessURL, pendingTLS } = await fixture({ stallTLS: true });
    // This fixture's upstream accepts TCP but never sends a TLS ServerHello.
    const transport = await createGatewayProxyTransport(accessURL, 'https://runtime.invalid:4567/');
    cleanup.push(transport.close);
    const pending = expect(transport.openConnection()).rejects.toMatchObject({ code: 'GATEWAY_CANCELED' });
    await pendingTLS;
    await transport.close();
    await pending;
  });

  it('flushes SSE and closes all active connections when the session ends', async () => {
    const { transport } = await fixture();
    const req = http.get('http://runtime.invalid:4567/stream', { agent: transport.agent });
    const [response] = await once(req, 'response') as [http.IncomingMessage];
    expect(String((await once(response, 'data'))[0])).toBe('data: ready\n\n');
    const closed = new Promise<void>(resolve => response.once('close', resolve));
    await transport.close(); await closed;
    await expect(transport.openConnection()).rejects.toMatchObject({ code: 'GATEWAY_CANCELED' });
  });

  it('returns a sanitized session-expired error without exposing the artifact URL', async () => {
    const { transport, expire, accessToken } = await fixture(); expire();
    try { await transport.openConnection(); throw new Error('expected expired'); }
    catch (error) { expect(error).toMatchObject({ code: 'GATEWAY_SESSION_EXPIRED' }); expect(String(error)).not.toContain(accessToken); }
  });
});
