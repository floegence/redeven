import { fetchGatewayJSON } from './gatewayApi';

export type CodeRuntimeDetectionState = 'ready' | 'missing' | 'unusable';
export type CodeRuntimeOperationAction = 'install' | 'uninstall' | '';
export type CodeRuntimeOperationState = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type CodeRuntimeOperationStage = 'preparing' | 'downloading' | 'installing' | 'removing' | 'validating' | 'finalizing' | '';

export type CodeRuntimeTargetStatus = Readonly<{
  detection_state: CodeRuntimeDetectionState;
  present: boolean;
  source: string;
  binary_path?: string;
  error_code?: string;
  error_message?: string;
}>;

export type CodeRuntimeOperationStatus = Readonly<{
  action?: CodeRuntimeOperationAction;
  state: CodeRuntimeOperationState;
  stage?: CodeRuntimeOperationStage;
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
  installer_script_url: string;
  operation: CodeRuntimeOperationStatus;
  updated_at_unix_ms: number;
}>;

export async function fetchCodeRuntimeStatus(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/status', { method: 'GET' });
}

export async function installCodeRuntime(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/install', { method: 'POST' });
}

export async function uninstallCodeRuntime(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/uninstall', { method: 'POST' });
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
  return Boolean(status?.managed_runtime.present);
}

export function codeRuntimeManagedRuntimeSelected(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.active_runtime.source === 'managed' && status?.active_runtime.detection_state === 'ready';
}

export function codeRuntimeManagedActionLabel(status: CodeRuntimeStatus | null | undefined): string {
  if (!codeRuntimeManagedInstalled(status)) return 'Install latest';
  return 'Update to latest';
}

export function codeRuntimeStageLabel(stage: string | null | undefined, action?: string | null | undefined): string {
  const normalizedStage = String(stage ?? '').trim();
  if (String(action ?? '').trim() === 'uninstall') {
    switch (normalizedStage) {
      case 'preparing':
        return 'Preparing managed runtime removal...';
      case 'removing':
        return 'Removing managed runtime files...';
      case 'validating':
        return 'Validating managed runtime removal...';
      case 'finalizing':
        return 'Finalizing runtime removal...';
      default:
        return 'Removing managed runtime...';
    }
  }

  switch (normalizedStage) {
    case 'preparing':
      return 'Preparing managed runtime...';
    case 'downloading':
      return 'Downloading the official latest-stable installer...';
    case 'installing':
      return 'Running the official installer...';
    case 'validating':
      return 'Validating code-server...';
    case 'finalizing':
      return 'Finalizing managed runtime...';
    default:
      return 'Installing or updating code-server...';
  }
}
