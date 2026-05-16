import net from 'node:net';

import { describe, expect, it } from 'vitest';

import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';
import { startRuntimePlacementLoopbackProxy } from './runtimePlacementLoopbackProxy';

async function waitForEventCount(events: readonly string[], count: number): Promise<void> {
  const deadline = Date.now() + 500;
  while (events.length < count && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

async function waitForValue<T>(read: () => T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 500;
  let value = read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    value = read();
  }
  return value;
}

async function readSocketUntilClose(socket: net.Socket): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.once('end', resolve);
    socket.once('close', resolve);
    socket.once('error', reject);
  });
  return Buffer.concat(chunks);
}

describe('runtimePlacementBridgeSession', () => {
  it('opens bridge streams before forwarding loopback data into them', async () => {
    const events: string[] = [];
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => {
        events.push(`open:${surface}`);
        return {
          id: `${surface}-1`,
          onData: () => undefined,
          onClose: () => undefined,
          onError: () => undefined,
          write: async (chunk) => {
            events.push(`data:${chunk.toString('latin1').split('\r\n', 1)[0]}`);
          },
          close: async () => {
            events.push('close');
          },
        };
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      await waitForEventCount(events, 2);
    } finally {
      socket.destroy();
      await proxy.close();
    }

    expect(events[0]).toBe('open:local_ui');
    expect(events[1]).toMatch(/^data:GET \//u);
  });

  it('routes provider-link runtime-control paths to the runtime-control bridge surface', async () => {
    const events: string[] = [];
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => {
        events.push(`open:${surface}`);
        return {
          id: `${surface}-1`,
          onData: () => undefined,
          onClose: () => undefined,
          onError: () => undefined,
          write: async (chunk) => {
            events.push(`data:${chunk.toString('latin1').split('\r\n', 1)[0]}`);
          },
          close: async () => undefined,
        };
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('POST /__redeven_runtime_control/v1/provider-link/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n');
      await waitForEventCount(events, 2);
    } finally {
      socket.destroy();
      await proxy.close();
    }

    expect(events[0]).toBe('open:runtime_control');
    expect(events[1]).toBe('data:POST /v1/provider-link/connect HTTP/1.1');
  });

  it('does not treat unprefixed provider-link paths as runtime-control fallbacks', async () => {
    const events: string[] = [];
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => {
        events.push(`open:${surface}`);
        return {
          id: `${surface}-1`,
          onData: () => undefined,
          onClose: () => undefined,
          onError: () => undefined,
          write: async (chunk) => {
            events.push(`data:${chunk.toString('latin1').split('\r\n', 1)[0]}`);
          },
          close: async () => undefined,
        };
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('POST /v1/provider-link/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n');
      await waitForEventCount(events, 2);
    } finally {
      socket.destroy();
      await proxy.close();
    }

    expect(events[0]).toBe('open:local_ui');
    expect(events[1]).toBe('data:POST /v1/provider-link/connect HTTP/1.1');
  });

  it('forwards a fragmented Env App response through the loopback bridge', async () => {
    const body = Buffer.from('env-app-response-'.repeat(4096));
    const response = Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`, 'latin1'),
      body,
    ]);
    const requests: string[] = [];
    let responseStarted = false;
    let dataCallback: ((chunk: Buffer) => void | Promise<void>) | null = null;
    let closeCallback: (() => void) | null = null;
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => {
        expect(surface).toBe('local_ui');
        return {
          id: `${surface}-1`,
          onData: (callback) => {
            dataCallback = callback;
          },
          onClose: (callback) => {
            closeCallback = callback;
          },
          onError: () => undefined,
          write: async (chunk) => {
            requests.push(chunk.toString('latin1').split('\r\n', 1)[0] ?? '');
            if (responseStarted) {
              return;
            }
            responseStarted = true;
            for (let offset = 0; offset < response.length; offset += 1024) {
              await dataCallback?.(response.subarray(offset, offset + 1024));
            }
            closeCallback?.();
          },
          close: async () => undefined,
        };
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      const received = await readSocketUntilClose(socket);

      expect(requests[0]).toMatch(/^GET \//u);
      expect(received.includes(body)).toBe(true);
      expect(received.toString('latin1', 0, 15)).toBe('HTTP/1.1 200 OK');
    } finally {
      socket.destroy();
      await proxy.close();
    }
  });

  it('rejects oversized loopback headers before opening a bridge stream', async () => {
    let opened = false;
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: () => {
        opened = true;
        throw new Error('bridge should not open');
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write(Buffer.from(`GET / HTTP/1.1 ${'x'.repeat(70 * 1024)}`, 'latin1'));
      const received = await readSocketUntilClose(socket);

      expect(opened).toBe(false);
      expect(received.toString('latin1')).toMatch(/^HTTP\/1\.1 431 /u);
    } finally {
      socket.destroy();
      await proxy.close();
    }
  });

  it('reports bridge unavailability as an HTTP transport failure', async () => {
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: () => {
        throw new Error('bridge closed');
      },
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      const received = await readSocketUntilClose(socket);

      expect(received.toString('latin1')).toMatch(/^HTTP\/1\.1 502 /u);
    } finally {
      socket.destroy();
      await proxy.close();
    }
  });

  it('serializes socket-to-bridge writes while the bridge stream is backpressured', async () => {
    const writes: string[] = [];
    const pendingWrites: Array<() => void> = [];
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => ({
        id: `${surface}-1`,
        onData: () => undefined,
        onClose: () => undefined,
        onError: () => undefined,
        write: async (chunk) => {
          writes.push(chunk.toString('latin1'));
          await new Promise<void>((resolve) => {
            pendingWrites.push(resolve);
          });
        },
        close: async () => undefined,
      }),
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 6\r\n\r\nabc');
      await waitForValue(() => writes.length, (count) => count === 1);

      socket.write('def');
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      expect(writes).toHaveLength(1);

      pendingWrites.shift()?.();
      await waitForValue(() => writes.length, (count) => count === 2);
      expect(writes[1]).toBe('def');
      pendingWrites.shift()?.();
    } finally {
      socket.destroy();
      pendingWrites.splice(0).forEach((resolve) => resolve());
      await proxy.close();
    }
  });

  it('closes the bridge stream when the loopback socket is destroyed', async () => {
    let closeCount = 0;
    const writes: string[] = [];
    const bridge: RuntimePlacementBridgeSessionHandle = {
      openStream: (surface) => ({
        id: `${surface}-1`,
        onData: () => undefined,
        onClose: () => undefined,
        onError: () => undefined,
        write: async (chunk) => {
          writes.push(chunk.toString('latin1'));
        },
        close: async () => {
          closeCount += 1;
        },
      }),
    };
    const proxy = await startRuntimePlacementLoopbackProxy(bridge);
    const socket = net.createConnection(proxy.port, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      await waitForValue(() => writes.length, (count) => count === 1);

      socket.destroy();
      await waitForValue(() => closeCount, (count) => count === 1);
      expect(closeCount).toBe(1);
    } finally {
      socket.destroy();
      await proxy.close();
    }
  });
});
