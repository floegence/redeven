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
const HTTP_HEADER_END = Buffer.from('\r\n\r\n', 'latin1');

export type RuntimePlacementLoopbackProxy = Readonly<{
  url: string;
  port: number;
  close: () => Promise<void>;
}>;

function localForwardURL(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

type RuntimePlacementLoopbackRoute = Readonly<{
  surface: 'local_ui' | 'runtime_control' | 'gateway_protocol';
  prefix: string;
}>;

class LoopbackHeaderTooLargeError extends Error {
  constructor() {
    super('Loopback request header is too large.');
    this.name = 'LoopbackHeaderTooLargeError';
  }
}

function routeForLoopbackFirstChunk(firstChunk: Buffer): RuntimePlacementLoopbackRoute {
  const requestHead = firstChunk.toString('latin1', 0, Math.min(firstChunk.length, 256));
  if (requestHead.includes(' /__redeven_runtime_gateway')) {
    return {
      surface: 'gateway_protocol',
      prefix: '/__redeven_runtime_gateway',
    };
  }
  if (requestHead.includes(' /__redeven_runtime_control')) {
    return {
      surface: 'runtime_control',
      prefix: '/__redeven_runtime_control',
    };
  }
  return {
    surface: 'local_ui',
    prefix: '',
  };
}

function normalizePrefixedRequestHeader(buffer: Buffer, prefix: string): Buffer {
  const firstLineEnd = buffer.indexOf('\r\n', 0, 'latin1');
  if (firstLineEnd < 0) {
    return buffer;
  }
  const text = buffer.toString('latin1');
  const firstLine = text.slice(0, firstLineEnd);
  const cleanPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\\s+${cleanPrefix}(/[^\\s]*)?\\s+(HTTP/1\\.[01])$`, 'u').exec(firstLine);
  if (!match) {
    return buffer;
  }
  const nextPath = match[2] && match[2] !== '' ? match[2] : '/';
  return Buffer.from(`${match[1]} ${nextPath} ${match[3]}${text.slice(firstLineEnd)}`, 'latin1');
}

function prefixedRequestContentLength(header: Buffer): number {
  const text = header.toString('latin1');
  const match = /\r\ncontent-length:\s*(\d+)\s*(?=\r\n)/iu.exec(text);
  if (!match) {
    return 0;
  }
  const length = Number(match[1]);
  return Number.isSafeInteger(length) && length > 0 ? length : 0;
}

function prefixedRequestNeedsRawTunnel(header: Buffer): boolean {
  const text = header.toString('latin1');
  return /\r\nconnection:[^\r\n]*\bupgrade\b/iu.test(text) &&
    /\r\nupgrade:\s*[^\r\n]+/iu.test(text);
}

class PrefixedRequestStreamNormalizer {
  private pendingHeader = Buffer.alloc(0);
  private remainingBodyBytes = 0;
  private rawTunnel = false;

  constructor(private readonly prefix: string) {}

  push(chunk: Buffer): Buffer[] {
    if (this.rawTunnel) {
      return [chunk];
    }
    let input = chunk;
    const output: Buffer[] = [];

    while (input.length > 0) {
      if (this.remainingBodyBytes > 0) {
        const bodyLength = Math.min(this.remainingBodyBytes, input.length);
        output.push(input.subarray(0, bodyLength));
        this.remainingBodyBytes -= bodyLength;
        input = input.subarray(bodyLength);
        continue;
      }

      this.pendingHeader = Buffer.concat([this.pendingHeader, input]);
      input = Buffer.alloc(0);

      while (this.pendingHeader.length > 0) {
        const headerEnd = this.pendingHeader.indexOf(HTTP_HEADER_END);
        if (headerEnd < 0) {
          if (this.pendingHeader.length > MAX_LOOPBACK_REQUEST_HEADER_BYTES) {
            throw new LoopbackHeaderTooLargeError();
          }
          break;
        }

        const headerLength = headerEnd + HTTP_HEADER_END.length;
        const header = this.pendingHeader.subarray(0, headerLength);
        const rest = this.pendingHeader.subarray(headerLength);
        output.push(normalizePrefixedRequestHeader(header, this.prefix));

        if (prefixedRequestNeedsRawTunnel(header)) {
          if (rest.length > 0) {
            output.push(rest);
          }
          this.pendingHeader = Buffer.alloc(0);
          this.rawTunnel = true;
          break;
        }

        // Runtime-control callers in Desktop use Content-Length. Keeping that
        // boundary explicit lets the proxy normalize each keep-alive request
        // without growing a general HTTP chunked-transfer parser here.
        const contentLength = prefixedRequestContentLength(header);
        const bodyLength = Math.min(contentLength, rest.length);
        if (bodyLength > 0) {
          output.push(rest.subarray(0, bodyLength));
        }
        this.remainingBodyBytes = contentLength - bodyLength;
        this.pendingHeader = rest.subarray(bodyLength);
        if (this.remainingBodyBytes > 0 || this.pendingHeader.length === 0) {
          break;
        }
      }
    }

    return output;
  }
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
      const route = routeForLoopbackFirstChunk(firstChunk);
      let stream: ReturnType<RuntimePlacementBridgeSessionHandle['openStream']>;
      try {
        stream = bridge.openStream(route.surface);
      } catch {
        socket.end(LOOPBACK_BRIDGE_UNAVAILABLE_RESPONSE);
        return;
      }
      const requestNormalizer = route.prefix ? new PrefixedRequestStreamNormalizer(route.prefix) : null;
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

      const enqueueBridgeChunks = (chunks: Buffer[]) => {
        if (chunks.length === 0) {
          if (!socket.destroyed && !closing) {
            socket.resume();
          }
          return;
        }
        socket.pause();
        bridgeWriteQueue = bridgeWriteQueue
          .then(async () => {
            for (const chunk of chunks) {
              await stream.write(chunk);
            }
          })
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
      const handleSocketData = (chunk: Buffer) => {
        try {
          enqueueBridgeChunks(requestNormalizer ? requestNormalizer.push(chunk) : [chunk]);
        } catch (error) {
          socket.off('data', handleSocketData);
          if (error instanceof LoopbackHeaderTooLargeError) {
            socket.end(LOOPBACK_HEADER_TOO_LARGE_RESPONSE);
          } else {
            socket.destroy(normalizeStreamError(error));
          }
          closeBridgeStream();
        }
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
      socket.on('data', handleSocketData);
      socket.once('end', closeBridgeStream);
      socket.once('error', closeBridgeStream);
      socket.once('close', closeBridgeStream);
      handleSocketData(firstChunk);
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
