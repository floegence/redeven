import net from 'node:net';

import type {
  RuntimePlacementBridgeSessionHandle,
} from './runtimePlacementBridgeSession';

const MAX_LOOPBACK_REQUEST_HEADER_BYTES = 64 * 1024;
const LOOPBACK_HEADER_TOO_LARGE_RESPONSE = Buffer.from(
  'HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  'latin1',
);
const LOOPBACK_BRIDGE_UNAVAILABLE_RESPONSE = Buffer.from(
  'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  'latin1',
);

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

function normalizeStreamError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function writeSocket(socket: net.Socket, chunk: Buffer): Promise<void> {
  if (socket.destroyed) {
    return;
  }
  if (socket.write(chunk)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off('drain', onDrain);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(normalizeStreamError(error));
    };
    socket.once('drain', onDrain);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

export async function startRuntimePlacementLoopbackProxy(
  bridge: RuntimePlacementBridgeSessionHandle,
): Promise<RuntimePlacementLoopbackProxy> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let headerBuffer = Buffer.alloc(0);

    const closeSocket = () => {
      sockets.delete(socket);
    };
    socket.once('close', closeSocket);
    socket.on('error', closeSocket);

    const openStream = (firstChunk: Buffer) => {
      const isRuntimeControl = firstChunk.toString('latin1', 0, Math.min(firstChunk.length, 128))
        .includes(' /__redeven_runtime_control');
      let stream: ReturnType<RuntimePlacementBridgeSessionHandle['openStream']>;
      try {
        stream = bridge.openStream(isRuntimeControl ? 'runtime_control' : 'local_ui');
      } catch {
        socket.end(LOOPBACK_BRIDGE_UNAVAILABLE_RESPONSE);
        return;
      }
      let bridgeWriteQueue = Promise.resolve();
      let closing = false;

      const closeBridgeStream = () => {
        if (closing) {
          return;
        }
        closing = true;
        void bridgeWriteQueue.finally(() => {
          void stream.close();
        });
      };

      const enqueueBridgeWrite = (chunk: Buffer) => {
        socket.pause();
        bridgeWriteQueue = bridgeWriteQueue
          .then(() => stream.write(chunk))
          .catch((error: unknown) => {
            if (!socket.destroyed) {
              socket.destroy(normalizeStreamError(error));
            }
          })
          .finally(() => {
            if (!socket.destroyed && !closing) {
              socket.resume();
            }
          });
      };

      stream.onData(async (chunk) => {
        try {
          await writeSocket(socket, chunk);
        } catch (error) {
          if (!socket.destroyed) {
            socket.destroy(normalizeStreamError(error));
          }
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
      socket.on('data', enqueueBridgeWrite);
      socket.once('end', closeBridgeStream);
      socket.once('error', closeBridgeStream);
      socket.once('close', closeBridgeStream);
      enqueueBridgeWrite(isRuntimeControl ? normalizeRuntimeControlRequest(firstChunk) : firstChunk);
    };

    const onInitialData = (chunk: Buffer) => {
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      if (headerBuffer.length > MAX_LOOPBACK_REQUEST_HEADER_BYTES) {
        socket.off('data', onInitialData);
        socket.end(LOOPBACK_HEADER_TOO_LARGE_RESPONSE);
        return;
      }
      if (!headerBuffer.includes(Buffer.from('\r\n'))) {
        return;
      }
      socket.off('data', onInitialData);
      socket.pause();
      openStream(headerBuffer);
    };
    socket.on('data', onInitialData);
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
