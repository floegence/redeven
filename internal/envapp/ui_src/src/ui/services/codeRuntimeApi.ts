import { fetchGatewayJSON } from './gatewayApi';

export type CodeRuntimeDetectionState = 'ready' | 'missing' | 'unusable';
export type CodeRuntimeOperationAction = 'prepare_workspace_engine' | 'remove_local_environment_version' | '';
export type CodeRuntimeOperationState = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type CodeRuntimeOperationStage = 'preparing' | 'receiving' | 'verifying' | 'installing' | 'removing' | 'validating' | 'finalizing' | '';

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
  state: CodeRuntimeOperationState;
  stage?: CodeRuntimeOperationStage;
  target_version?: string;
  last_error?: string;
  last_error_code?: string;
  started_at_unix_ms?: number;
  finished_at_unix_ms?: number;
  log_tail?: string[];
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

export type CodeRuntimeImportSession = Readonly<{
  upload_id: string;
  operation_id: string;
  chunk_size_bytes: number;
  expected_bytes: number;
}>;

export type CodeRuntimeImportChunkResult = Readonly<{
  upload_id: string;
  received_bytes: number;
  expected_bytes: number;
  next_chunk_index: number;
}>;

export async function fetchCodeRuntimeStatus(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/status', { method: 'GET' });
}

export async function createCodeRuntimeImportSession(manifest: unknown): Promise<CodeRuntimeImportSession> {
  return normalizeCodeRuntimeImportSession(await fetchGatewayJSON<CodeRuntimeImportSession>('/_redeven_proxy/api/code-runtime/import-sessions', {
    method: 'POST',
    body: JSON.stringify({ manifest }),
  }));
}

export async function appendCodeRuntimeImportChunk(uploadID: string, chunkIndex: number, chunk: Uint8Array<ArrayBuffer>): Promise<CodeRuntimeImportChunkResult> {
  const cleanUploadID = encodeURIComponent(String(uploadID ?? '').trim());
  const cleanChunkIndex = Math.max(0, Math.floor(chunkIndex));
  return normalizeCodeRuntimeImportChunkResult(await fetchGatewayJSON<CodeRuntimeImportChunkResult>(
    `/_redeven_proxy/api/code-runtime/import-sessions/${cleanUploadID}/chunks/${cleanChunkIndex}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: chunk,
    },
  ));
}

export async function completeCodeRuntimeImportSession(uploadID: string): Promise<CodeRuntimeStatus> {
  const cleanUploadID = encodeURIComponent(String(uploadID ?? '').trim());
  return fetchGatewayJSON<CodeRuntimeStatus>(`/_redeven_proxy/api/code-runtime/import-sessions/${cleanUploadID}/complete`, {
    method: 'POST',
  });
}

export async function selectCodeRuntimeVersion(version: string): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/select', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function removeCodeRuntimeVersion(version: string): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/remove-version', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function cancelCodeRuntimeOperation(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/cancel', { method: 'POST' });
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

export function codeRuntimeManagedActionLabel(status: CodeRuntimeStatus | null | undefined): string {
  if (!codeRuntimeManagedInstalled(status)) return 'Prepare workspace for this Local Environment';
  return 'Prepare latest workspace engine';
}

export function codeRuntimeStageLabel(stage: string | null | undefined, action?: string | null | undefined): string {
  const normalizedStage = String(stage ?? '').trim();
  if (String(action ?? '').trim() === 'remove_local_environment_version') {
    switch (normalizedStage) {
      case 'preparing':
        return 'Preparing Local Environment runtime removal...';
      case 'removing':
        return 'Removing Local Environment runtime files...';
      case 'validating':
        return 'Validating Local Environment runtime removal...';
      case 'finalizing':
        return 'Finalizing Local Environment runtime removal...';
      default:
        return 'Removing Local Environment runtime...';
    }
  }

  switch (normalizedStage) {
    case 'preparing':
      return 'Preparing workspace engine...';
    case 'receiving':
      return 'Sending workspace engine to this Environment...';
    case 'verifying':
      return 'Verifying workspace engine...';
    case 'installing':
      return 'Installing workspace engine...';
    case 'validating':
      return 'Validating workspace engine...';
    case 'finalizing':
      return 'Finishing workspace setup...';
    default:
      return 'Preparing workspace...';
  }
}

export function codeRuntimePlatformForDesktop(status: CodeRuntimeStatus | null | undefined): CodeRuntimePlatform {
  const platform = status?.platform;
  const osName = String(platform?.os ?? '').trim();
  const arch = String(platform?.arch ?? '').trim();
  const libc = String(platform?.libc ?? '').trim();
  if (osName !== 'linux' && osName !== 'darwin') {
    throw new Error(platform?.message || 'This Environment is not supported by the managed workspace engine.');
  }
  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error(platform?.message || 'This Environment architecture is not supported by the managed workspace engine.');
  }
  if (osName === 'linux' && libc !== '' && libc !== 'glibc' && libc !== 'unknown') {
    throw new Error(platform?.message || 'This Linux Environment is not supported by the managed workspace engine.');
  }
  return {
    os: osName,
    arch,
    ...(osName === 'linux' && libc ? { libc } : {}),
    platform_id: String(platform?.platform_id ?? '').trim() || (osName === 'linux' ? `${osName}-${arch}-${libc || 'glibc'}` : `${osName}-${arch}`),
  };
}

function normalizeCodeRuntimeImportSession(value: unknown): CodeRuntimeImportSession {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const uploadID = String(record.upload_id ?? '').trim();
  const operationID = String(record.operation_id ?? '').trim() || uploadID;
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

function normalizeCodeRuntimeImportChunkResult(value: unknown): CodeRuntimeImportChunkResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const uploadID = String(record.upload_id ?? '').trim();
  const receivedBytes = Number(record.received_bytes);
  const expectedBytes = Number(record.expected_bytes);
  const nextChunkIndex = Number(record.next_chunk_index);
  if (!uploadID || !Number.isFinite(receivedBytes) || !Number.isFinite(expectedBytes) || !Number.isFinite(nextChunkIndex)) {
    throw new Error('Runtime did not return a valid workspace preparation chunk result.');
  }
  return {
    upload_id: uploadID,
    received_bytes: Math.max(0, Math.floor(receivedBytes)),
    expected_bytes: Math.max(0, Math.floor(expectedBytes)),
    next_chunk_index: Math.max(0, Math.floor(nextChunkIndex)),
  };
}
