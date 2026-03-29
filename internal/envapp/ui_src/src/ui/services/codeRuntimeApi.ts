import { fetchGatewayJSON } from './gatewayApi';

export type CodeRuntimeDetectionState = 'ready' | 'missing' | 'incompatible';
export type CodeRuntimeInstallState = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type CodeRuntimeInstallStage = 'preparing' | 'downloading' | 'installing' | 'validating' | 'finalizing' | '';

export type CodeRuntimeStatus = Readonly<{
  supported_version: string;
  detection_state: CodeRuntimeDetectionState;
  install_state: CodeRuntimeInstallState;
  install_stage?: CodeRuntimeInstallStage;
  managed: boolean;
  source: string;
  binary_path?: string;
  installed_version?: string;
  managed_prefix: string;
  installer_script_url: string;
  last_error?: string;
  last_error_code?: string;
  install_started_at_unix_ms?: number;
  install_finished_at_unix_ms?: number;
  updated_at_unix_ms: number;
  log_tail?: string[];
}>;

export async function fetchCodeRuntimeStatus(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/status', { method: 'GET' });
}

export async function installCodeRuntime(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/install', { method: 'POST' });
}

export async function cancelCodeRuntimeInstall(): Promise<CodeRuntimeStatus> {
  return fetchGatewayJSON<CodeRuntimeStatus>('/_redeven_proxy/api/code-runtime/cancel', { method: 'POST' });
}

export function codeRuntimeReady(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.detection_state === 'ready' && status.install_state !== 'running';
}

export function codeRuntimeMissing(status: CodeRuntimeStatus | null | undefined): boolean {
  const state = String(status?.detection_state ?? '').trim();
  return state === 'missing' || state === 'incompatible';
}

export function codeRuntimeInstalling(status: CodeRuntimeStatus | null | undefined): boolean {
  return status?.install_state === 'running';
}

export function codeRuntimeStageLabel(stage: string | null | undefined): string {
  switch (String(stage ?? '').trim()) {
    case 'preparing':
      return 'Preparing managed runtime...';
    case 'downloading':
      return 'Downloading the official installer...';
    case 'installing':
      return 'Running the official installer...';
    case 'validating':
      return 'Validating code-server...';
    case 'finalizing':
      return 'Finalizing managed runtime...';
    default:
      return 'Installing code-server...';
  }
}
