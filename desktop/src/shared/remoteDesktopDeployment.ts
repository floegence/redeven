export const REMOTE_DESKTOP_DEPLOYMENT_CHANNEL = 'redeven-desktop:remote-desktop-deployment';
export const REMOTE_DESKTOP_DEPLOYMENT_PROGRESS = 'redeven-desktop:remote-desktop-deployment-progress';
export type DesktopDeploymentOperation = 'install' | 'update' | 'start' | 'stop' | 'uninstall';
export type DesktopDeploymentRequest =
  | { action: 'capabilities' }
  | { action: 'cancel' }
  | { action: 'manage'; operation: DesktopDeploymentOperation; confirmed: true; administratorPassword?: string };
export type DesktopDeploymentProgress = Readonly<{
  stage: 'checking' | 'preparing_media' | 'transferring' | 'authorization_required' | 'authorized' | 'verifying_files' | 'installing_service' | 'starting_service' | 'stopping_service' | 'start' | 'stop' | 'rolling_back' | 'rolled_back' | 'complete' | 'failed';
  received_bytes?: number;
  expected_bytes?: number;
  rollback?: 'complete' | 'failed';
}>;
export type DesktopDeploymentResult = Readonly<{
  ok: boolean;
  available?: boolean;
  state?: 'active' | 'stopped' | 'not_installed';
  code?: 'unsupported_target' | 'permission_denied' | 'invalid_request' | 'operation_in_progress' | 'administrator_required' | 'authorization_failed' | 'deployment_failed' | 'canceled' | 'transport_interrupted';
  rollback?: 'complete' | 'failed' | 'unknown';
}>;
export function parseDesktopDeploymentRequest(value: unknown): DesktopDeploymentRequest | undefined {
  if (!value || typeof value !== 'object') return;
  const request = value as DesktopDeploymentRequest;
  if (request.action === 'capabilities' || request.action === 'cancel') return { action: request.action };
  if (request.action !== 'manage' || request.confirmed !== true || !['install', 'update', 'start', 'stop', 'uninstall'].includes(request.operation)) return;
  if (request.administratorPassword !== undefined && (typeof request.administratorPassword !== 'string' || request.administratorPassword.length > 4096 || /[\0\r\n]/u.test(request.administratorPassword))) return;
  return { action: 'manage', operation: request.operation, confirmed: true, administratorPassword: request.administratorPassword };
}
export function parseDesktopDeploymentProgress(value: unknown): DesktopDeploymentProgress | undefined {
  if (!value || typeof value !== 'object') return;
  const event = value as DesktopDeploymentProgress;
  if (!['checking', 'preparing_media', 'transferring', 'authorization_required', 'authorized', 'verifying_files', 'installing_service', 'starting_service', 'stopping_service', 'start', 'stop', 'rolling_back', 'rolled_back', 'complete', 'failed'].includes(event.stage)) return;
  if (event.rollback !== undefined && !['complete', 'failed'].includes(event.rollback)) return;
  const bytes: Pick<DesktopDeploymentProgress, 'received_bytes' | 'expected_bytes'> = {};
  for (const key of ['received_bytes', 'expected_bytes'] as const) {
    if (event[key] === undefined) continue;
    if (!Number.isSafeInteger(event[key]) || Number(event[key]) < 0 || Number(event[key]) > 2 ** 32) return;
    Object.assign(bytes, { [key]: event[key] });
  }
  return { stage: event.stage, ...bytes, ...(event.rollback ? { rollback: event.rollback } : {}) };
}
