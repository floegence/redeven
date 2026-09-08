import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  CODESPACE_NATIVE_AUTH_HEADER,
  createNativeCodeSpaceGateway,
} from './codespaceNativeGateway';

describe('native CodeSpace gateway', () => {
  it('authenticates before forwarding and streams binary bodies with independent cookies', async () => {
    let calls = 0;
    const upstream = http.createServer((req, res) => {
      calls++;
      expect(
        req.headers[CODESPACE_NATIVE_AUTH_HEADER.toLowerCase()],
      ).toBeUndefined();
      expect(req.url).toBe('/bound/echo?x=%2F&x=2');
      expect(req.headers['x-runtime-auth']).toBe('runtime-secret');
      res.setHeader('Set-Cookie', ['a=1', 'b=2']);
      req.pipe(res);
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const port = (upstream.address() as AddressInfo).port;
    const gateway = await createNativeCodeSpaceGateway({
      pathPrefix: '/bound',
      authority: `127.0.0.1:${port}`,
      headers: { 'x-runtime-auth': 'runtime-secret' },
      openConnection: async () => net.connect(port, '127.0.0.1'),
      close: async () => {},
    });
    const send = (
      headers: Record<string, string>,
      body: Buffer,
    ): Promise<{ status: number; body: Buffer; cookies: string[] }> =>
      new Promise((resolve, reject) => {
        const req = http.request(
          `${gateway.origin}/echo?x=%2F&x=2`,
          { method: 'POST', headers },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks),
                cookies: res.headers['set-cookie'] ?? [],
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    try {
      expect((await send({}, Buffer.alloc(0))).status).toBe(401);
      expect(calls).toBe(0);
      expect(
        (
          await send(
            {
              Host: 'localhost:1',
              [CODESPACE_NATIVE_AUTH_HEADER]: gateway.token,
            },
            Buffer.alloc(0),
          )
        ).status,
      ).toBe(401);
      expect(calls).toBe(0);
      const bytes = Buffer.alloc(1024 * 1024 + 111, 0xab);
      const result = await send(
        { [CODESPACE_NATIVE_AUTH_HEADER]: gateway.token },
        bytes,
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(bytes);
      expect(result.cookies).toEqual(['a=1', 'b=2']);
    } finally {
      await gateway.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

it('carries both upgrade heads and large raw bytes without WebSocket decoding', async () => {
  const upstream = http.createServer();
  upstream.on('upgrade', (_request, socket, head) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nserver-head',
    );
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as AddressInfo).port;
  const gateway = await createNativeCodeSpaceGateway({
    pathPrefix: '',
    authority: `127.0.0.1:${port}`,
    headers: {},
    openConnection: async () => net.connect(port, '127.0.0.1'),
    close: async () => {},
  });
  const client = net.connect(gateway.port, '127.0.0.1');
  const bytes = Buffer.alloc(256 * 1024 + 93, 0xcd);
  try {
    const received = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const data = Buffer.concat(chunks);
        const start = data.indexOf('\r\n\r\n');
        if (start >= 0 && data.length >= start + 4 + 22 + bytes.length)
          resolve(data.subarray(start + 4));
      });
      client.on('error', reject);
    });
    client.write(
      `GET /terminal HTTP/1.1\r\nHost: 127.0.0.1:${gateway.port}\r\n${CODESPACE_NATIVE_AUTH_HEADER}: ${gateway.token}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nclient-head`,
    );
    client.write(bytes);
    expect(await received).toEqual(
      Buffer.concat([Buffer.from('server-headclient-head'), bytes]),
    );
    const ended = once(client, 'close');
    await gateway.close();
    await ended;
  } finally {
    client.destroy();
    await gateway.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 10_000);

it('fails an occupied persistent origin without contacting its owner', async () => {
  const listener = net.createServer(() => {
    throw new Error('unexpected connection');
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  let closed = false;
  try {
    await expect(
      createNativeCodeSpaceGateway(
        {
          pathPrefix: '',
          authority: '',
          headers: {},
          openConnection: async () => {
            throw new Error('unused');
          },
          close: async () => {
            closed = true;
          },
        },
        (listener.address() as AddressInfo).port,
      ),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(closed).toBe(true);
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});
