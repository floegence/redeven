import type { Client } from '@floegence/flowersec-core';
import { DEFAULT_MAX_JSON_FRAME_BYTES, readJsonFrame, writeJsonFrame } from '@floegence/flowersec-core/framing';
import { byteReaderFromStream } from './fileStreamReader';

export type GitReadCommitPatchStreamMeta = {
  repo_root_path: string;
  commit: string;
  file_path?: string;
  max_bytes?: number;
};

export type GitReadCommitPatchStreamRespMeta = {
  ok: boolean;
  content_len?: number;
  truncated?: boolean;
  error?: {
    code: number;
    message?: string;
  };
};

export function normalizeGitPatchRespMeta(value: unknown): GitReadCommitPatchStreamRespMeta {
  if (value == null || typeof value !== 'object') {
    throw new Error('Invalid response');
  }
  const rec = value as Record<string, unknown>;
  const errorRaw = rec.error;
  const error =
    errorRaw != null && typeof errorRaw === 'object'
      ? {
          code: typeof (errorRaw as any).code === 'number' ? (errorRaw as any).code : 0,
          message: typeof (errorRaw as any).message === 'string' ? (errorRaw as any).message : undefined,
        }
      : undefined;
  return {
    ok: Boolean(rec.ok),
    content_len: typeof rec.content_len === 'number' ? rec.content_len : undefined,
    truncated: typeof rec.truncated === 'boolean' ? rec.truncated : undefined,
    error,
  };
}

export async function readGitPatchTextOnce(params: {
  client: Client;
  repoRootPath: string;
  commit: string;
  filePath?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: GitReadCommitPatchStreamRespMeta }> {
  const stream = await params.client.openStream('git/read_commit_patch');
  const reader = byteReaderFromStream(stream);
  let abortHandler: (() => void) | undefined;

  try {
    if (params.signal?.aborted) {
      throw new Error('aborted');
    }
    if (params.signal) {
      abortHandler = () => {
        try {
          stream.reset(new Error('aborted'));
        } catch {
        }
        try {
          void stream.close();
        } catch {
        }
      };
      params.signal.addEventListener('abort', abortHandler, { once: true });
    }

    const req: GitReadCommitPatchStreamMeta = {
      repo_root_path: params.repoRootPath,
      commit: params.commit,
      file_path: params.filePath,
      max_bytes: params.maxBytes,
    };
    await writeJsonFrame((bytes) => stream.write(bytes), req);

    const metaRaw = await readJsonFrame((n) => reader.readExactly(n), DEFAULT_MAX_JSON_FRAME_BYTES);
    const meta = normalizeGitPatchRespMeta(metaRaw);
    if (!meta.ok) {
      const code = meta.error?.code ?? 0;
      const message = meta.error?.message ?? 'Failed to read patch';
      throw new Error(code ? `${message} (${code})` : message);
    }

    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    const out = new Uint8Array(new ArrayBuffer(want));
    let offset = 0;
    while (offset < want) {
      const take = Math.min(64 * 1024, want - offset);
      const chunk = await reader.readExactly(take);
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      text: new TextDecoder().decode(out),
      meta,
    };
  } finally {
    if (params.signal && abortHandler) {
      params.signal.removeEventListener('abort', abortHandler);
    }
    try {
      await stream.close();
    } catch {
    }
  }
}
