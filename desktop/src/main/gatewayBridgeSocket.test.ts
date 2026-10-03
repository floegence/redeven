import { once } from 'node:events';
import type net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { openGatewayBridgeSocket } from './gatewayBridgeSocket';
import type { RuntimePlacementBridgeStream } from './runtimePlacementBridgeSession';

function fixture() {
  let receive!: (chunk: Buffer) => void | Promise<void>;
  const stream: RuntimePlacementBridgeStream = {
    id: 'owned-stream', onData: callback => { receive = callback; }, onClose: () => {}, onError: () => {},
    write: vi.fn(async () => {}), closeWrite: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  const socket = openGatewayBridgeSocket({ openStream: () => stream });
  return { socket, stream, receive: (chunk: Buffer) => receive(chunk) };
}

describe('owned Gateway bridge socket', () => {
  it('backpressures inbound bytes and releases the bridge when the consumer closes', async () => {
    const { socket, stream, receive } = fixture();
    const pending = receive(Buffer.alloc(1024 * 1024));
    expect(pending).toBeInstanceOf(Promise);
    let consumed = false;
    void Promise.resolve(pending).then(() => { consumed = true; });
    await Promise.resolve();
    expect(consumed).toBe(false);
    const closed = once(socket, 'close');
    socket.destroy();
    await pending;
    await closed;
    expect(stream.close).toHaveBeenCalledTimes(1);
  });

  it('implements idle timeout for Node HTTP and WebSocket handshakes', async () => {
    const { socket } = fixture();
    const timedOut = once(socket, 'timeout');
    (socket as net.Socket).setTimeout(10);
    // Keep the test alive independently of the socket's unreferenced timeout.
    const timeout = setTimeout(() => socket.destroy(new Error('idle timeout did not fire')), 1000);
    try { await timedOut; } finally { clearTimeout(timeout); socket.destroy(); }
  });
});
