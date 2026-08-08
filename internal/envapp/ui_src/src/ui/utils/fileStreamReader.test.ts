import { describe, expect, it, vi } from 'vitest';
import { openFileByteStream, streamFileBytes } from './fileStreamReader';

function createSession(meta: Record<string, unknown>, bytes: Uint8Array) {
  const body = new TextEncoder().encode(`${JSON.stringify(meta)}\n`);
  const firstRead = new Uint8Array(body.byteLength + bytes.byteLength);
  firstRead.set(body);
  firstRead.set(bytes, body.byteLength);
  let read = false;
  const stream = {
	read: vi.fn(async () => {
	  if (read) return null;
	  read = true;
	  return firstRead;
	}),
	write: vi.fn(async (data: Uint8Array) => data.byteLength),
	closeWrite: vi.fn(async () => undefined),
	reset: vi.fn(async () => undefined),
	close: vi.fn(async () => undefined),
  };
  const session = { openStream: vi.fn(async () => stream) };
  return { session, stream };
}

describe('fileStreamReader', () => {
  it('streams file bytes in configured chunks and closes the channel', async () => {
	const { session, stream } = createSession({ ok: true, content_len: 5, file_size: 5 }, new Uint8Array(5));

    const chunks: Array<{ length: number; bytesRead: number }> = [];
    for await (const part of streamFileBytes({
	  client: session as any,
      path: '/workspace/app.log',
      chunkSize: 2,
    })) {
      chunks.push({ length: part.bytes.byteLength, bytesRead: part.bytesRead });
    }

	expect(new TextDecoder().decode(stream.write.mock.calls[0]?.[0])).toBe('{"path":"/workspace/app.log","offset":0,"max_bytes":0}\n');
    expect(chunks).toEqual([
      { length: 2, bytesRead: 2 },
      { length: 2, bytesRead: 4 },
      { length: 1, bytesRead: 5 },
    ]);
	expect(stream.close).toHaveBeenCalledTimes(1);
  });

  it('resets the stream when an abort signal interrupts consumption', async () => {
	const { session, stream: byteStream } = createSession({ ok: true, content_len: 4, file_size: 4 }, new Uint8Array(4));
	const controller = new AbortController();

    const stream = await openFileByteStream({
	  client: session as any,
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
	expect(byteStream.reset).toHaveBeenCalledTimes(1);
	expect(byteStream.close).toHaveBeenCalledTimes(1);
  });
});
