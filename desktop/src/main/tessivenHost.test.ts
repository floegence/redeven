import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { connectTessivenHost } from './tessivenHost';
import { RuntimeControlError } from './runtimeControlClient';

it('keeps typed target requests on the owner-authenticated existing control root', async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = new WebSocketServer({ server });
  const execute = vi.fn(
    async (message: { request: { runtime_ref: string; action: string } }) => {
      if (message.request.action === 'restart')
        throw new Error('private transport detail');
      if (message.request.action === 'stop')
        throw new RuntimeControlError(
          'TESSIVEN_PERMISSION_DENIED',
          'Permission denied',
          403,
        );
      return { runtime_ref: message.request.runtime_ref };
    },
  );
  const connection = once(ws, 'connection');
  const host = connectTessivenHost(
    {
      protocol_version: 'redeven-runtime-control-v1',
      base_url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/owned/`,
      token: 'fixture-owner',
    },
    execute,
  );
  try {
    await host.ready;
    const [socket, request] = await connection;
    expect(request.url).toBe('/owned/v2/tessiven/host');
    expect(request.headers.authorization).toBe('Bearer fixture-owner');
    for (const action of ['inspect', 'stop', 'restart']) {
      const response = once(socket, 'message');
      socket.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          request: { runtime_ref: 'ssh:exact-fixture', action },
          permissions: {
            read: true,
            write: false,
            execute: false,
            admin: false,
          },
        }),
      );
      const [raw] = await response;
      const result = JSON.parse(raw.toString());
      if (action === 'inspect')
        expect(result.result.runtime_ref).toBe('ssh:exact-fixture');
      if (action === 'stop')
        expect(result).toMatchObject({
          code: 'TESSIVEN_PERMISSION_DENIED',
          status: 403,
        });
      if (action === 'restart') {
        expect(result.code).toBeUndefined();
        expect(result.error).not.toContain('private');
      }
    }
    expect(execute).toHaveBeenCalledTimes(3);
    const closed = once(socket, 'close');
    socket.send(
      JSON.stringify({
        id: crypto.randomUUID(),
        request: { runtime_ref: 'ssh:exact-fixture', action: 'shell' },
        permissions: { read: true, write: true, execute: true, admin: true },
      }),
    );
    await closed;
    expect(execute).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(host.active()).toBe(false));
  } finally {
    host.close();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
