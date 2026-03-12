// 流式文件读取工具函数，从 RemoteFileBrowser 提取共享

import type { Client } from '@floegence/flowersec-core';
import { openJsonFrameChannel, readNBytes, type JsonFrameChannel } from '@floegence/flowersec-core/streamio';
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

async function closeChannelBestEffort(channel: JsonFrameChannel): Promise<void> {
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
  client: Client;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ channel: JsonFrameChannel; meta: FsReadFileStreamRespMeta }> {
  const channel = await openJsonFrameChannel(params.client, redevenV1StreamKinds.fs.readFile);
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
  client: Client;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta }> {
  const { channel, meta } = await openReadFileStreamChannel(params);
  try {
    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    const bytes = cloneToOwnedBytes(await readNBytes(channel.reader, want));
    return { bytes, meta };
  } finally {
    await closeChannelBestEffort(channel);
  }
}
