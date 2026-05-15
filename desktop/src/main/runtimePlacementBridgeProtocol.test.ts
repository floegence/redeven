import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  encodeRuntimePlacementBridgeFrame,
  readRuntimePlacementBridgeFrame,
} from './runtimePlacementBridgeProtocol';

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
});
