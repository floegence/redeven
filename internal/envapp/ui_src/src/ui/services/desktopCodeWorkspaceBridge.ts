import {
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
  normalizeDesktopCodeWorkspacePackageChunkResponse,
  normalizeDesktopCodeWorkspacePackageDisposeResponse,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspaceCancelResponse,
  type DesktopCodeWorkspaceCancelResponse,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspaceProgress,
} from '../../../../../../desktop/src/shared/desktopCodeWorkspaceIPC';
import {
  appendCodeRuntimeSetupChunk,
  cancelCodeRuntimeSetupOperation,
  codeRuntimePlatformForDesktop,
  completeCodeRuntimeSetupOperation,
  createCodeRuntimeSetupOperation,
  fetchCodeRuntimeStatus,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';
import { readDesktopHostBridge } from './desktopHostWindow';
import {
  browserEditorProgressFromDesktop,
  type BrowserEditorSetupProgress,
} from './browserEditorSetupProgress';
import {
  browserEditorSetupError,
  type BrowserEditorSetupFailureSource,
} from './browserEditorSetupError';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
  cancelWorkspaceEnginePreparation?: (request?: unknown) => Promise<DesktopCodeWorkspaceCancelResponse>;
  subscribeWorkspaceEngineProgress?: (listener: (progress: DesktopCodeWorkspaceProgress) => void) => () => void;
}

export type BrowserEditorDesktopTransferResult = Readonly<{
  ok: boolean;
  prepared: boolean;
  cancelled?: boolean;
  message?: string;
  status?: CodeRuntimeStatus;
}>;

declare global {
  interface Window {
    redevenDesktopCodeWorkspace?: DesktopCodeWorkspaceBridge;
  }
}

function isDesktopCodeWorkspaceBridge(candidate: unknown): candidate is DesktopCodeWorkspaceBridge {
  const bridge = candidate && typeof candidate === 'object' ? candidate as DesktopCodeWorkspaceBridge : null;
  return Boolean(
    bridge
    && typeof bridge.prepareWorkspaceEnginePackage === 'function'
    && typeof bridge.readWorkspaceEnginePackageChunk === 'function',
  );
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Browser Editor setup was canceled.', 'AbortError');
  }
}

async function terminateRuntimeSetupAfterDesktopFailure(operationID: string): Promise<void> {
  try {
    const status = await fetchCodeRuntimeStatus();
    if (status.operation.operation_id !== operationID || status.operation.state !== 'running') return;
  } catch {
    // The matched cancel request remains authoritative when status observation is unavailable.
  }
  await cancelCodeRuntimeSetupOperation(operationID);
}

export async function prepareWorkspaceEngineWithDesktop(args: Readonly<{
  status?: CodeRuntimeStatus | null;
  operationID: string;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
}>): Promise<BrowserEditorDesktopTransferResult> {
  const bridge = desktopCodeWorkspaceBridge();
  if (!bridge?.prepareWorkspaceEnginePackage || !bridge.readWorkspaceEnginePackageChunk) {
    throw browserEditorSetupError('desktop_upload', 'Desktop transfer is not available in this session.');
  }

  let runtimeStatus: CodeRuntimeStatus;
  try {
    runtimeStatus = args.status ?? await fetchCodeRuntimeStatus();
  } catch (error) {
    throw browserEditorSetupError('runtime_status', error);
  }
  const platform = codeRuntimePlatformForDesktop(runtimeStatus);
  const unsubscribe = subscribeToOperationProgress(bridge, args.operationID, args.onProgress);
  let jobID = '';
  let runtimeOperationCreated = false;
  let failureSource: BrowserEditorSetupFailureSource = 'desktop_package_cache';
  try {
    throwIfAborted(args.signal);
    const prepared = normalizeDesktopCodeWorkspacePackagePrepareResponse(await bridge.prepareWorkspaceEnginePackage({
      platform,
      operation_id: args.operationID,
    }));
    throwIfAborted(args.signal);
    const job = prepared.job;
    if (!prepared.ok || !job) {
      throw browserEditorSetupError(
        prepared.error_code ?? 'desktop_package_cache',
        prepared.message || 'Desktop could not prepare the Browser Editor package.',
      );
    }
    jobID = job.job_id;

    failureSource = 'runtime_import';
    const operation = await createCodeRuntimeSetupOperation({
      operationID: args.operationID,
      installMethod: 'desktop_transfer',
      manifest: job.manifest,
      signal: args.signal,
    });
    runtimeOperationCreated = true;
    failureSource = 'desktop_upload';
    const chunkSize = Math.max(1, Math.min(
      DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
      Math.floor(operation.chunk_size_bytes || DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES),
      Math.floor(job.chunk_size_bytes || DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES),
    ));
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
      throwIfAborted(args.signal);
      const chunkResponse = normalizeDesktopCodeWorkspacePackageChunkResponse(await bridge.readWorkspaceEnginePackageChunk({
        job_id: job.job_id,
        offset_bytes: offset,
        length_bytes: Math.min(chunkSize, job.archive_size_bytes - offset),
      }));
      throwIfAborted(args.signal);
      if (!chunkResponse.ok || !chunkResponse.chunk || !chunkResponse.length_bytes) {
        throw new Error(chunkResponse.message || 'Desktop could not read the Browser Editor package.');
      }
      const progress = await appendCodeRuntimeSetupChunk(
        args.operationID,
        chunkIndex,
        chunkResponse.chunk,
        args.signal,
      );
      if (progress.operation_id !== args.operationID) {
        throw new Error('The environment confirmed a different Browser Editor setup operation.');
      }
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
    const finalStatus = await completeCodeRuntimeSetupOperation(args.operationID, args.signal);
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
      message: job.from_cache
        ? 'Browser Editor package was ready from Desktop cache.'
        : 'Browser Editor package was transferred to the environment.',
    };
  } catch (error) {
    if (args.signal?.aborted) {
      return { ok: false, prepared: false, cancelled: true, message: 'Browser Editor setup was canceled.' };
    }
    if (runtimeOperationCreated) {
      try {
        await terminateRuntimeSetupAfterDesktopFailure(args.operationID);
      } catch (cleanupError) {
        const message = error instanceof Error ? error.message : String(error);
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw browserEditorSetupError(failureSource, `${message} Runtime setup cleanup failed: ${cleanupMessage}`);
      }
    }
    throw browserEditorSetupError(failureSource, error);
  } finally {
    unsubscribe();
    if (jobID && bridge.disposeWorkspaceEnginePackage) {
      try {
        normalizeDesktopCodeWorkspacePackageDisposeResponse(await bridge.disposeWorkspaceEnginePackage({ job_id: jobID }));
      } catch {
        // Desktop package jobs expire independently; disposal does not change the setup result.
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
