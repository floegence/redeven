import fs from 'node:fs/promises';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import {
  appendCodeWorkspaceEngineImportChunk,
  completeCodeWorkspaceEngineImportSession,
  createCodeWorkspaceEngineImportSession,
} from './runtimeControlClient';
import type { CodeWorkspaceEngineArtifactManifest } from './codeWorkspaceEnginePackageCache';

export const DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
export const DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT = 2 * 1024 * 1024 * 1024;

export type CodeWorkspaceEngineImportSession = Readonly<{
  upload_id: string;
  operation_id: string;
  chunk_size_bytes: number;
  expected_bytes: number;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function parseImportSession(data: unknown): CodeWorkspaceEngineImportSession {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const uploadID = compact(record.upload_id);
  const operationID = compact(record.operation_id) || uploadID;
  const chunkSizeBytes = Number(record.chunk_size_bytes);
  const expectedBytes = Number(record.expected_bytes);
  if (!uploadID || !Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0 || !Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    throw new Error('Runtime did not return a valid workspace preparation upload session.');
  }
  return {
    upload_id: uploadID,
    operation_id: operationID,
    chunk_size_bytes: Math.floor(chunkSizeBytes),
    expected_bytes: Math.floor(expectedBytes),
  };
}

export async function uploadCodeWorkspaceEngineViaRuntimeControl(args: Readonly<{
  endpoint: DesktopRuntimeControlEndpoint;
  manifest: CodeWorkspaceEngineArtifactManifest;
  archivePath: string;
  maxArchiveBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<{ completed_bytes: number; total_bytes: number }>) => void;
}>): Promise<unknown> {
  const stat = await fs.stat(args.archivePath);
  const archiveLimit = Math.max(1, Math.floor(args.maxArchiveBytes ?? DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT));
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('Workspace engine package is empty.');
  }
  if (stat.size > archiveLimit) {
    throw new Error(`Workspace engine package is too large (${stat.size} bytes).`);
  }
  const session = parseImportSession(await createCodeWorkspaceEngineImportSession(args.endpoint, {
    manifest: args.manifest,
  }, args.signal));
  const requestedChunkSize = Math.max(1, Math.floor(session.chunk_size_bytes || DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE));
  const chunkSize = Math.min(requestedChunkSize, DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_CHUNK_SIZE);
  const handle = await fs.open(args.archivePath, 'r');
  try {
    args.onProgress?.({ completed_bytes: 0, total_bytes: stat.size });
    const buffer = Buffer.alloc(chunkSize);
    let offset = 0;
    let chunkIndex = 0;
    while (offset < stat.size) {
      if (args.signal?.aborted) {
        throw new DOMException('Workspace engine package upload was canceled.', 'AbortError');
      }
      const length = Math.min(chunkSize, stat.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) {
        throw new Error('Workspace engine package upload stopped before all bytes were read.');
      }
      const progress = await appendCodeWorkspaceEngineImportChunk(
        args.endpoint,
        session.upload_id,
        chunkIndex,
        Buffer.from(buffer.subarray(0, bytesRead)),
        args.signal,
      );
      offset = progress.received_bytes;
      args.onProgress?.({
        completed_bytes: progress.received_bytes,
        total_bytes: progress.expected_bytes || stat.size,
      });
      chunkIndex = progress.next_chunk_index;
    }
  } finally {
    await handle.close();
  }
  return completeCodeWorkspaceEngineImportSession(args.endpoint, session.upload_id, args.signal);
}
