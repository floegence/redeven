import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import WebSocket, { createWebSocketStream } from 'ws';

export class GatewayProxyError extends Error {
  constructor(readonly code: 'GATEWAY_UNREACHABLE' | 'GATEWAY_TARGET_UNAVAILABLE' | 'GATEWAY_SESSION_EXPIRED' | 'GATEWAY_CANCELED') {
    super(code);
    this.name = 'GatewayProxyError';
  }
}

export type GatewayProxyTransport = Readonly<{
  proxyURL: string;
  targetURL: string;
  token: string;
  agent: http.Agent | https.Agent;
  openConnection: (signal?: AbortSignal) => Promise<Duplex>;
  close: () => Promise<void>;
  subscribeFailure: (listener: (error: GatewayProxyError) => void) => () => void;
}>;

/** Preserve Runtime TLS and signed origin claims; the Gateway token stays in main. */
export async function createGatewayProxyTransport(accessURL: string, targetURL: string): Promise<GatewayProxyTransport> {
  const access = new URL(accessURL);
  const target = new URL(targetURL);
  if (!/^https?:$/u.test(access.protocol) || access.username || access.password || access.search || access.hash
    || !/\/gateway\/v3\/access\/[A-Za-z0-9_-]{43}\/$/u.test(access.pathname)
    || !/^https?:$/u.test(target.protocol) || target.username || target.password) {
    throw new Error('Gateway proxy artifact is invalid.');
  }
  const host = target.hostname.replace(/^\[|\]$/gu, '');
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const authority = `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
  const token = randomBytes(32).toString('base64url');
  const sockets = new Set<Duplex>();
  const lifetime = new AbortController();
  const failureListeners = new Set<(error: GatewayProxyError) => void>();
  const reportFailure = (error: GatewayProxyError) => {
    if (!lifetime.signal.aborted && error.code !== 'GATEWAY_CANCELED') for (const listener of failureListeners) listener(error);
  };
  const track = (socket: Duplex): Duplex => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    return socket;
  };
  const tunnel = async (signal?: AbortSignal): Promise<Duplex> => {
    if (lifetime.signal.aborted || signal?.aborted) throw new GatewayProxyError('GATEWAY_CANCELED');
    const url = new URL('_tunnel', access);
    url.protocol = access.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, { handshakeTimeout: 15_000, perMessageDeflate: false, maxPayload: 1 << 20 });
    const stream = track(createWebSocketStream(ws));
    // Node HTTP clients require socket idle timeouts even when their carrier is
    // a WebSocket byte stream. HTTP connections are not pooled across requests.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timeoutMS = 0;
    const touch = () => {
      clearTimeout(timeout);
      if (timeoutMS > 0) timeout = setTimeout(() => stream.emit('timeout'), timeoutMS);
    };
    Object.assign(stream, {
      setTimeout: (ms: number, callback?: () => void) => {
        timeoutMS = ms;
        if (callback) stream.once('timeout', callback);
        touch();
        return stream;
      },
      setNoDelay: () => stream,
    });
    ws.on('message', touch);
    stream.once('close', () => clearTimeout(timeout));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        lifetime.signal.removeEventListener('abort', abort);
      };
      const fail = (error: GatewayProxyError) => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        reportFailure(error);
        reject(error);
      };
      const abort = () => fail(new GatewayProxyError('GATEWAY_CANCELED'));
      signal?.addEventListener('abort', abort, { once: true });
      lifetime.signal.addEventListener('abort', abort, { once: true });
      ws.once('open', () => { if (!settled) { settled = true; cleanup(); resolve(); } });
      ws.once('error', () => fail(new GatewayProxyError('GATEWAY_UNREACHABLE')));
      ws.once('close', () => fail(new GatewayProxyError('GATEWAY_UNREACHABLE')));
      ws.once('unexpected-response', (_request, response) => {
        response.resume();
        fail(new GatewayProxyError(response.statusCode === 401 ? 'GATEWAY_SESSION_EXPIRED' : 'GATEWAY_TARGET_UNAVAILABLE'));
      });
      if (signal?.aborted || lifetime.signal.aborted) abort();
    });
    ws.on('close', code => {
      if (code === 4001) reportFailure(new GatewayProxyError('GATEWAY_SESSION_EXPIRED'));
      else if (code === 1006) reportFailure(new GatewayProxyError('GATEWAY_UNREACHABLE'));
    });
    const abort = () => stream.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    stream.once('close', () => signal?.removeEventListener('abort', abort));
    return stream;
  };
  const openConnection = async (signal?: AbortSignal): Promise<Duplex> => {
    const stream = await tunnel(signal);
    if (target.protocol === 'http:') return stream;
    const socket = track(tls.connect({ socket: stream, servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: true, checkServerIdentity: (_name, cert) => tls.checkServerIdentity(host, cert),
      ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] })) as tls.TLSSocket;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        lifetime.signal.removeEventListener('abort', abort);
        socket.off('secureConnect', ready);
        socket.off('error', fail);
        socket.off('close', closed);
      };
      const fail = (error: Error) => { cleanup(); socket.destroy(); reject(error); };
      const abort = () => fail(new GatewayProxyError('GATEWAY_CANCELED'));
      const ready = () => { cleanup(); resolve(); };
      const closed = () => fail(new GatewayProxyError(lifetime.signal.aborted ? 'GATEWAY_CANCELED' : 'GATEWAY_TARGET_UNAVAILABLE'));
      const timer = setTimeout(() => fail(new GatewayProxyError('GATEWAY_TARGET_UNAVAILABLE')), 15_000);
      signal?.addEventListener('abort', abort, { once: true });
      lifetime.signal.addEventListener('abort', abort, { once: true });
      socket.once('secureConnect', ready);
      socket.once('error', fail);
      socket.once('close', closed);
      if (signal?.aborted || lifetime.signal.aborted) abort();
    });
    return socket;
  };
  const agent = target.protocol === 'https:' ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    if (!callback) throw new Error('Gateway connection requires an asynchronous callback.');
    if (String(options.host ?? options.hostname ?? '').replace(/^\[|\]$/gu, '') !== host || Number(options.port) !== port) {
      callback(new GatewayProxyError('GATEWAY_TARGET_UNAVAILABLE'), null as unknown as net.Socket);
      return undefined;
    }
    void openConnection().then((socket) => callback(null, socket as net.Socket), (error: Error) => callback(error, null as unknown as net.Socket));
    return undefined;
  };
  const authorized = (request: http.IncomingMessage): boolean => {
    const actual = Buffer.from(typeof request.headers['proxy-authorization'] === 'string' ? request.headers['proxy-authorization'] : '');
    const expected = Buffer.from(`Basic ${Buffer.from(`redeven:${token}`).toString('base64')}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const destination = (request: http.IncomingMessage): URL | null => {
    try {
      const value = new URL(request.url ?? '');
      return target.protocol === 'http:' && value.origin === target.origin && !value.username && !value.password ? value : null;
    } catch { return null; }
  };
  const headers = (request: http.IncomingMessage) => {
    const result: http.IncomingHttpHeaders = { ...request.headers, host: target.host };
    for (const name of Object.keys(result)) {
      if (name === 'proxy-authorization' || name === 'forwarded' || name.startsWith('x-forwarded-')
        || name.startsWith('x-redeven-gateway-') || name === 'x-redeven-desktop-bridge-token') delete result[name];
    }
    return result;
  };
  const server = http.createServer((request, response) => {
    if (!authorized(request)) { response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Redeven Gateway"' }); response.end(); return; }
    const url = destination(request);
    if (!url) { response.writeHead(403); response.end(); return; }
    const upstream = http.request(url, { method: request.method, headers: headers(request), agent }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.once('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('upgrade', (request, socket, head) => {
    if (!authorized(request)) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Redeven Gateway"\r\nContent-Length: 0\r\n\r\n'); return; }
    request.url = request.url?.replace(/^ws:/u, 'http:');
    const url = destination(request);
    if (!url) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = http.request(url, { method: request.method, headers: headers(request), agent });
    upstream.once('upgrade', (reply, remote, remoteHead) => {
      track(remote);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([name, value]) => `${name}: ${String(value)}`).join('\r\n')}\r\n\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.pipe(remote).pipe(socket);
      socket.once('close', () => remote.destroy());
      remote.once('close', () => socket.destroy());
    });
    upstream.once('response', (reply) => { reply.resume(); socket.end(`HTTP/1.1 ${reply.statusCode ?? 502} Rejected\r\nContent-Length: 0\r\n\r\n`); });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });
  server.on('connect', async (request, socket, head) => {
    if (!authorized(request)) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Redeven Gateway"\r\nContent-Length: 0\r\n\r\n'); return; }
    if (request.url !== authority) { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
    try {
      const stream = await tunnel();
      if (socket.destroyed) { stream.destroy(); return; }
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) stream.write(head);
      socket.pipe(stream).pipe(socket);
      socket.once('close', () => stream.destroy());
      stream.once('close', () => socket.destroy());
    } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); }
  });
  server.on('connection', track);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as net.AddressInfo;
  let closeTask: Promise<void> | undefined;
  return {
    proxyURL: `http://127.0.0.1:${address.port}`, targetURL: target.href, token, agent, openConnection,
    subscribeFailure: listener => { failureListeners.add(listener); return () => failureListeners.delete(listener); },
    close: () => closeTask ??= (async () => {
      lifetime.abort();
      failureListeners.clear();
      agent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })(),
  };
}
