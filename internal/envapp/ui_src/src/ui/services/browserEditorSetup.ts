import {
  cancelCodeRuntimeSetupOperation,
  createCodeRuntimeSetupOperation,
  fetchCodeRuntimeStatus,
  type BrowserEditorInstallMethod,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';
import {
  cancelWorkspaceEnginePreparation,
  desktopCodeWorkspacePrepareAvailable,
  prepareWorkspaceEngineWithDesktop,
} from './desktopCodeWorkspaceBridge';
import type { BrowserEditorSetupProgress } from './browserEditorSetupProgress';
import {
  browserEditorRuntimeFailureSource,
  browserEditorSetupError,
} from './browserEditorSetupError';

export type BrowserEditorSetupResult = Readonly<{
  ok: boolean;
  prepared: boolean;
  cancelled?: boolean;
  message?: string;
  status?: CodeRuntimeStatus;
}>;

export function defaultBrowserEditorInstallMethod(): BrowserEditorInstallMethod {
  return desktopCodeWorkspacePrepareAvailable() ? 'desktop_transfer' : 'remote_download';
}

export function browserEditorInstallMethodAvailable(method: BrowserEditorInstallMethod): boolean {
  return method === 'remote_download' || desktopCodeWorkspacePrepareAvailable();
}

export async function prepareBrowserEditorSetup(args: Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
  status?: CodeRuntimeStatus | null;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserEditorSetupProgress) => void;
}>): Promise<BrowserEditorSetupResult> {
  if (args.installMethod === 'desktop_transfer') {
    return prepareWorkspaceEngineWithDesktop({
      operationID: args.operationID,
      status: args.status,
      signal: args.signal,
      onProgress: args.onProgress,
    });
  }

  try {
    await createCodeRuntimeSetupOperation({
      operationID: args.operationID,
      installMethod: 'remote_download',
      signal: args.signal,
    });
  } catch (error) {
    throw browserEditorSetupError('runtime_status', error);
  }
  return waitForBrowserEditorSetupOperation(args.operationID, args.signal);
}

export async function cancelBrowserEditorSetup(
  operationID: string,
  installMethod: BrowserEditorInstallMethod,
): Promise<void> {
  const requests: Promise<unknown>[] = [cancelCodeRuntimeSetupOperation(operationID)];
  if (installMethod === 'desktop_transfer') {
    requests.push(cancelWorkspaceEnginePreparation(operationID).then((result) => {
      if (!result.ok) {
        throw new Error(result.message || 'Desktop could not cancel Browser Editor package preparation.');
      }
      return result;
    }));
  }
  const results = await Promise.allSettled(requests);
  const failures = results.flatMap((result) => (
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : []
  ));
  if (failures.length > 0) {
    throw new Error(failures.join(' '));
  }
}

async function waitForBrowserEditorSetupOperation(operationID: string, signal?: AbortSignal): Promise<BrowserEditorSetupResult> {
  for (;;) {
    if (signal?.aborted) {
      return { ok: false, prepared: false, cancelled: true, message: 'Browser Editor setup was canceled.' };
    }
    let status: CodeRuntimeStatus;
    try {
      status = await fetchCodeRuntimeStatus();
    } catch {
      // Status polling is observation only; the Runtime operation remains the source of truth.
      await waitForNextStatusPoll(signal);
      continue;
    }
    const operation = status.operation;
    if (operation.operation_id !== operationID) {
      throw browserEditorSetupError('runtime_status', 'The environment reported a different Browser Editor setup operation.');
    }
    switch (operation.state) {
      case 'succeeded':
        return { ok: true, prepared: true, status };
      case 'failed':
        throw browserEditorSetupError(
          browserEditorRuntimeFailureSource(operation.last_error_code, 'remote_download'),
          operation.last_error || 'The environment could not install the Browser Editor.',
        );
      case 'cancelled':
        return { ok: false, prepared: false, cancelled: true, status, message: 'Browser Editor setup was canceled.' };
      default:
        break;
    }
    await waitForNextStatusPoll(signal);
  }
}

function waitForNextStatusPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, 750);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
