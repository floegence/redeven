import {
  normalizeDesktopCodeWorkspacePackageChunkResponse,
  normalizeDesktopCodeWorkspacePackageDisposeResponse,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspacePrepareResponse,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspacePrepareResponse,
} from '../../../../../../desktop/src/shared/desktopCodeWorkspaceIPC';
import {
  appendCodeRuntimeImportChunk,
  codeRuntimePlatformForDesktop,
  completeCodeRuntimeImportSession,
  createCodeRuntimeImportSession,
  fetchCodeRuntimeStatus,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';
import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEngine?: (request?: unknown) => Promise<DesktopCodeWorkspacePrepareResponse>;
  prepareWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
}

export type WorkspaceEnginePrepareReason = 'open' | 'start' | 'settings' | 'retry';

declare global {
  interface Window {
    redevenDesktopCodeWorkspace?: DesktopCodeWorkspaceBridge;
  }
}

function isDesktopCodeWorkspaceBridge(candidate: unknown): candidate is DesktopCodeWorkspaceBridge {
  return Boolean(candidate && typeof candidate === 'object'
    && typeof (candidate as DesktopCodeWorkspaceBridge).prepareWorkspaceEngine === 'function');
}

function desktopCodeWorkspaceBridge(): DesktopCodeWorkspaceBridge | null {
  return readDesktopHostBridge('redevenDesktopCodeWorkspace', isDesktopCodeWorkspaceBridge);
}

export function desktopCodeWorkspacePrepareAvailable(): boolean {
  return desktopCodeWorkspaceBridge() !== null;
}

export async function prepareWorkspaceEngineInDesktop(reason: WorkspaceEnginePrepareReason): Promise<DesktopCodeWorkspacePrepareResponse> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.prepareWorkspaceEngine) {
    return {
      ok: false,
      prepared: false,
      message: 'Open this Environment in Redeven Desktop to prepare the workspace.',
    };
  }
  return normalizeDesktopCodeWorkspacePrepareResponse(
    await bridge.prepareWorkspaceEngine({ reason, prefer_session_upload: false }),
  );
}

export async function prepareWorkspaceEngineWithDesktop(args: Readonly<{
  reason: WorkspaceEnginePrepareReason;
  status?: CodeRuntimeStatus | null;
  preferSessionUpload?: boolean;
}>): Promise<DesktopCodeWorkspacePrepareResponse> {
  if (args.preferSessionUpload) {
    return prepareWorkspaceEngineThroughSession(args.status);
  }
  return prepareWorkspaceEngineInDesktop(args.reason);
}

export async function prepareWorkspaceEngineThroughSession(status?: CodeRuntimeStatus | null): Promise<DesktopCodeWorkspacePrepareResponse> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.prepareWorkspaceEnginePackage || !bridge.readWorkspaceEnginePackageChunk) {
    return {
      ok: false,
      prepared: false,
      message: 'Open this Environment in Redeven Desktop to prepare the workspace.',
    };
  }

  const runtimeStatus = status ?? await fetchCodeRuntimeStatus();
  const platform = codeRuntimePlatformForDesktop(runtimeStatus);
  const prepared = normalizeDesktopCodeWorkspacePackagePrepareResponse(await bridge.prepareWorkspaceEnginePackage({ platform }));
  const job = prepared.job;
  if (!prepared.ok || !job) {
    return {
      ok: false,
      prepared: false,
      message: prepared.message || 'Desktop could not prepare the workspace package.',
    };
  }

  try {
    const session = await createCodeRuntimeImportSession(job.manifest);
    const chunkSize = Math.max(1, Math.min(Math.floor(session.chunk_size_bytes || job.chunk_size_bytes), Math.floor(job.chunk_size_bytes)));
    let offset = 0;
    let chunkIndex = 0;
    while (offset < job.archive_size_bytes) {
      const chunkResp = normalizeDesktopCodeWorkspacePackageChunkResponse(await bridge.readWorkspaceEnginePackageChunk({
        job_id: job.job_id,
        offset_bytes: offset,
        length_bytes: Math.min(chunkSize, job.archive_size_bytes - offset),
      }));
      if (!chunkResp.ok || !chunkResp.chunk || chunkResp.length_bytes === undefined || chunkResp.length_bytes <= 0) {
        throw new Error(chunkResp.message || 'Desktop could not read the workspace package.');
      }
      await appendCodeRuntimeImportChunk(session.upload_id, chunkIndex, chunkResp.chunk);
      offset += chunkResp.length_bytes;
      chunkIndex += 1;
    }
    if (offset !== job.archive_size_bytes) {
      throw new Error('Desktop did not finish reading the workspace package.');
    }
    const finalStatus = await completeCodeRuntimeImportSession(session.upload_id);
    return {
      ok: true,
      prepared: true,
      status: finalStatus,
      message: job.from_cache ? 'Workspace engine was ready from Desktop cache.' : 'Workspace engine prepared.',
    };
  } finally {
    if (bridge.disposeWorkspaceEnginePackage) {
      try {
        normalizeDesktopCodeWorkspacePackageDisposeResponse(await bridge.disposeWorkspaceEnginePackage({ job_id: job.job_id }));
      } catch {
        // Package jobs expire in Desktop main; cleanup failure must not mask a completed preparation.
      }
    }
  }
}
