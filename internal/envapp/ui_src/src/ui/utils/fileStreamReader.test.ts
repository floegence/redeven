import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFileByteStream, streamFileBytes } from './fileStreamReader';

const openJsonFrameChannelMock = vi.fn();
const readNBytesMock = vi.fn();

vi.mock('@floegence/flowersec-core/streamio', () => ({
  openJsonFrameChannel: (...args: unknown[]) => openJsonFrameChannelMock(...args),
  readNBytes: (...args: unknown[]) => readNBytesMock(...args),
}));

function createChannel(meta: Record<string, unknown>) {
  return {
    reader: { id: 'reader' },
    writeFrame: vi.fn(async () => undefined),
    readFrame: vi.fn(async () => meta),
    close: vi.fn(async () => undefined),
    stream: {
      reset: vi.fn(),
    },
  };
}

afterEach(() => {
  openJsonFrameChannelMock.mockReset();
  readNBytesMock.mockReset();
});

describe('fileStreamReader', () => {
  it('streams file bytes in configured chunks and closes the channel', async () => {
    const channel = createChannel({ ok: true, content_len: 5, file_size: 5 });
    openJsonFrameChannelMock.mockResolvedValue(channel);
    readNBytesMock.mockImplementation(async (_reader, size: number) => new Uint8Array(size));

    const chunks: Array<{ length: number; bytesRead: number }> = [];
    for await (const part of streamFileBytes({
      client: { id: 'client' } as any,
      path: '/workspace/app.log',
      chunkSize: 2,
    })) {
      chunks.push({ length: part.bytes.byteLength, bytesRead: part.bytesRead });
    }

    expect(channel.writeFrame).toHaveBeenCalledWith({
      path: '/workspace/app.log',
      offset: 0,
      max_bytes: 0,
    });
    expect(chunks).toEqual([
      { length: 2, bytesRead: 2 },
      { length: 2, bytesRead: 4 },
      { length: 1, bytesRead: 5 },
    ]);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('resets the stream when an abort signal interrupts consumption', async () => {
    const channel = createChannel({ ok: true, content_len: 4, file_size: 4 });
    const controller = new AbortController();
    openJsonFrameChannelMock.mockResolvedValue(channel);
    readNBytesMock.mockImplementation(async (_reader, size: number) => new Uint8Array(size));

    const stream = await openFileByteStream({
      client: { id: 'client' } as any,
      path: '/workspace/app.log',
      chunkSize: 2,
      signal: controller.signal,
    });
    controller.abort();

    await expect(async () => {
      for await (const _part of stream.chunks) {
        // No-op.
      }
    }).rejects.toThrow('Download canceled.');
    expect(channel.stream.reset).toHaveBeenCalledWith(expect.any(DOMException));
    expect(channel.close).toHaveBeenCalledTimes(1);
  });
});
