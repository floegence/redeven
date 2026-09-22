import { expect, it } from 'vitest';
import { parseSecurityResult } from './runtimeSecurity';

const status = { enabled: false, password_configured: false, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
it.each([false, true])('retains authoritative HTTPS readiness: %s', https_ready => {
  expect(parseSecurityResult({ ...status, https_ready }).https_ready).toBe(https_ready);
});
it.each([undefined, null, 'https'])('rejects unknown HTTPS readiness without guessing from connection URLs', https_ready => {
  expect(() => parseSecurityResult({ ...status, https_ready })).toThrow('SETTINGS_RUNTIME_INCOMPATIBLE');
});
