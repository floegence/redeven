import { describe, expect, it } from 'vitest';

import { sshOpenFailureAllowsCachedRefreshRetry } from './sshOpenRetryPolicy';

describe('sshOpenRetryPolicy', () => {
  it.each([
    'ssh_forward_unavailable',
    'ssh_forward_network_failed',
    'ssh_forward_invalid_response',
  ] as const)('allows one fresh-cache refresh retry for %s', (code) => {
    expect(sshOpenFailureAllowsCachedRefreshRetry(code)).toBe(true);
  });

  it('does not repeat a full readiness deadline after tunnel verification times out', () => {
    expect(sshOpenFailureAllowsCachedRefreshRetry('ssh_forward_verification_timed_out')).toBe(false);
  });
});
