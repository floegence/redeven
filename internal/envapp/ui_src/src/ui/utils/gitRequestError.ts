import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import { SessionError } from '@floegence/flowersec-core';
import type { I18nHelpers } from '../i18n';

// Present stable public error codes, never private Git stderr or transport causes.
export function presentGitRequestError(error: unknown, i18n: Pick<I18nHelpers, 't'>, fallback = i18n.t('git.common.requestFailed')): string {
  if (error instanceof ProtocolNotConnectedError) return i18n.t('git.common.connectionNotReady');
  if (error instanceof SessionError) {
    return i18n.t(error.code === 'resource_exhausted' ? 'git.errors.resourceLimit' : 'git.errors.outcomeUnknown');
  }
  if (error instanceof RpcError) {
    if (error.code === 403) return i18n.t('git.errors.permissionDenied');
    if (error.code === 404 || error.code === 409 || error.code === 40901) return i18n.t('git.errors.scopeChanged');
    if (error.code === 41304) return i18n.t('git.errors.worktreeReviewLimit');
    if (error.code >= 41301 && error.code <= 41307) return i18n.t('git.errors.resourceLimit');
    if (error.code === 499 || error.code === 504) return i18n.t('git.errors.outcomeUnknown');
    if (error.code === 400 || error.code === 42201) return i18n.t('git.errors.requestRejected');
  }
  return fallback;
}
