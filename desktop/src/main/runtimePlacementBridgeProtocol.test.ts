import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  encodeRuntimePlacementBridgeFrame,
  readRuntimePlacementBridgeFrame,
  writeRuntimePlacementBridgeFrame,
} from './runtimePlacementBridgeProtocol';

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function waitListenerCounts(stream: PassThrough): Record<string, number> {
  return {
    readable: stream.listenerCount('readable'),
    end: stream.listenerCount('end'),
    close: stream.listenerCount('close'),
    error: stream.listenerCount('error'),
  };
}

class DeferredWritable extends Writable {
  private readonly pendingWrites: Array<() => void> = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.pendingWrites.push(() => callback());
  }

  flushOne(): void {
    const complete = this.pendingWrites.shift();
    complete?.();
  }
}

describe('runtimePlacementBridgeProtocol', () => {
  it('round-trips length-prefixed frames with binary payloads', async () => {
    const stream = new PassThrough();
    stream.end(encodeRuntimePlacementBridgeFrame({
      type: 'stream_data',
      stream_id: 'local-ui-1',
      payload: Buffer.from([0, 1, 2, 255]),
    }));

    await expect(readRuntimePlacementBridgeFrame(stream)).resolves.toEqual({
      header: {
        protocol_version: 'redeven-desktop-bridge-v1',
        stream_id: 'local-ui-1',
        type: 'stream_data',
        payload_bytes: 4,
      },
      payload: Buffer.from([0, 1, 2, 255]),
    });
  });

  it('returns null instead of hanging when the bridge closes before a full frame arrives', async () => {
    const stream = new PassThrough();
    const readTask = readRuntimePlacementBridgeFrame(stream);
    stream.write(Buffer.from([0, 0, 0, 24]));
    stream.end();

    await expect(readTask).resolves.toBeNull();
  });

  it('does not retain stream wait listeners while reading fragmented frame traffic', async () => {
    const stream = new PassThrough();

    for (let i = 0; i < 32; i += 1) {
      const encoded = encodeRuntimePlacementBridgeFrame({
        type: 'stream_data',
        stream_id: `local-ui-${i}`,
        payload: Buffer.from(`chunk-${i}`),
      });
      const readTask = readRuntimePlacementBridgeFrame(stream);
      await nextTurn();
      stream.write(encoded.subarray(0, 1));
      await nextTurn();
      stream.write(encoded.subarray(1, 8));
      await nextTurn();
      stream.write(encoded.subarray(8));

      const frame = await readTask;
      expect(frame?.header.stream_id).toBe(`local-ui-${i}`);
      expect(frame?.payload.toString('utf8')).toBe(`chunk-${i}`);
      expect(waitListenerCounts(stream)).toEqual({
        readable: 0,
        end: 0,
        close: 0,
        error: 0,
      });
    }
  });

  it('cleans writer wait listeners after backpressured frame writes drain', async () => {
    const stream = new DeferredWritable();
    const writeTask = writeRuntimePlacementBridgeFrame(stream, {
      type: 'stream_data',
      stream_id: 'local-ui-1',
      payload: Buffer.alloc(2048, 7),
    });

    await nextTurn();
    expect(stream.listenerCount('drain')).toBe(1);
    expect(stream.listenerCount('close')).toBe(1);
    expect(stream.listenerCount('error')).toBe(1);

    stream.flushOne();
    await expect(writeTask).resolves.toBeUndefined();
    expect(stream.listenerCount('drain')).toBe(0);
    expect(stream.listenerCount('close')).toBe(0);
    expect(stream.listenerCount('error')).toBe(0);
  });
});
