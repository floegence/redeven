import { parseDesktopSettingsRequest, type DesktopSettingsRequest } from './settingsIPC';
export const DESKTOP_SECURITY_CHANNEL = 'redeven-desktop:runtime-security';
export type SecurityAction =
  | 'status'
  | 'setup'
  | 'replace'
  | 'rotate'
  | 'disable'
  | 'verify'
  | 'commit'
  | 'cancel';
export type SecurityRequest = Readonly<{
  action: SecurityAction;
  operation_id?: string;
  password?: string;
  code?: string;
  recovery_code?: string;
  saved?: boolean;
}>;
export type DesktopSecurityRequest = SecurityRequest &
  DesktopSettingsRequest;
export type SecurityResult = Readonly<{
  enabled: boolean;
  password_configured: boolean;
  recovery_pending: boolean;
  recovery_codes_remaining: number;
  revision: number;
  operation_id?: string;
  secret?: string;
  qr_image?: string;
  recovery_codes?: readonly string[];
}>;
export function parseDesktopSecurityRequest(
  value: unknown,
): DesktopSecurityRequest {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid security request.');
  const request = value as Record<string, unknown>;
  const actions: readonly string[] = [
    'status',
    'setup',
    'replace',
    'rotate',
    'disable',
    'verify',
    'commit',
    'cancel',
  ];
  if (
    typeof request.environment_id !== 'string' ||
    !request.environment_id.trim() ||
    !actions.includes(String(request.action))
  )
    throw new Error('Invalid security request.');
  for (const field of ['operation_id', 'password', 'code', 'recovery_code']) {
    if (
      request[field] !== undefined &&
      (typeof request[field] !== 'string' || request[field].length > 1024)
    )
      throw new Error('Invalid security request.');
  }
  return {
    ...parseDesktopSettingsRequest(request),
    action: request.action as SecurityAction,
    ...(typeof request.operation_id === 'string'
      ? { operation_id: request.operation_id }
      : {}),
    ...(typeof request.password === 'string'
      ? { password: request.password }
      : {}),
    ...(typeof request.code === 'string' ? { code: request.code } : {}),
    ...(typeof request.recovery_code === 'string'
      ? { recovery_code: request.recovery_code }
      : {}),
    ...(request.saved === true ? { saved: true } : {}),
  };
}
export function parseSecurityResult(value: unknown): SecurityResult {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid security status.');
  const result = value as SecurityResult;
  if (
    typeof result.enabled !== 'boolean' ||
    typeof result.password_configured !== 'boolean' ||
    typeof result.recovery_pending !== 'boolean' ||
    !Number.isSafeInteger(result.revision) ||
    !Number.isSafeInteger(result.recovery_codes_remaining)
  )
    throw new Error('Invalid security status.');
  return result;
}
