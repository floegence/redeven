import {
  normalizeDesktopCodeWorkspacePackageChunkResponse,
  normalizeDesktopCodeWorkspacePackageDisposeResponse,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspaceCancelResponse,
  normalizeDesktopCodeWorkspacePrepareResponse,
  type DesktopCodeWorkspaceCancelResponse,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspacePrepareResponse,
  type DesktopCodeWorkspaceProgress,
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
import {
  browserEditorProgressFromDesktop,
  type BrowserEditorSetupProgress,
} from './browserEditorSetupProgress';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEngine?: (request?: unknown) => Promise<DesktopCodeWorkspacePrepareResponse>;
  prepareWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
  cancelWorkspaceEnginePreparation?: (request?: unknown) => Promise<DesktopCodeWorkspaceCancelResponse>;
  subscribeWorkspaceEngineProgress?: (listener: (progress: DesktopCodeWorkspaceProgress) => void) => () => void;
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

function subscribeToOperationProgress(
  bridge: DesktopCodeWorkspaceBridge,
  operationID: string,
  onProgress: ((progress: BrowserEditorSetupProgress) => void) | undefined,
): () => void {
  if (!onProgress || !bridge.subscribeWorkspaceEngineProgress) return () => undefined;
  return bridge.subscribeWorkspaceEngineProgress((progress) => {
    if (progress.operation_id !== operationID) return;
    onProgress(browserEditorProgressFromDesktop(progress));
  });
}

export async function prepareWorkspaceEngineInDesktop(args: Readonly<{
  reason: WorkspaceEnginePrepareReason;
  operationID: string;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
}>): Promise<DesktopCodeWorkspacePrepareResponse> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.prepareWorkspaceEngine) {
    return {
      ok: false,
      prepared: false,
      message: 'Open this environment in Redeven Desktop to set up Browser Editor.',
    };
  }
  const unsubscribe = subscribeToOperationProgress(bridge, args.operationID, args.onProgress);
  try {
    return normalizeDesktopCodeWorkspacePrepareResponse(
      await bridge.prepareWorkspaceEngine({ reason: args.reason, prefer_session_upload: false, operation_id: args.operationID }),
    );
  } finally {
    unsubscribe();
  }
}

export async function prepareWorkspaceEngineWithDesktop(args: Readonly<{
  reason: WorkspaceEnginePrepareReason;
  status?: CodeRuntimeStatus | null;
  preferSessionUpload?: boolean;
  operationID: string;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
}>): Promise<DesktopCodeWorkspacePrepareResponse> {
  if (args.preferSessionUpload) {
    return prepareWorkspaceEngineThroughSession(args);
  }
  return prepareWorkspaceEngineInDesktop(args);
}

export async function prepareWorkspaceEngineThroughSession(args: Readonly<{
  status?: CodeRuntimeStatus | null;
  operationID: string;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
}>): Promise<DesktopCodeWorkspacePrepareResponse> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.prepareWorkspaceEnginePackage || !bridge.readWorkspaceEnginePackageChunk) {
    return {
      ok: false,
      prepared: false,
      message: 'Open this environment in Redeven Desktop to set up Browser Editor.',
    };
  }

  const runtimeStatus = args.status ?? await fetchCodeRuntimeStatus();
  const platform = codeRuntimePlatformForDesktop(runtimeStatus);
  const unsubscribe = subscribeToOperationProgress(bridge, args.operationID, args.onProgress);
  const prepared = normalizeDesktopCodeWorkspacePackagePrepareResponse(await bridge.prepareWorkspaceEnginePackage({
    platform,
    operation_id: args.operationID,
  }));
  const job = prepared.job;
  if (!prepared.ok || !job) {
    unsubscribe();
    return {
      ok: false,
      prepared: false,
      message: prepared.message || 'Desktop could not prepare the Browser Editor package.',
    };
  }

  try {
    const session = await createCodeRuntimeImportSession(job.manifest);
    const chunkSize = Math.max(1, Math.min(Math.floor(session.chunk_size_bytes || job.chunk_size_bytes), Math.floor(job.chunk_size_bytes)));
    let offset = 0;
    let chunkIndex = 0;
    args.onProgress?.({
      operation_id: args.operationID,
      phase: 'upload',
      state: 'running',
      completed_bytes: 0,
      total_bytes: job.archive_size_bytes,
      updated_at_unix_ms: Date.now(),
    });
    while (offset < job.archive_size_bytes) {
      const chunkResp = normalizeDesktopCodeWorkspacePackageChunkResponse(await bridge.readWorkspaceEnginePackageChunk({
        job_id: job.job_id,
        offset_bytes: offset,
        length_bytes: Math.min(chunkSize, job.archive_size_bytes - offset),
      }));
      if (!chunkResp.ok || !chunkResp.chunk || chunkResp.length_bytes === undefined || chunkResp.length_bytes <= 0) {
        throw new Error(chunkResp.message || 'Desktop could not read the Browser Editor package.');
      }
      const progress = await appendCodeRuntimeImportChunk(session.upload_id, chunkIndex, chunkResp.chunk);
      offset = progress.received_bytes;
      chunkIndex = progress.next_chunk_index;
      args.onProgress?.({
        operation_id: args.operationID,
        phase: 'upload',
        state: 'running',
        completed_bytes: offset,
        total_bytes: progress.expected_bytes || job.archive_size_bytes,
        updated_at_unix_ms: Date.now(),
      });
    }
    if (offset !== job.archive_size_bytes) {
      throw new Error('Desktop did not finish reading the Browser Editor package.');
    }
    const finalStatus = await completeCodeRuntimeImportSession(session.upload_id);
    args.onProgress?.({
      operation_id: args.operationID,
      phase: 'upload',
      state: 'completed',
      completed_bytes: offset,
      total_bytes: job.archive_size_bytes,
      updated_at_unix_ms: Date.now(),
    });
    return {
      ok: true,
      prepared: true,
      status: finalStatus,
      message: job.from_cache ? 'Browser Editor package was ready from Desktop cache.' : 'Browser Editor package prepared.',
    };
  } finally {
    unsubscribe();
    if (bridge.disposeWorkspaceEnginePackage) {
      try {
        normalizeDesktopCodeWorkspacePackageDisposeResponse(await bridge.disposeWorkspaceEnginePackage({ job_id: job.job_id }));
      } catch {
        // Package jobs expire in Desktop main; cleanup failure must not mask a completed preparation.
      }
    }
  }
}

export async function cancelWorkspaceEnginePreparation(operationID: string): Promise<DesktopCodeWorkspaceCancelResponse> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.cancelWorkspaceEnginePreparation) {
    return { ok: true, cancelled: false };
  }
  return normalizeDesktopCodeWorkspaceCancelResponse(
    await bridge.cancelWorkspaceEnginePreparation({ operation_id: operationID }),
  );
}
