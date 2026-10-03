import { Duplex } from 'node:stream';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';

/** Adapt one owned Gateway bridge stream to Node HTTP/WebSocket without a TCP listener. */
export function openGatewayBridgeSocket(bridge: RuntimePlacementBridgeSessionHandle): Duplex {
  const stream = bridge.openStream('gateway_protocol');
  let resumeRead: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutMS = 0;
  const touch = () => {
    clearTimeout(timer);
    if (timeoutMS > 0) timer = setTimeout(() => socket.emit('timeout'), timeoutMS).unref();
  };
  const socket = new Duplex({
    read() { resumeRead?.(); resumeRead = undefined; },
    write(chunk: Buffer, _encoding, done) { touch(); void stream.write(chunk).then(() => done(), done); },
    final(done) { void Promise.resolve(stream.closeWrite?.()).then(() => done(), done); },
    destroy(error, done) {
      clearTimeout(timer);
      resumeRead?.(); resumeRead = undefined;
      void stream.close().then(() => done(error), closeError => done(error ?? closeError));
    },
  });
  // HTTP agents and ws request TCP tuning on custom sockets; the bridge owns it.
  Object.assign(socket, {
    setNoDelay: () => socket, setKeepAlive: () => socket,
    setTimeout: (ms: number, callback?: () => void) => {
      timeoutMS = ms;
      if (callback) socket.once('timeout', callback);
      touch();
      return socket;
    },
  });
  stream.onData(chunk => {
    touch();
    if (socket.destroyed || socket.push(chunk)) return;
    return new Promise<void>(resolve => { resumeRead = resolve; });
  });
  stream.onClose(() => { socket.push(null); });
  // Let Node consume an already complete HTTP response before a carrier reset.
  stream.onError(error => { setImmediate(() => socket.destroy(error)); });
  return socket;
}
