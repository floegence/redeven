import { describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRecovery, providerCredentialsNeedRenewal } from './providerCredentialRecovery';

describe('provider credential recovery', () => {
  const args = () => ({ targetID: 'local:one', identity: 'same-runtime-account-binding', generation: 7, now: 0,
    isCurrent: () => true, changed: vi.fn() });

  it('renews only exhausted credentials on a verified saved binding', () => {
    const binding = { state: 'linked' as const, remote_enabled: true, connection_state: 'authorization_required' as const,
      binding_generation: 7, local_environment_public_id: 'le_one', last_error_code: 'CONTROL_CREDENTIALS_EXPIRED' };
    expect(providerCredentialsNeedRenewal(binding)).toBe(true);
    for (const code of ['CONTROL_RELINK_REQUIRED', 'CONTROL_CONNECTION_FAILED', '']) {
      expect(providerCredentialsNeedRenewal({ ...binding, last_error_code: code })).toBe(false);
    }
    expect(providerCredentialsNeedRenewal({ ...binding, connection_state: 'connecting' })).toBe(false);
    expect(providerCredentialsNeedRenewal({ ...binding, binding_generation: 0 })).toBe(false);
  });

  it('coalesces concurrent wake events and ignores late completion after a user action', async () => {
    const recovery = new ProviderCredentialRecovery();
    let finish!: (result: 'restored') => void;
    const exchange = vi.fn(() => new Promise<'restored'>(resolve => { finish = resolve; }));
    let current = true;
    const input = { ...args(), isCurrent: () => current, exchange };
    const first = recovery.renew(input);
    await recovery.renew(input);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(recovery.state(input.targetID, 7)).toBe('restoring');
    current = false;
    recovery.forget(input.targetID);
    finish('restored');
    await first;
    expect(recovery.state(input.targetID, 7)).toBeUndefined();
  });

  it('backs off transient authorization exchange failures and stops after three attempts', async () => {
    const recovery = new ProviderCredentialRecovery();
    const exchange = vi.fn(async () => 'retry' as const);
    for (const now of [0, 1, 29_999, 30_000, 30_001, 150_000, 500_000]) {
      await recovery.renew({ ...args(), now, exchange });
    }
    expect(exchange).toHaveBeenCalledTimes(3);
    expect(recovery.state('local:one', 7)).toBe('attention');
  });

  it('does not keep issuing generations until a connection actually succeeds', async () => {
    const recovery = new ProviderCredentialRecovery();
    const exchange = vi.fn(async () => 'restored' as const);
    await recovery.renew({ ...args(), exchange });
    await recovery.renew({ ...args(), generation: 8, now: 500_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(recovery.state('local:one', 8)).toBe('attention');
    recovery.forget('local:one'); // Observed registered control session.
    await recovery.renew({ ...args(), generation: 8, now: 600_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('stops terminal failures until authorization or user intent changes', async () => {
    const recovery = new ProviderCredentialRecovery();
    const exchange = vi.fn(async () => 'attention' as const);
    await recovery.renew({ ...args(), exchange });
    await recovery.renew({ ...args(), now: 500_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), identity: 'new-authorization', now: 600_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it.each(['sign_in_required', 'permission_required', 'binding_changed'] as const)(
    'preserves %s without retrying until the authorization identity changes', async outcome => {
      const recovery = new ProviderCredentialRecovery();
      const exchange = vi.fn(async () => outcome);
      await recovery.renew({ ...args(), exchange });
      expect(recovery.state('local:one', 7)).toBe(outcome);
      await recovery.renew({ ...args(), now: 500_000, exchange });
      expect(exchange).toHaveBeenCalledTimes(1);
      await recovery.renew({ ...args(), identity: 'new-authorization', now: 600_000, exchange });
      expect(exchange).toHaveBeenCalledTimes(2);
    },
  );
});
