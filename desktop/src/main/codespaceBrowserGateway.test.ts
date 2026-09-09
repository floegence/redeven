import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import {
  createNativeCodeSpaceGateway,
  CODESPACE_NATIVE_AUTH_HEADER,
} from './codespaceNativeGateway';
import {
  CODESPACE_BROWSER_COOKIE,
  CodeSpaceBrowserAuthorization,
  CODESPACE_BROWSER_SESSION_MS,
} from './codespaceBrowserAuthorization';

const host = 'cs-' + 'a'.repeat(40) + '.localhost';
function request(
  port: number,
  authority: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
  body = Buffer.alloc(0),
) {
  return new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { Host: authority, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

it('hands an unprivileged browser into one editor and relays resources, bodies and upgrades without credentials', async () => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls++;
    expect(req.headers.cookie).toBe('editor=kept');
    expect(
      req.headers[CODESPACE_NATIVE_AUTH_HEADER.toLowerCase()],
    ).toBeUndefined();
    res.setHeader('Set-Cookie', [
      'editor=updated; Path=/',
      `${CODESPACE_BROWSER_COOKIE}=forged; Path=/`,
    ]);
    if (req.method === 'POST') req.pipe(res);
    else res.end(req.url);
  });
  upstream.on('upgrade', (req, socket, head) => {
    expect(req.headers.cookie).toBe('editor=kept');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nserver-head',
    );
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = await createNativeCodeSpaceGateway(
    {
      pathPrefix: '',
      authority: '',
      headers: {},
      openConnection: async () =>
        net.connect((upstream.address() as AddressInfo).port, '127.0.0.1'),
      close: async () => {},
    },
    0,
    host,
  );
  const authority = new URL(gateway.origin).host;
  const send = (
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
    body = Buffer.alloc(0),
  ) => request(gateway.port, authority, path, headers, method, body);
  const client = net.connect(gateway.port, '127.0.0.1');
  try {
    expect((await send('/')).status).toBe(401);
    expect(
      (await send('/', { [CODESPACE_NATIVE_AUTH_HEADER]: gateway.token }))
        .status,
    ).toBe(401);
    const entry = new URL(gateway.mintBrowserEntry());
    expect(entry.href).not.toContain(gateway.token);
    expect(
      (
        await request(
          gateway.port,
          `127.0.0.1:${gateway.port}`,
          entry.pathname + entry.search,
        )
      ).status,
    ).toBe(401);
    const redeemed = await send(entry.pathname + entry.search);
    expect(redeemed.status).toBe(303);
    expect(redeemed.headers.location).toBe('/');
    expect(redeemed.headers['cache-control']).toBe('no-store');
    expect(redeemed.headers['referrer-policy']).toBe('no-referrer');
    const session = redeemed.headers['set-cookie']![0]!;
    expect(session).toContain('HttpOnly; SameSite=Strict');
    expect(session).not.toMatch(/Domain=/i);
    const cookie = session.split(';')[0]! + '; editor=kept';
    expect((await send(entry.pathname + entry.search)).status).toBe(401);
    expect(calls).toBe(0);
    for (const path of [
      '/',
      '/static/editor.js?x=%2F&x=2',
      '/service-worker.js',
    ]) {
      const response = await send(path, { Cookie: cookie });
      expect(response.status).toBe(200);
      expect(response.body.toString()).toBe(path);
      expect(response.headers['set-cookie']).toEqual([
        'editor=updated; Path=/',
      ]);
    }
    const body = Buffer.alloc(1024 * 1024 + 17, 0xab);
    expect(
      (
        await send(
          '/save',
          { Cookie: cookie, Origin: gateway.origin },
          'POST',
          body,
        )
      ).body,
    ).toEqual(body);
    for (const headers of [
      { Cookie: cookie, Origin: 'https://evil.example' },
      { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' },
      { Cookie: cookie + `; ${CODESPACE_BROWSER_COOKIE}=duplicate` },
    ] as Record<string, string>[])
      expect((await send('/', headers)).status).toBe(401);
    expect((await send('/save', { Cookie: cookie }, 'POST')).status).toBe(401);
    expect(
      (
        await request(
          gateway.port,
          authority.replace('a'.repeat(40), 'b'.repeat(40)),
          '/',
          { Cookie: cookie },
        )
      ).status,
    ).toBe(401);
    for (const headers of [
      { Cookie: cookie, Connection: 'Upgrade', Upgrade: 'websocket' },
      {
        Cookie: cookie,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        Origin: 'https://evil.example',
      },
    ] as Record<string, string>[]) {
      expect((await send('/terminal', headers)).status).toBe(401);
    }
    const received = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const start = bytes.indexOf('\r\n\r\n');
        if (start >= 0 && bytes.length >= start + 4 + 22)
          resolve(bytes.subarray(start + 4));
      });
      client.on('error', reject);
    });
    client.write(
      `GET /terminal HTTP/1.1\r\nHost: ${authority}\r\nOrigin: ${gateway.origin}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nclient-head`,
    );
    expect(await received).toEqual(Buffer.from('server-headclient-head'));
    const ended = once(client, 'close');
    await gateway.close();
    await ended;
    expect(() => gateway.mintBrowserEntry()).toThrow('codespace_closed');
    await expect(send('/', { Cookie: cookie })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  } finally {
    client.destroy();
    await gateway.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

it('bounds pending entries and rejects expiry, tampering and non-GET redemption', async () => {
  let now = 1000;
  const auth = new CodeSpaceBrowserAuthorization(() => now);
  const server = http.createServer((req, res) => {
    if (!auth.redeem(req, res)) {
      res.writeHead(auth.authorize(req, 'http://owned', false) ? 200 : 401);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const entry = () => new URL(auth.mint('http://owned'));
  const send = (url: URL, method = 'GET') =>
    request(port, 'owned', url.pathname + url.search, {}, method);
  try {
    const replaced = entry();
    const current = entry();
    expect((await send(replaced)).status).toBe(401);
    expect((await send(current)).status).toBe(401);
    const expired = entry();
    now += 60_001;
    expect((await send(expired)).status).toBe(401);
    const tampered = entry();
    tampered.search += '&extra=1';
    expect((await send(tampered)).status).toBe(401);
    expect((await send(entry(), 'POST')).status).toBe(401);
    const result = await send(entry());
    expect(result.status).toBe(303);
    const cookie = result.headers['set-cookie']![0]!.split(';')[0]!;
    now += CODESPACE_BROWSER_SESSION_MS;
    expect((await request(port, 'owned', '/', { Cookie: cookie })).status).toBe(
      401,
    );
    expect(() => entry()).toThrow('codespace_closed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
