import type { Client } from '@floegence/flowersec-core';
import { DEFAULT_MAX_JSON_FRAME_BYTES, readJsonFrame, writeJsonFrame } from '@floegence/flowersec-core/framing';
import { redevenV1StreamKinds } from '../protocol/redeven_v1/streamKinds';
import { byteReaderFromStream } from './fileStreamReader';

export type GitReadCommitPatchStreamMeta = {
  repo_root_path: string;
  commit: string;
  file_path?: string;
  max_bytes?: number;
};

export type GitReadWorkspacePatchStreamMeta = {
  repo_root_path: string;
  section: string;
  file_path?: string;
  max_bytes?: number;
};

export type GitReadComparePatchStreamMeta = {
  repo_root_path: string;
  base_ref: string;
  target_ref: string;
  file_path?: string;
  max_bytes?: number;
};

export type GitReadPatchStreamRespMeta = {
  ok: boolean;
  content_len?: number;
  truncated?: boolean;
  error?: {
    code: number;
    message?: string;
  };
};

export function normalizeGitPatchRespMeta(value: unknown): GitReadPatchStreamRespMeta {
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

async function readGitPatchTextByStream(params: {
  client: Client;
  streamKind: string;
  request: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: GitReadPatchStreamRespMeta }> {
  const stream = await params.client.openStream(params.streamKind);
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

    await writeJsonFrame((bytes) => stream.write(bytes), params.request);

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

export async function readGitPatchTextOnce(params: {
  client: Client;
  repoRootPath: string;
  commit: string;
  filePath?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: GitReadPatchStreamRespMeta }> {
  const req: GitReadCommitPatchStreamMeta = {
    repo_root_path: params.repoRootPath,
    commit: params.commit,
    file_path: params.filePath,
    max_bytes: params.maxBytes,
  };
  return readGitPatchTextByStream({
    client: params.client,
    streamKind: redevenV1StreamKinds.git.readCommitPatch,
    request: req,
    signal: params.signal,
  });
}

export async function readWorkspaceGitPatchTextOnce(params: {
  client: Client;
  repoRootPath: string;
  section: string;
  filePath?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: GitReadPatchStreamRespMeta }> {
  const req: GitReadWorkspacePatchStreamMeta = {
    repo_root_path: params.repoRootPath,
    section: params.section,
    file_path: params.filePath,
    max_bytes: params.maxBytes,
  };
  return readGitPatchTextByStream({
    client: params.client,
    streamKind: redevenV1StreamKinds.git.readWorkspacePatch,
    request: req,
    signal: params.signal,
  });
}

export async function readCompareGitPatchTextOnce(params: {
  client: Client;
  repoRootPath: string;
  baseRef: string;
  targetRef: string;
  filePath?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; meta: GitReadPatchStreamRespMeta }> {
  const req: GitReadComparePatchStreamMeta = {
    repo_root_path: params.repoRootPath,
    base_ref: params.baseRef,
    target_ref: params.targetRef,
    file_path: params.filePath,
    max_bytes: params.maxBytes,
  };
  return readGitPatchTextByStream({
    client: params.client,
    streamKind: redevenV1StreamKinds.git.readComparePatch,
    request: req,
    signal: params.signal,
  });
}
