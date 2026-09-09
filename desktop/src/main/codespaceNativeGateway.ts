import {
  CodeSpaceBrowserAuthorization,
  CODESPACE_BROWSER_COOKIE,
  CODESPACE_BROWSER_SESSION_MS,
  stripCodeSpaceBrowserCookie,
} from './codespaceBrowserAuthorization';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export const CODESPACE_NATIVE_AUTH_HEADER = 'X-Redeven-CodeSpace-Session';

export type NativeCodeSpaceRoute = Readonly<{
  pathPrefix: string;
  authority: string;
  headers: Readonly<Record<string, string>>;
  openConnection: (
    signal: AbortSignal,
    presentationOrigin: string,
  ) => Promise<Duplex>;
  close: () => Promise<void>;
}>;

export type NativeCodeSpaceGateway = Readonly<{
  origin: string;
  port: number;
  token: string;
  mintBrowserEntry: () => string;
  close: () => Promise<void>;
}>;

const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function copyHeaders(
  source: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const excluded = new Set([
    ...hopHeaders,
    CODESPACE_NATIVE_AUTH_HEADER.toLowerCase(),
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-redeven-code-access',
    'x-redeven-code-origin',
    'x-redeven-access-resume',
    'x-redeven-desktop-bridge-token',
  ]);
  for (const value of String(source.connection ?? '').split(','))
    excluded.add(value.trim().toLowerCase());
  const headers = Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && !excluded.has(name.toLowerCase()),
    ),
  ) as Record<string, string | string[]>;
  if (typeof headers.cookie === 'string') {
    headers.cookie = stripCodeSpaceBrowserCookie(headers.cookie);
    if (!headers.cookie) delete headers.cookie;
  }
  if (headers['set-cookie']) {
    const cookies = headers['set-cookie'];
    headers['set-cookie'] = (
      Array.isArray(cookies) ? cookies : [cookies]
    ).filter(
      (cookie) => cookie.split('=')[0]?.trim() !== CODESPACE_BROWSER_COOKIE,
    );
  }
  return headers;
}

function exactHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase())
      values.push(request.rawHeaders[index + 1] ?? '');
  }
  return values.length === 1 ? values[0] : undefined;
}

function equalToken(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const bytes = Buffer.from(actual);
  const secret = Buffer.from(expected);
  return bytes.length === secret.length && timingSafeEqual(bytes, secret);
}

/** One CodeSpace owns the listener, capability, route, and every active connection. */
export async function createNativeCodeSpaceGateway(
  route: NativeCodeSpaceRoute,
  port = 0,
  browserHost?: string,
): Promise<NativeCodeSpaceGateway> {
  if (
    browserHost !== undefined &&
    !/^cs-[a-f0-9]{40}\.localhost$/u.test(browserHost)
  ) {
    await route.close();
    throw new Error('invalid codespace browser host');
  }
  const browser = browserHost ? new CodeSpaceBrowserAuthorization() : undefined;
  const token = randomBytes(32).toString('base64url');
  const lifetime = new AbortController();
  const sockets = new Set<Duplex>();
  const requests = new Set<http.ClientRequest>();
  let origin = '';
  let closed: Promise<void> | undefined;
  let active = 0;
  const server = http.createServer({
    maxHeaderSize: 64 * 1024,
    headersTimeout: 15_000,
    requestTimeout: 0,
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  const validRequest = (request: IncomingMessage): boolean =>
    !lifetime.signal.aborted &&
    exactHeader(request, 'host') === new URL(origin).host &&
    Boolean(
      request.url?.startsWith('/') &&
        !request.url.startsWith('//') &&
        !request.url.includes('\\'),
    );
  const admitted = (request: IncomingMessage, upgrade = false): boolean =>
    validRequest(request) &&
    (browser
      ? browser.authorize(request, origin, upgrade)
      : equalToken(exactHeader(request, CODESPACE_NATIVE_AUTH_HEADER), token));

  const begin = async (
    incoming: IncomingMessage,
    upgrade: boolean,
  ): Promise<http.ClientRequest> => {
    if (active >= 64) throw new Error('resource_exhausted');
    active++;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        active--;
      }
    };
    const requestLife = new AbortController();
    const cancel = (): void => requestLife.abort();
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    incoming.once('aborted', cancel);
    let connection: Duplex;
    const deadline = setTimeout(cancel, 10_000);
    try {
      connection = await route.openConnection(requestLife.signal, origin);
      if (requestLife.signal.aborted) {
        connection.destroy();
        throw new Error('session_closed');
      }
    } catch (error) {
      release();
      lifetime.signal.removeEventListener('abort', cancel);
      incoming.removeListener('aborted', cancel);
      throw error;
    } finally {
      clearTimeout(deadline);
    }
    sockets.add(connection);
    connection.once('close', () => {
      sockets.delete(connection);
      release();
      lifetime.signal.removeEventListener('abort', cancel);
      incoming.removeListener('aborted', cancel);
    });
    const headers = {
      ...copyHeaders(incoming.headers),
      ...route.headers,
      host: route.authority || new URL(origin).host,
      'X-Redeven-Code-Origin': origin,
    };
    if (upgrade) {
      Object.assign(headers, {
        connection: 'Upgrade',
        upgrade: incoming.headers.upgrade ?? '',
      });
    }
    const upstream = http.request({
      method: incoming.method,
      path: `${route.pathPrefix}${incoming.url}`,
      headers,
      createConnection: () => connection,
      signal: requestLife.signal,
      maxHeaderSize: 64 * 1024,
    });
    requests.add(upstream);
    upstream.once('close', () => requests.delete(upstream));
    return upstream;
  };

  server.on('request', (incoming, response) => {
    if (validRequest(incoming) && browser?.redeem(incoming, response)) return;
    if (!admitted(incoming)) {
      response.writeHead(401, { Connection: 'close' });
      response.end();
      return;
    }
    let upstream: http.ClientRequest | undefined;
    response.once('close', () => upstream?.destroy());
    void begin(incoming, false)
      .then((request) => {
        upstream = request;
        if (response.destroyed) {
          request.destroy();
          return;
        }
        request.on('error', () => {
          if (response.headersSent) response.destroy();
          else {
            response.writeHead(502, { Connection: 'close' });
            response.end('upstream unavailable');
          }
        });
        request.on('response', (result) => {
          response.writeHead(
            result.statusCode ?? 502,
            copyHeaders(result.headers),
          );
          result.on('error', () => response.destroy());
          result.on('end', () => {
            if (Object.keys(result.trailers).length)
              response.addTrailers(copyHeaders(result.trailers));
          });
          result.pipe(response);
        });
        incoming.on('end', () => {
          if (Object.keys(incoming.trailers).length)
            request.addTrailers(copyHeaders(incoming.trailers));
        });
        incoming.pipe(request);
      })
      .catch(() => {
        if (!response.destroyed) {
          response.writeHead(503, { Connection: 'close' });
          response.end('codespace unavailable');
        }
      });
  });

  server.on('upgrade', (incoming, downstream, head) => {
    if (!admitted(incoming, true)) {
      downstream.end(
        'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    void begin(incoming, true)
      .then((request) => {
        downstream.once('close', () => request.destroy());
        request.on('error', () => downstream.destroy());
        request.on('response', (response) => {
          response.resume();
          downstream.end(
            `HTTP/1.1 ${response.statusCode ?? 502} Upstream Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
        });
        request.on('upgrade', (response, connection, upstreamHead) => {
          if (downstream.destroyed) {
            connection.destroy();
            return;
          }
          const headers = {
            ...copyHeaders(response.headers),
            connection: 'Upgrade',
            upgrade: response.headers.upgrade ?? '',
          };
          downstream.write(
            `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers)
              .flatMap(([name, value]) =>
                (Array.isArray(value) ? value : [value]).map(
                  (entry) => `${name}: ${entry}\r\n`,
                ),
              )
              .join('')}\r\n`,
          );
          if (head.length) connection.write(head);
          if (upstreamHead.length) downstream.write(upstreamHead);
          connection.on('error', () => downstream.destroy());
          downstream.on('error', () => connection.destroy());
          downstream.once('close', () => connection.destroy());
          connection.once('close', () => downstream.destroy());
          connection.pipe(downstream);
          downstream.pipe(connection);
        });
        request.end();
      })
      .catch(() => downstream.destroy());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await route.close();
    throw error;
  }
  const ownedPort = (server.address() as AddressInfo).port;
  origin = `http://${browserHost ?? '127.0.0.1'}:${ownedPort}`;
  let expiry: NodeJS.Timeout | undefined;
  const close = (): Promise<void> =>
    (closed ??= (async () => {
      clearTimeout(expiry);
      lifetime.abort();
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await route.close();
    })());
  if (browser)
    expiry = setTimeout(() => {
      void close();
    }, CODESPACE_BROWSER_SESSION_MS).unref();
  return {
    origin,
    port: ownedPort,
    token,
    mintBrowserEntry: () => {
      if (!browser || lifetime.signal.aborted)
        throw new Error('codespace_closed');
      return browser.mint(origin);
    },
    close,
  };
}
