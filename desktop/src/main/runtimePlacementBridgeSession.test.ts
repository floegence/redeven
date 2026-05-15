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

  it('routes runtime-control loopback paths to the runtime-control bridge surface', async () => {
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
      socket.write('POST /__redeven_runtime_control/v1/status HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n');
      await waitForEventCount(events, 2);
    } finally {
      socket.destroy();
      await proxy.close();
    }

    expect(events[0]).toBe('open:runtime_control');
    expect(events[1]).toBe('data:POST /v1/status HTTP/1.1');
  });
});
