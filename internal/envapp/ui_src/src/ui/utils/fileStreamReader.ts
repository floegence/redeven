// 流式文件读取工具函数，从 RemoteFileBrowser 提取共享

import type { Client } from '@floegence/flowersec-core';
import { DEFAULT_MAX_JSON_FRAME_BYTES, readJsonFrame, writeJsonFrame } from '@floegence/flowersec-core/framing';
import { ByteReader, type YamuxStream } from '@floegence/flowersec-core/yamux';

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

export function byteReaderFromStream(stream: YamuxStream): ByteReader {
  return new ByteReader(async () => {
    try {
      return await stream.read();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'eof') return null;
      throw e;
    }
  });
}

export async function readFileBytesOnce(params: {
  client: Client;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta }> {
  const stream = await params.client.openStream('fs/read_file');
  const reader = byteReaderFromStream(stream);
  try {
    const req: FsReadFileStreamMeta = {
      path: params.path,
      offset: params.offset ?? 0,
      max_bytes: params.maxBytes ?? 0,
    };
    await writeJsonFrame((b) => stream.write(b), req);

    const metaRaw = await readJsonFrame((n) => reader.readExactly(n), DEFAULT_MAX_JSON_FRAME_BYTES);
    const meta = normalizeRespMeta(metaRaw);
    if (!meta.ok) {
      const code = meta.error?.code ?? 0;
      const msg = meta.error?.message ?? 'Failed to read file';
      throw new Error(code ? `${msg} (${code})` : msg);
    }

    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    const out = new Uint8Array(new ArrayBuffer(want));
    let off = 0;
    while (off < want) {
      const take = Math.min(64 * 1024, want - off);
      const chunk = await reader.readExactly(take);
      out.set(chunk, off);
      off += chunk.length;
    }
    return { bytes: out, meta };
  } finally {
    try {
      await stream.close();
    } catch {
    }
  }
}
