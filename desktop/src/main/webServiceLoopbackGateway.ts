import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingHttpHeaders, type IncomingMessage, type RequestOptions, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import net from 'node:net';

export const WEB_SERVICE_LOOPBACK_AUTH_HEADER = 'X-Redeven-Web-Service-Loopback-Session';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_REWRITABLE_BODY_BYTES = 16 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type WebServiceLoopbackGateway = Readonly<{
  origin: string;
  port: number;
  authorization_header: typeof WEB_SERVICE_LOOPBACK_AUTH_HEADER;
  authorization_token: string;
  entryURL: (protectedURL: string) => string;
  close: () => Promise<void>;
}>;

export type WebServiceLoopbackGatewayOptions = Readonly<{
  forwardID: string;
  protectedRouteURL: string;
  targetURL: string;
  protectedRequestHeaders?: Readonly<Record<string, string>>;
  authorizationToken?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function validForwardID(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(value);
}

function protectedRouteRoot(routeURL: URL, forwardID: string): URL {
  const firstHostnameLabel = routeURL.hostname.toLowerCase().split('.')[0] ?? '';
  if (firstHostnameLabel === `pf-${forwardID.toLowerCase()}`) {
    return new URL('/', routeURL);
  }
  const prefix = `/pf/${encodeURIComponent(forwardID)}`;
  if (routeURL.pathname === prefix || routeURL.pathname.startsWith(`${prefix}/`)) {
    return new URL(`${prefix}/`, routeURL);
  }
  throw new Error('The protected route does not belong to the requested Web Service.');
}

function protectedAppLocation(routeURL: URL, routeRoot: URL, forwardID: string): string {
  let pathname = routeURL.pathname || '/';
  const firstHostnameLabel = routeURL.hostname.toLowerCase().split('.')[0] ?? '';
  if (firstHostnameLabel === `pf-${forwardID.toLowerCase()}`) {
    return `${pathname}${routeURL.search}${routeURL.hash}`;
  }
  if (routeRoot.pathname !== '/') {
    const prefix = routeRoot.pathname.replace(/\/$/u, '');
    if (pathname === prefix) pathname = '/';
    else if (pathname.startsWith(routeRoot.pathname)) pathname = `/${pathname.slice(routeRoot.pathname.length)}`;
    else throw new Error('The protected route is outside the Web Service route root.');
  }
  return `${pathname}${routeURL.search}${routeURL.hash}`;
}

function upstreamURLForRequest(routeRoot: URL, requestURL: string): URL {
  const incoming = new URL(requestURL, 'http://127.0.0.1');
  const upstream = new URL(routeRoot);
  upstream.pathname = `${routeRoot.pathname}${incoming.pathname.replace(/^\/+/, '')}`;
  upstream.search = incoming.search;
  upstream.hash = '';
  return upstream;
}

function exactHeader(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : compact(value);
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function copyRequestHeaders(
  incoming: IncomingHttpHeaders,
  upstream: URL,
  loopbackOrigin: string,
  protectedOrigin: string,
  protectedHeaders: Readonly<Record<string, string>>,
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (lower === WEB_SERVICE_LOOPBACK_AUTH_HEADER.toLowerCase() || HOP_BY_HOP_HEADERS.has(lower)) continue;
    headers[lower] = value;
  }
  headers.host = upstream.host;
  headers['accept-encoding'] = 'identity';
  for (const headerName of ['origin', 'referer'] as const) {
    const value = headers[headerName];
    if (typeof value === 'string' && value.startsWith(loopbackOrigin)) {
      headers[headerName] = `${protectedOrigin}${value.slice(loopbackOrigin.length)}`;
    }
  }
  for (const [name, value] of Object.entries(protectedHeaders)) {
    headers[name] = value;
  }
  return headers;
}

function copyResponseHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const copied: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    copied[name] = value;
  }
  return copied;
}

function stripCookieDomain(value: string): string {
  return value
    .replace(/;\s*Domain=[^;]*/giu, '')
    .replace(/;\s*Secure(?=;|$)/giu, '');
}

function replaceOriginVariants(value: string, sourceOrigin: string, loopbackOrigin: string): string {
  let output = value.split(sourceOrigin).join(loopbackOrigin);
  const source = new URL(sourceOrigin);
  const target = new URL(loopbackOrigin);
  const sourceWebSocketOrigin = `${source.protocol === 'https:' ? 'wss:' : 'ws:'}//${source.host}`;
  const targetWebSocketOrigin = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}`;
  output = output.split(sourceWebSocketOrigin).join(targetWebSocketOrigin);
  return output;
}

function rewriteValue(value: string, sources: readonly string[], routeRoot: URL, loopbackOrigin: string): string {
  const protectedRouteBase = `${routeRoot.origin}${routeRoot.pathname}`;
  const protectedWebSocketBase = protectedRouteBase.replace(/^http:/u, 'ws:').replace(/^https:/u, 'wss:');
  const loopbackBase = `${loopbackOrigin}/`;
  let output = value.split(protectedRouteBase).join(loopbackBase);
  output = output.split(protectedWebSocketBase).join(loopbackBase.replace(/^http:/u, 'ws:'));
  return sources.reduce((current, source) => replaceOriginVariants(current, source, loopbackOrigin), output);
}

function rewriteLocationValue(value: string, sources: readonly string[], routeRoot: URL, loopbackOrigin: string): string {
  const rewritten = rewriteValue(value, sources, routeRoot, loopbackOrigin);
  let location: URL;
  try {
    location = new URL(rewritten, routeRoot.origin);
  } catch {
    return rewritten;
  }
  if (location.origin !== routeRoot.origin) return rewritten;

  const routePrefix = routeRoot.pathname.replace(/\/$/u, '');
  let appPath: string;
  if (location.pathname === routePrefix) {
    appPath = '/';
  } else if (location.pathname.startsWith(routeRoot.pathname)) {
    appPath = `/${location.pathname.slice(routeRoot.pathname.length)}`;
  } else {
    return rewritten;
  }
  const target = new URL(loopbackOrigin);
  target.pathname = appPath;
  target.search = location.search;
  target.hash = location.hash;
  return target.toString();
}

function isRewritableContentType(value: string | string[] | undefined): boolean {
  const contentType = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  const normalized = contentType.trim();
  return !/^text\/event-stream(?:;|$)/iu.test(normalized)
    && /^(?:text\/|application\/(?:javascript|json|manifest\+json|x-javascript|xml))/iu.test(normalized);
}

function writeUnauthorized(response: ServerResponse): void {
  const body = Buffer.from('Redeven Desktop session required.');
  response.writeHead(401, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
    Connection: 'close',
  });
  response.end(body);
}

function writeBadGateway(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = Buffer.from('Web Service route is not available.');
  response.writeHead(502, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
    Connection: 'close',
  });
  response.end(body);
}

function requestOptions(upstream: URL, request: IncomingMessage, headers: IncomingHttpHeaders): RequestOptions {
  return {
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: `${upstream.pathname}${upstream.search}`,
    headers,
  };
}

export async function startWebServiceLoopbackGateway(
  options: WebServiceLoopbackGatewayOptions,
): Promise<WebServiceLoopbackGateway> {
  const forwardID = compact(options.forwardID);
  if (!validForwardID(forwardID)) throw new Error('The Web Service forward identity is invalid.');
  const protectedRouteURL = new URL(options.protectedRouteURL);
  const targetURL = new URL(options.targetURL);
  if (!['http:', 'https:'].includes(protectedRouteURL.protocol)) throw new Error('The protected Web Service route is invalid.');
  if (targetURL.protocol !== 'http:') throw new Error('Desktop local compatibility requires an HTTP service.');
  const routeRoot = protectedRouteRoot(protectedRouteURL, forwardID);
  const token = compact(options.authorizationToken) || randomBytes(32).toString('base64url');
  if (token.length < 32) throw new Error('The Desktop loopback session token is invalid.');
  const protectedHeaders = options.protectedRequestHeaders ?? {};
  const sockets = new Set<net.Socket>();
  const activeRequests = new Set<ReturnType<typeof http.request>>();
  let closed = false;
  let loopbackOrigin = '';
  const rewriteSources = [protectedRouteURL.origin, routeRoot.origin, targetURL.origin]
    .filter((value, index, values) => values.indexOf(value) === index);

  const server = http.createServer((request, response) => {
    if (closed || !tokensMatch(exactHeader(request.headers, WEB_SERVICE_LOOPBACK_AUTH_HEADER), token)) {
      writeUnauthorized(response);
      return;
    }
    const upstream = upstreamURLForRequest(routeRoot, request.url ?? '/');
    const headers = copyRequestHeaders(request.headers, upstream, loopbackOrigin, routeRoot.origin, protectedHeaders);
    const requestImpl = upstream.protocol === 'https:' ? https.request : http.request;
    const upstreamRequest = requestImpl(requestOptions(upstream, request, headers), (upstreamResponse) => {
      const responseHeaders = copyResponseHeaders(upstreamResponse.headers);
      for (const headerName of ['content-security-policy', 'content-security-policy-report-only', 'access-control-allow-origin', 'link', 'refresh']) {
        const value = responseHeaders[headerName];
        if (typeof value === 'string') responseHeaders[headerName] = rewriteValue(value, rewriteSources, routeRoot, loopbackOrigin);
        else if (Array.isArray(value)) responseHeaders[headerName] = value.map((item) => rewriteValue(item, rewriteSources, routeRoot, loopbackOrigin));
      }
      const location = responseHeaders.location;
      if (typeof location === 'string') responseHeaders.location = rewriteLocationValue(location, rewriteSources, routeRoot, loopbackOrigin);
      else if (Array.isArray(location)) responseHeaders.location = location.map((item) => rewriteLocationValue(item, rewriteSources, routeRoot, loopbackOrigin));
      const cookies = responseHeaders['set-cookie'];
      if (Array.isArray(cookies)) responseHeaders['set-cookie'] = cookies.map(stripCookieDomain);
      else if (typeof cookies === 'string') responseHeaders['set-cookie'] = stripCookieDomain(cookies);

      if (!isRewritableContentType(responseHeaders['content-type'])) {
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
        return;
      }

      const declaredLength = Number.parseInt(String(responseHeaders['content-length'] ?? ''), 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REWRITABLE_BODY_BYTES) {
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let passthrough = false;
      upstreamResponse.on('data', (chunk: Buffer) => {
        if (passthrough) {
          response.write(chunk);
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
        if (size <= MAX_REWRITABLE_BODY_BYTES) return;
        passthrough = true;
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        for (const buffered of chunks) response.write(buffered);
        chunks.length = 0;
      });
      upstreamResponse.on('end', () => {
        if (passthrough) {
          response.end();
          return;
        }
        const body = Buffer.from(rewriteValue(Buffer.concat(chunks).toString('utf8'), rewriteSources, routeRoot, loopbackOrigin));
        delete responseHeaders['content-encoding'];
        delete responseHeaders.etag;
        delete responseHeaders['last-modified'];
        responseHeaders['content-length'] = String(body.length);
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        response.end(body);
      });
      upstreamResponse.on('error', () => writeBadGateway(response));
    });
    activeRequests.add(upstreamRequest);
    upstreamRequest.once('close', () => activeRequests.delete(upstreamRequest));
    upstreamRequest.once('error', () => writeBadGateway(response));
    request.pipe(upstreamRequest);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (request, clientSocket, head) => {
    if (closed || !tokensMatch(exactHeader(request.headers, WEB_SERVICE_LOOPBACK_AUTH_HEADER), token)) {
      clientSocket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = upstreamURLForRequest(routeRoot, request.url ?? '/');
    const headers = copyRequestHeaders(request.headers, upstream, loopbackOrigin, routeRoot.origin, protectedHeaders);
    headers.connection = 'Upgrade';
    headers.upgrade = request.headers.upgrade ?? 'websocket';
    const requestImpl = upstream.protocol === 'https:' ? https.request : http.request;
    const upstreamRequest = requestImpl(requestOptions(upstream, request, headers));
    activeRequests.add(upstreamRequest);
    upstreamRequest.once('close', () => activeRequests.delete(upstreamRequest));
    upstreamRequest.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const responseHeaders = copyResponseHeaders(upstreamResponse.headers);
      const lines = [`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}`];
      for (const [name, value] of Object.entries(responseHeaders)) {
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      lines.push('Connection: Upgrade', `Upgrade: ${upstreamResponse.headers.upgrade ?? 'websocket'}`, '', '');
      clientSocket.write(lines.join('\r\n'));
      if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamRequest.once('response', (upstreamResponse) => {
      clientSocket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? ''}\r\nConnection: close\r\n\r\n`);
      upstreamResponse.pipe(clientSocket);
    });
    upstreamRequest.once('error', () => {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    upstreamRequest.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (!address || address.address !== LOOPBACK_HOST) {
    server.close();
    throw new Error('Desktop could not bind the Web Service loopback gateway.');
  }
  loopbackOrigin = `http://${LOOPBACK_HOST}:${address.port}`;

  return {
    origin: loopbackOrigin,
    port: address.port,
    authorization_header: WEB_SERVICE_LOOPBACK_AUTH_HEADER,
    authorization_token: token,
    entryURL: (protectedURL: string) => `${loopbackOrigin}${protectedAppLocation(new URL(protectedURL), routeRoot, forwardID)}`,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const request of activeRequests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
