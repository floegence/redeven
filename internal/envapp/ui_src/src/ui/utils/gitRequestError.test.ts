import { describe, expect, it } from 'vitest';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import { SessionError } from '@floegence/flowersec-core';
import { createI18nHelpers } from '../i18n/createI18n';
import { enUS } from '../i18n/locales';
import { presentGitRequestError } from './gitRequestError';

const i18n = createI18nHelpers('en-US', enUS);
describe('Git request error presentation', () => {
  it.each([
    [403, 'git.errors.permissionDenied'], [404, 'git.errors.scopeChanged'],
    [409, 'git.errors.scopeChanged'], [40901, 'git.errors.scopeChanged'],
    [41301, 'git.errors.resourceLimit'], [41307, 'git.errors.resourceLimit'],
    [499, 'git.errors.outcomeUnknown'], [504, 'git.errors.outcomeUnknown'],
    [400, 'git.errors.requestRejected'], [42201, 'git.errors.requestRejected'],
  ] as const)('presents structured RPC code %s without private diagnostics', (code, key) => {
    expect(presentGitRequestError(new RpcError({ typeId: 1129, code, message: 'private stderr' }), i18n)).toBe(i18n.t(key));
  });
  it.each(['timeout', 'closed', 'canceled', 'operation_failed'] as const)('does not promise retry safety after %s', code => {
    expect(presentGitRequestError(new SessionError(code), i18n)).toBe(i18n.t('git.errors.outcomeUnknown'));
  });
  it('distinguishes unavailable connections and bounded resources', () => {
    expect(presentGitRequestError(new ProtocolNotConnectedError(), i18n)).toBe(i18n.t('git.common.connectionNotReady'));
    expect(presentGitRequestError(new SessionError('resource_exhausted'), i18n)).toBe(i18n.t('git.errors.resourceLimit'));
  });
  it('retains the operation fallback for unknown errors without exposing raw messages', () => {
    for (const error of [new Error('private token'), new RpcError({ typeId: 1129, code: 500, message: 'private stderr' })]) {
      expect(presentGitRequestError(error, i18n, 'Review failed.')).toBe('Review failed.');
    }
  });
});
