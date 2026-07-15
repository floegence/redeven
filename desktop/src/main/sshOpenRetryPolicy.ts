import type { DesktopFailureCode } from '../shared/desktopOperationFailure';

const CACHED_SSH_OPEN_REFRESH_RETRY_CODES: ReadonlySet<DesktopFailureCode> = new Set([
  'ssh_forward_unavailable',
  'ssh_forward_network_failed',
  'ssh_forward_invalid_response',
]);

export function sshOpenFailureAllowsCachedRefreshRetry(code: DesktopFailureCode): boolean {
  return CACHED_SSH_OPEN_REFRESH_RETRY_CODES.has(code);
}
