import net from 'node:net';

import type {
  RuntimePlacementBridgeSessionHandle,
} from './runtimePlacementBridgeSession';

export type RuntimePlacementLoopbackProxy = Readonly<{
  url: string;
  port: number;
  close: () => Promise<void>;
}>;

function localForwardURL(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

function normalizeRuntimeControlRequest(buffer: Buffer): Buffer {
  const text = buffer.toString('latin1');
  const marker = '\r\n';
  const firstLineEnd = text.indexOf(marker);
  if (firstLineEnd < 0) {
    return buffer;
  }
  const firstLine = text.slice(0, firstLineEnd);
  const match = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+\/__redeven_runtime_control(\/[^\s]*)?\s+(HTTP\/1\.[01])$/u.exec(firstLine);
  if (!match) {
    return buffer;
  }
  const nextPath = match[2] && match[2] !== '' ? match[2] : '/';
  return Buffer.from(`${match[1]} ${nextPath} ${match[3]}${text.slice(firstLineEnd)}`, 'latin1');
}

export async function startRuntimePlacementLoopbackProxy(
  bridge: RuntimePlacementBridgeSessionHandle,
): Promise<RuntimePlacementLoopbackProxy> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let opened = false;
    let headerBuffer = Buffer.alloc(0);

    const closeSocket = () => {
      sockets.delete(socket);
    };
    socket.once('close', closeSocket);

    const openStream = (firstChunk: Buffer) => {
      opened = true;
      const isRuntimeControl = firstChunk.toString('latin1', 0, Math.min(firstChunk.length, 128))
        .includes(' /__redeven_runtime_control');
      const stream = bridge.openStream(isRuntimeControl ? 'runtime_control' : 'local_ui');
      stream.onData((chunk) => {
        if (!socket.destroyed) {
          socket.write(chunk);
        }
      });
      stream.onClose(() => {
        if (!socket.destroyed) {
          socket.end();
        }
      });
      stream.onError((error) => {
        if (!socket.destroyed) {
          socket.destroy(error);
        }
      });
      socket.on('data', (chunk: Buffer) => {
        void stream.write(chunk);
      });
      socket.once('end', () => {
        void stream.close();
      });
      socket.once('error', () => {
        void stream.close();
      });
      void stream.write(isRuntimeControl ? normalizeRuntimeControlRequest(firstChunk) : firstChunk);
    };

    socket.on('data', (chunk: Buffer) => {
      if (opened) {
        return;
      }
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      if (!headerBuffer.includes(Buffer.from('\r\n'))) {
        return;
      }
      socket.pause();
      openStream(headerBuffer);
      socket.resume();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Runtime Placement loopback proxy did not expose a TCP port.');
  }
  return {
    url: localForwardURL(addr.port),
    port: addr.port,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
