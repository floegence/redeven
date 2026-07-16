import { fetchLocalApiJSON } from './localApi';

export type CodeRuntimeDetectionState = 'ready' | 'missing' | 'unusable';
export type CodeRuntimeOperationAction = 'prepare_workspace_engine' | 'remove_local_environment_version' | '';
export type CodeRuntimeOperationState = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BrowserEditorInstallMethod = 'desktop_transfer' | 'remote_download';
export type CodeRuntimeOperationStage = 'preparing' | 'resolving_catalog' | 'receiving' | 'downloading' | 'verifying' | 'installing' | 'removing' | 'validating' | 'finalizing' | '';

export type CodeRuntimeTargetStatus = Readonly<{
  detection_state: CodeRuntimeDetectionState;
  present: boolean;
  source: string;
  binary_path?: string;
  version?: string;
  error_code?: string;
  error_message?: string;
}>;

export type CodeRuntimeInstalledVersion = Readonly<{
  version: string;
  binary_path?: string;
  installed_at_unix_ms?: number;
  selected_by_local_environment?: boolean;
  removable?: boolean;
  detection_state: CodeRuntimeDetectionState;
  error_message?: string;
}>;

export type CodeRuntimeOperationStatus = Readonly<{
  action?: CodeRuntimeOperationAction;
  operation_id?: string;
  install_method?: BrowserEditorInstallMethod;
  state: CodeRuntimeOperationState;
  stage?: CodeRuntimeOperationStage;
  target_version?: string;
  last_error?: string;
  last_error_code?: string;
  started_at_unix_ms?: number;
  finished_at_unix_ms?: number;
  log_tail?: string[];
  transfer?: Readonly<{
    received_bytes: number;
    expected_bytes: number;
    from_cache?: boolean;
  }>;
}>;

export type CodeRuntimeStatus = Readonly<{
  active_runtime: CodeRuntimeTargetStatus;
  managed_runtime: CodeRuntimeTargetStatus;
  managed_prefix: string;
  shared_runtime_root: string;
  managed_runtime_version?: string;
  managed_runtime_source: 'managed' | 'none';
  platform?: CodeRuntimePlatform;
  installed_versions: CodeRuntimeInstalledVersion[];
  operation: CodeRuntimeOperationStatus;
  updated_at_unix_ms: number;
}>;

export type CodeRuntimePlatform = Readonly<{
  os: string;
  arch: string;
  libc?: string;
  platform_id: string;
  supported?: boolean;
  unsupported_code?: string;
  message?: string;
}>;

type CodeRuntimeSetupOperationBase = Readonly<{
  operation_id: string;
}>;

export type CodeRuntimeDesktopTransferSetupOperation = CodeRuntimeSetupOperationBase & Readonly<{
  install_method: 'desktop_transfer';
  state: 'receiving';
  chunk_size_bytes: number;
  expected_bytes: number;
  received_bytes: number;
  next_chunk_index: number;
}>;

export type CodeRuntimeRemoteDownloadSetupOperation = CodeRuntimeSetupOperationBase & Readonly<{
  install_method: 'remote_download';
  state: 'running';
}>;

export type CodeRuntimeSetupOperation =
  | CodeRuntimeDesktopTransferSetupOperation
  | CodeRuntimeRemoteDownloadSetupOperation;

export type CodeRuntimeSetupChunkResult = Readonly<{
  operation_id: string;
  received_bytes: number;
  expected_bytes: number;
  next_chunk_index: number;
}>;

export async function fetchCodeRuntimeStatus(): Promise<CodeRuntimeStatus> {
  return fetchLocalApiJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/status', { method: 'GET' });
}

export async function createCodeRuntimeSetupOperation(args: Readonly<{
  operationID: string;
  installMethod: BrowserEditorInstallMethod;
  manifest?: unknown;
  signal?: AbortSignal;
}>): Promise<CodeRuntimeSetupOperation> {
  return normalizeCodeRuntimeSetupOperation(await fetchLocalApiJSON<CodeRuntimeSetupOperation>('/_redeven_proxy/api/code-runtime/setup-operations', {
    method: 'POST',
    signal: args.signal,
    body: JSON.stringify({
      operation_id: args.operationID,
      install_method: args.installMethod,
      ...(args.installMethod === 'desktop_transfer' ? { manifest: args.manifest } : {}),
    }),
  }));
}

export async function appendCodeRuntimeSetupChunk(
  operationID: string,
  chunkIndex: number,
  chunk: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<CodeRuntimeSetupChunkResult> {
  const cleanOperationID = encodeURIComponent(String(operationID ?? '').trim());
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error('Browser Editor setup chunk index must be a non-negative safe integer.');
  }
  const cleanChunkIndex = chunkIndex;
  return normalizeCodeRuntimeSetupChunkResult(await withCodeRuntimeChunkTimeout((timeoutSignal) => fetchLocalApiJSON<CodeRuntimeSetupChunkResult>(
    `/_redeven_proxy/api/code-runtime/setup-operations/${cleanOperationID}/chunks/${cleanChunkIndex}`,
    {
      method: 'PUT',
      signal: timeoutSignal,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: chunk,
    },
  ), signal));
}

export async function completeCodeRuntimeSetupOperation(operationID: string, signal?: AbortSignal): Promise<CodeRuntimeStatus> {
  const cleanOperationID = encodeURIComponent(String(operationID ?? '').trim());
  return fetchLocalApiJSON<CodeRuntimeStatus>(`/_redeven_proxy/api/code-runtime/setup-operations/${cleanOperationID}/complete`, {
    method: 'POST',
    signal,
  });
}

export async function cancelCodeRuntimeSetupOperation(operationID: string): Promise<CodeRuntimeStatus> {
  const cleanOperationID = encodeURIComponent(String(operationID ?? '').trim());
  return fetchLocalApiJSON<CodeRuntimeStatus>(`/_redeven_proxy/api/code-runtime/setup-operations/${cleanOperationID}/cancel`, {
    method: 'POST',
  });
}

export async function selectCodeRuntimeVersion(version: string): Promise<CodeRuntimeStatus> {
  return fetchLocalApiJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/select', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function removeCodeRuntimeVersion(version: string): Promise<CodeRuntimeStatus> {
  return fetchLocalApiJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/remove-version', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function cancelCodeRuntimeOperation(): Promise<CodeRuntimeStatus> {
  return fetchLocalApiJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/cancel', { method: 'POST' });
}

const CODE_RUNTIME_CHUNK_TIMEOUT_MS = 5 * 60 * 1000;

async function withCodeRuntimeChunkTimeout<T>(run: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CODE_RUNTIME_CHUNK_TIMEOUT_MS);
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new Error('The environment did not confirm the Browser Editor package chunk within 5 minutes.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
}

export function codeRuntimeReady(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.active_runtime.detection_state === 'ready' && status.operation.state !== 'running';
}

export function codeRuntimeMissing(status: CodeRuntimeStatus | null | undefined): boolean {
  const state = String(status?.active_runtime.detection_state ?? '').trim();
  return state === 'missing' || state === 'unusable';
}

export function codeRuntimeOperationRunning(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.operation.state === 'running';
}

export function codeRuntimeOperationSucceeded(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.operation.state === 'succeeded';
}

export function codeRuntimeOperationFailed(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.operation.state === 'failed';
}

export function codeRuntimeOperationCancelled(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.operation.state === 'cancelled';
}

export function codeRuntimeOperationNeedsAttention(status: CodeRuntimeStatus | null | undefined): boolean {
  return codeRuntimeOperationFailed(status) || codeRuntimeOperationCancelled(status);
}

export function codeRuntimeManagedInstalled(status: CodeRuntimeStatus | null | undefined): boolean {
  return (status?.installed_versions?.length ?? 0) > 0;
}

export function codeRuntimeManagedRuntimeSelected(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.active_runtime.source === 'managed' && status?.active_runtime.detection_state === 'ready';
}

export type CodeRuntimePrepareIntent = 'setup' | 'update' | 'retry';

export type CodeRuntimePrepareCopy = Readonly<{
  intent: CodeRuntimePrepareIntent;
  action_label: string;
  confirm_title: string;
  running_label: string;
  tooltip: string;
}>;

export function codeRuntimePrepareIntent(status: CodeRuntimeStatus | null | undefined): CodeRuntimePrepareIntent {
  if (codeRuntimeOperationNeedsAttention(status)) return 'retry';
  if (!codeRuntimeManagedInstalled(status)) return 'setup';
  return 'update';
}

export function codeRuntimePrepareCopy(status: CodeRuntimeStatus | null | undefined): CodeRuntimePrepareCopy {
  switch (codeRuntimePrepareIntent(status)) {
    case 'retry':
      return {
        intent: 'retry',
        action_label: 'Retry setup',
        confirm_title: 'Retry browser editor setup',
        running_label: 'Setting up browser editor...',
        tooltip: 'Retry setting up the browser editor for the connected environment.',
      };
    case 'update':
      return {
        intent: 'update',
        action_label: 'Update browser editor',
        confirm_title: 'Update browser editor',
        running_label: 'Updating browser editor...',
        tooltip: 'Download and send the latest browser editor package to the connected environment.',
      };
    case 'setup':
    default:
      return {
        intent: 'setup',
        action_label: 'Set up browser editor',
        confirm_title: 'Set up browser editor',
        running_label: 'Setting up browser editor...',
        tooltip: 'Set up the browser editor used by Codespaces in the connected environment.',
      };
  }
}

export function codeRuntimeManagedActionLabel(status: CodeRuntimeStatus | null | undefined): string {
  return codeRuntimePrepareCopy(status).action_label;
}

export function codeRuntimeStageLabel(stage: string | null | undefined, action?: string | null | undefined): string {
  const normalizedStage = String(stage ?? '').trim();
  if (String(action ?? '').trim() === 'remove_local_environment_version') {
    switch (normalizedStage) {
      case 'preparing':
        return 'Preparing editor version removal...';
      case 'removing':
        return 'Removing editor version files...';
      case 'validating':
        return 'Validating editor version removal...';
      case 'finalizing':
        return 'Finalizing editor version removal...';
      default:
        return 'Removing editor version...';
    }
  }

  switch (normalizedStage) {
    case 'preparing':
      return 'Preparing browser editor...';
    case 'resolving_catalog':
      return 'Checking the Browser Editor package catalog...';
    case 'receiving':
      return 'Sending browser editor to this environment...';
    case 'downloading':
      return 'This environment is downloading the Browser Editor...';
    case 'verifying':
      return 'Verifying browser editor...';
    case 'installing':
      return 'Installing browser editor...';
    case 'validating':
      return 'Validating browser editor...';
    case 'finalizing':
      return 'Finishing browser editor setup...';
    default:
      return 'Setting up browser editor...';
  }
}

export function codeRuntimePlatformForDesktop(status: CodeRuntimeStatus | null | undefined): CodeRuntimePlatform {
  const platform = status?.platform;
  const osName = String(platform?.os ?? '').trim();
  const arch = String(platform?.arch ?? '').trim();
  const libc = String(platform?.libc ?? '').trim();
  if (osName !== 'linux' && osName !== 'darwin') {
    throw new Error(platform?.message || 'This environment is not supported by the managed Browser Editor.');
  }
  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error(platform?.message || 'This environment architecture is not supported by the managed Browser Editor.');
  }
  if (osName === 'linux' && libc !== '' && libc !== 'glibc' && libc !== 'unknown') {
    throw new Error(platform?.message || 'This Linux environment is not supported by the managed Browser Editor.');
  }
  return {
    os: osName,
    arch,
    ...(osName === 'linux' && libc ? { libc } : {}),
    platform_id: String(platform?.platform_id ?? '').trim() || (osName === 'linux' ? `${osName}-${arch}-${libc || 'glibc'}` : `${osName}-${arch}`),
  };
}

function normalizeCodeRuntimeSetupOperation(value: unknown): CodeRuntimeSetupOperation {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const operationID = String(record.operation_id ?? '').trim();
  const installMethod = String(record.install_method ?? '').trim();
  const state = String(record.state ?? '').trim();
  if (!operationID || (installMethod !== 'desktop_transfer' && installMethod !== 'remote_download')) {
    throw new Error('Runtime did not return a valid Browser Editor setup operation.');
  }
  if (installMethod === 'remote_download') {
    if (state !== 'running') {
      throw new Error('Runtime did not return a valid Browser Editor setup operation.');
    }
    return {
      operation_id: operationID,
      install_method: installMethod,
      state,
    };
  }

  const chunkSizeBytes = Number(record.chunk_size_bytes);
  const expectedBytes = Number(record.expected_bytes);
  const receivedBytes = Number(record.received_bytes);
  const nextChunkIndex = Number(record.next_chunk_index);
  if (
    state !== 'receiving'
    || !Number.isSafeInteger(chunkSizeBytes)
    || chunkSizeBytes <= 0
    || !Number.isSafeInteger(expectedBytes)
    || expectedBytes <= 0
    || !Number.isSafeInteger(receivedBytes)
    || receivedBytes < 0
    || receivedBytes > expectedBytes
    || !Number.isSafeInteger(nextChunkIndex)
    || nextChunkIndex < 0
  ) {
    throw new Error('Runtime did not return a valid Browser Editor setup operation.');
  }
  return {
    operation_id: operationID,
    install_method: 'desktop_transfer',
    state,
    chunk_size_bytes: chunkSizeBytes,
    expected_bytes: expectedBytes,
    received_bytes: receivedBytes,
    next_chunk_index: nextChunkIndex,
  };
}

function normalizeCodeRuntimeSetupChunkResult(value: unknown): CodeRuntimeSetupChunkResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const operationID = String(record.operation_id ?? '').trim();
  const receivedBytes = Number(record.received_bytes);
  const expectedBytes = Number(record.expected_bytes);
  const nextChunkIndex = Number(record.next_chunk_index);
  if (
    !operationID
    || !Number.isSafeInteger(receivedBytes)
    || receivedBytes < 0
    || !Number.isSafeInteger(expectedBytes)
    || expectedBytes <= 0
    || receivedBytes > expectedBytes
    || !Number.isSafeInteger(nextChunkIndex)
    || nextChunkIndex < 0
  ) {
    throw new Error('Runtime did not return a valid Browser Editor setup chunk result.');
  }
  return {
    operation_id: operationID,
    received_bytes: receivedBytes,
    expected_bytes: expectedBytes,
    next_chunk_index: nextChunkIndex,
  };
}
