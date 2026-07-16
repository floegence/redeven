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
import {
  browserEditorRuntimeTerminalResult,
  blockedBrowserEditorRuntimeSetupResult,
  observeBrowserEditorRuntimeOperation,
  startOrReconcileBrowserEditorRuntimeOperation,
  type BrowserEditorRuntimeOperationObserver,
  type BrowserEditorRuntimeSetupResult,
} from './browserEditorRuntimeOperation';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage?: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
  cancelWorkspaceEnginePreparation?: (request?: unknown) => Promise<DesktopCodeWorkspaceCancelResponse>;
  subscribeWorkspaceEngineProgress?: (listener: (progress: DesktopCodeWorkspaceProgress) => void) => () => void;
}

export type BrowserEditorDesktopTransferResult = BrowserEditorRuntimeSetupResult;

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
  await cancelCodeRuntimeSetupOperation(operationID);
}

function publishDesktopRuntimeStatus(
  status: CodeRuntimeStatus,
  operationID: string,
  observer: BrowserEditorRuntimeOperationObserver | undefined,
): void {
  if (
    status.operation.action !== 'prepare_workspace_engine'
    || status.operation.operation_id !== operationID
    || status.operation.install_method !== 'desktop_transfer'
  ) {
    throw new Error('The environment reported a different Browser Editor setup operation.');
  }
  observer?.onRuntimeStatus?.(status);
}

export async function prepareWorkspaceEngineWithDesktop(args: Readonly<{
  status?: CodeRuntimeStatus | null;
  operationID: string;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
  observer?: BrowserEditorRuntimeOperationObserver;
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
    const start = await startOrReconcileBrowserEditorRuntimeOperation({
      operationID: args.operationID,
      installMethod: 'desktop_transfer',
      manifest: job.manifest,
      signal: args.signal,
      observer: args.observer,
    });
    if (start.kind === 'blocked') return blockedBrowserEditorRuntimeSetupResult(start);
    if (start.kind === 'existing') {
      return observeBrowserEditorRuntimeOperation({
        identity: start.identity,
        initialStatus: start.status,
        signal: args.signal,
        observer: args.observer,
      });
    }
    const operation = start.operation;
    if (operation.install_method !== 'desktop_transfer') {
      throw new Error('Runtime did not create a Desktop transfer operation.');
    }
    runtimeOperationCreated = true;
    if (
      operation.expected_bytes !== job.archive_size_bytes
      || operation.received_bytes !== 0
      || operation.next_chunk_index !== 0
    ) {
      throw new Error('Runtime did not create the expected initial Desktop transfer cursor.');
    }
    publishDesktopRuntimeStatus(await fetchCodeRuntimeStatus(), args.operationID, args.observer);
    failureSource = 'desktop_upload';
    const chunkSize = Math.min(
      DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_SIZE_BYTES,
      operation.chunk_size_bytes,
      job.chunk_size_bytes,
    );
    let offset = 0;
    let chunkIndex = 0;
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
      if (
        progress.expected_bytes !== operation.expected_bytes
        || progress.received_bytes <= offset
        || progress.next_chunk_index !== chunkIndex + 1
      ) {
        throw new Error('Runtime returned an invalid Browser Editor upload cursor.');
      }
      offset = progress.received_bytes;
      chunkIndex = progress.next_chunk_index;
      publishDesktopRuntimeStatus(await fetchCodeRuntimeStatus(), args.operationID, args.observer);
    }
    if (offset !== job.archive_size_bytes) {
      throw new Error('Desktop did not finish reading the Browser Editor package.');
    }
    const finalStatus = await completeCodeRuntimeSetupOperation(args.operationID, args.signal);
    publishDesktopRuntimeStatus(finalStatus, args.operationID, args.observer);
    const terminalResult = browserEditorRuntimeTerminalResult(finalStatus, {
      operationID: args.operationID,
      installMethod: 'desktop_transfer',
    });
    if (!terminalResult) {
      throw new Error('Runtime did not finish the Desktop transfer operation.');
    }
    return terminalResult;
  } catch (error) {
    if (args.signal?.aborted) {
      return {
        state: 'cancelled',
        ok: false,
        prepared: false,
        cancelled: true,
        message: 'Browser Editor setup was canceled.',
      };
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
