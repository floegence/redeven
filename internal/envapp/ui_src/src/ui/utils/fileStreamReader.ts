// Shared streaming file reader utilities used by preview and downloads.

import type { ByteStream, Session } from '@floegence/flowersec-core';
import { redevenV1StreamKinds } from '../protocol/redeven_v1/streamKinds';

export type FsReadFileStreamMeta = {
  path: string;
  offset?: number;
  max_bytes?: number;
};

export type FsReadFileStreamRespMeta = {
  ok: boolean;
  file_size?: number;
  content_len?: number;
  truncated?: boolean;
  error?: {
    code: number;
    message?: string;
  };
};

export type ReadFileStreamChannel = Readonly<{
  stream: ByteStream;
  reader: Readonly<{ readExactly(length: number): Promise<Uint8Array> }>;
  writeFrame(value: unknown): Promise<void>;
  readFrame<T>(options: Readonly<{ assert(value: unknown): T }>): Promise<T>;
  close(): Promise<void>;
}>;

class BufferedByteStreamReader {
  private buffered = new Uint8Array(0);

  constructor(private readonly stream: ByteStream) {}

  private append(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    next.set(this.buffered);
    next.set(chunk, this.buffered.byteLength);
    this.buffered = next;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    const wanted = Math.max(0, Math.floor(length));
    while (this.buffered.byteLength < wanted) {
      const chunk = await this.stream.read();
      if (chunk === null) throw new Error('Unexpected end of file stream');
      this.append(chunk);
    }
    const result = this.buffered.slice(0, wanted);
    this.buffered = this.buffered.slice(wanted);
    return result;
  }

  async readJSONLine(maxBytes = 1 << 20): Promise<unknown> {
    for (;;) {
      const newline = this.buffered.indexOf(0x0a);
      if (newline >= 0) {
        const encoded = this.buffered.slice(0, newline);
        this.buffered = this.buffered.slice(newline + 1);
        return JSON.parse(new TextDecoder().decode(encoded));
      }
      if (this.buffered.byteLength >= maxBytes) throw new Error('File stream metadata is too large');
      const chunk = await this.stream.read();
      if (chunk === null) throw new Error('Unexpected end of file stream metadata');
      this.append(chunk);
    }
  }
}

async function openReadFileChannel(session: Session): Promise<ReadFileStreamChannel> {
  const stream = await session.openStream(redevenV1StreamKinds.fs.readFile);
  const reader = new BufferedByteStreamReader(stream);
  return {
    stream,
    reader,
    writeFrame: async (value) => {
      await stream.write(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
    },
    readFrame: async <T>(options: Readonly<{ assert(value: unknown): T }>) => options.assert(await reader.readJSONLine()),
    close: () => stream.close(),
  };
}

export function normalizeRespMeta(v: unknown): FsReadFileStreamRespMeta {
  if (v == null || typeof v !== 'object') throw new Error('Invalid response');
  const o = v as Record<string, unknown>;
  const ok = !!o.ok;
  const fileSize = typeof o.file_size === 'number' ? o.file_size : undefined;
  const contentLen = typeof o.content_len === 'number' ? o.content_len : undefined;
  const truncated = typeof o.truncated === 'boolean' ? o.truncated : undefined;
  const errRaw = o.error;
  const error =
    errRaw != null && typeof errRaw === 'object'
      ? {
          code: typeof (errRaw as any).code === 'number' ? (errRaw as any).code : 0,
          message: typeof (errRaw as any).message === 'string' ? (errRaw as any).message : undefined,
        }
      : undefined;
  return { ok, file_size: fileSize, content_len: contentLen, truncated, error };
}

async function closeChannelBestEffort(channel: ReadFileStreamChannel): Promise<void> {
  try {
    await channel.close();
  } catch {
  }
}

function cloneToOwnedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

export async function openReadFileStreamChannel(params: {
  client: Session;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ channel: ReadFileStreamChannel; meta: FsReadFileStreamRespMeta }> {
  const channel = await openReadFileChannel(params.client);
  try {
    const req: FsReadFileStreamMeta = {
      path: params.path,
      offset: params.offset ?? 0,
      max_bytes: params.maxBytes ?? 0,
    };
    await channel.writeFrame(req);

    const meta = await channel.readFrame<FsReadFileStreamRespMeta>({ assert: normalizeRespMeta });
    if (!meta.ok) {
      const code = meta.error?.code ?? 0;
      const msg = meta.error?.message ?? 'Failed to read file';
      throw new Error(code ? `${msg} (${code})` : msg);
    }

    return { channel, meta };
  } catch (error) {
    await closeChannelBestEffort(channel);
    throw error;
  }
}

export async function readFileBytesOnce(params: {
  client: Session;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta }> {
  const { channel, meta } = await openReadFileStreamChannel(params);
  try {
    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    const bytes = cloneToOwnedBytes(await channel.reader.readExactly(want));
    return { bytes, meta };
  } finally {
    await closeChannelBestEffort(channel);
  }
}

type StreamFileBytesParams = {
  client: Session;
  path: string;
  offset?: number;
  maxBytes?: number;
  chunkSize?: number;
  signal?: AbortSignal;
};

export async function openFileByteStream(params: StreamFileBytesParams): Promise<{
  meta: FsReadFileStreamRespMeta;
  chunks: AsyncGenerator<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta; bytesRead: number }, FsReadFileStreamRespMeta, void>;
}> {
  const { channel, meta } = await openReadFileStreamChannel(params);
  const chunkSize = Math.max(1, Math.floor(Number(params.chunkSize ?? 64 * 1024)));

  async function* chunks(): AsyncGenerator<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta; bytesRead: number }, FsReadFileStreamRespMeta, void> {
    let bytesRead = 0;
    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    try {
      while (bytesRead < want) {
        if (params.signal?.aborted) {
          throw new DOMException('Download canceled.', 'AbortError');
        }
        const remaining = want - bytesRead;
        const nextSize = Math.min(chunkSize, remaining);
        const bytes = cloneToOwnedBytes(await channel.reader.readExactly(nextSize));
        bytesRead += bytes.byteLength;
        yield { bytes, meta, bytesRead };
      }
      return meta;
    } finally {
      if (params.signal?.aborted) {
        try {
		  void channel.stream.reset();
        } catch {
        }
      }
      await closeChannelBestEffort(channel);
    }
  }

  return { meta, chunks: chunks() };
}

export async function* streamFileBytes(
  params: StreamFileBytesParams,
): AsyncGenerator<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta; bytesRead: number }, FsReadFileStreamRespMeta, void> {
  const stream = await openFileByteStream(params);
  for await (const part of stream.chunks) {
    yield part;
  }
  return stream.meta;
}
