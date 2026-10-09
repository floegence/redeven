import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudCredentialRecovery, providerCredentialsNeedRenewal } from './cloudCredentialRecovery';

describe('provider credential recovery', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
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
    expect(providerCredentialsNeedRenewal({ ...binding, remote_enabled: false })).toBe(false);
  });

  it('coalesces concurrent wake events and ignores late completion after a user action', async () => {
    const recovery = new CloudCredentialRecovery();
    let finish!: (result: { outcome: 'restored' }) => void;
    const exchange = vi.fn(() => new Promise<{ outcome: 'restored' }>(resolve => { finish = resolve; }));
    let current = true;
    const input = { ...args(), isCurrent: () => current, exchange };
    const first = recovery.renew(input);
    await recovery.renew(input);
    await Promise.resolve();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(recovery.state(input.targetID, 7)).toBe('restoring');
    current = false;
    recovery.forget(input.targetID);
    finish({ outcome: 'restored' });
    await first;
    expect(recovery.state(input.targetID, 7)).toBeUndefined();
  });

  it('waits for a read-only service probe after bounded exchanges, then recovers after a late Portal start', async () => {
    const recovery = new CloudCredentialRecovery();
    const exchange = vi.fn(async () => ({ outcome: 'retry' as const }));
    const probe = vi.fn(async () => ({ outcome: 'retry' as const }));
    for (const now of [0, 1, 29_999, 30_000, 30_001, 150_000, 210_000]) {
      await recovery.renew({ ...args(), now, exchange, probe });
    }
    expect(exchange).toHaveBeenCalledTimes(3);
    expect(recovery.state('local:one', 7)).toBe('waiting_for_service');
    expect(probe).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), now: 210_001, exchange, probe });
    expect(probe).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), now: 270_000,
      probe: async () => ({ outcome: 'restored' }), exchange: async () => ({ outcome: 'restored' }) });
    expect(recovery.state('local:one', 7)).toBeUndefined();
  });

  it('keeps the cause and retry time without probing terminal authorization failures', async () => {
    const recovery = new CloudCredentialRecovery();
    const probe = vi.fn(async () => ({ outcome: 'restored' as const }));
    await recovery.renew({ ...args(), now: 100, probe,
      exchange: async () => ({ outcome: 'sign_in_required', error_code: 'authorization_expired' }) });
    await recovery.renew({ ...args(), now: 1_000_000, probe, exchange: vi.fn() });
    expect(probe).not.toHaveBeenCalled();
    expect(recovery.details('local:one', 7)).toMatchObject({
      last_error_code: 'authorization_expired', last_attempt_at_unix_ms: 100, attempt_count: 1,
    });
  });

  it('wake preserves terminal review and issued credentials while advancing only recoverable waits', async () => {
    const recovery = new CloudCredentialRecovery();
    const terminal = vi.fn(async () => ({ outcome: 'permission_required' as const }));
    await recovery.renew({ ...args(), exchange: terminal });
    recovery.wake();
    await recovery.renew({ ...args(), now: 1_000_000, exchange: terminal });
    expect(terminal).toHaveBeenCalledTimes(1);
    recovery.forget('local:one');
    const exchange = vi.fn(async () => ({ outcome: 'retry' as const, error_code: 'provider_connection_failed' }));
    await recovery.renew({ ...args(), exchange });
    recovery.wake();
    await recovery.renew({ ...args(), now: 1, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('waits for an already-sent exchange before explicit disconnect and discards its stale completion', async () => {
    const recovery = new CloudCredentialRecovery();
    let finish!: (value: { outcome: 'restored' }) => void;
    let current = true;
    const task = recovery.renew({ ...args(), isCurrent: () => current,
      exchange: () => new Promise(resolve => { finish = resolve; }) });
    await Promise.resolve();
    current = false;
    let disconnected = false;
    const disconnect = recovery.settled('local:one').then(() => { recovery.forget('local:one'); disconnected = true; });
    await Promise.resolve();
    expect(disconnected).toBe(false);
    finish({ outcome: 'restored' });
    await Promise.all([task, disconnect]);
    expect(disconnected).toBe(true);
    recovery.wake();
    expect(recovery.state('local:one', 7)).toBeUndefined();
  });

  it('does not keep issuing generations until a connection actually succeeds', async () => {
    const recovery = new CloudCredentialRecovery();
    const exchange = vi.fn(async () => ({ outcome: 'restored' as const }));
    await recovery.renew({ ...args(), exchange });
    recovery.wake();
    await recovery.renew({ ...args(), now: 400_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), generation: 8, now: 500_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(recovery.state('local:one', 8)).toBe('attention');
    recovery.forget('local:one'); // Observed registered control session.
    await recovery.renew({ ...args(), generation: 8, now: 600_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('measures backoff from exchange completion rather than request start', async () => {
    const recovery = new CloudCredentialRecovery();
    const exchange = vi.fn(async () => {
      vi.setSystemTime(20_000);
      return { outcome: 'retry' as const };
    });
    await recovery.renew({ ...args(), exchange });
    expect(recovery.details('local:one', 7)?.next_retry_at_unix_ms).toBe(50_000);
    await recovery.renew({ ...args(), now: 49_999, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), now: 50_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('stops read-only probes when permission is revoked', async () => {
    const recovery = new CloudCredentialRecovery();
    const exchange = vi.fn(async () => ({ outcome: 'retry' as const }));
    const probe = vi.fn(async () => ({ outcome: 'permission_required' as const, error_code: 'forbidden' }));
    for (const now of [0, 30_000, 150_000, 210_000]) await recovery.renew({ ...args(), now, exchange, probe });
    recovery.wake();
    await recovery.renew({ ...args(), now: 1_000_000, exchange, probe });
    expect(exchange).toHaveBeenCalledTimes(3);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(recovery.state('local:one', 7)).toBe('permission_required');
    expect(recovery.details('local:one', 7)?.next_retry_at_unix_ms).toBeUndefined();
  });

  it('stops terminal failures until authorization or user intent changes', async () => {
    const recovery = new CloudCredentialRecovery();
    const exchange = vi.fn(async () => ({ outcome: 'attention' as const }));
    await recovery.renew({ ...args(), exchange });
    await recovery.renew({ ...args(), now: 500_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(1);
    await recovery.renew({ ...args(), identity: 'new-authorization', now: 600_000, exchange });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it.each(['sign_in_required', 'permission_required', 'binding_changed'] as const)(
    'preserves %s without retrying until the authorization identity changes', async outcome => {
      const recovery = new CloudCredentialRecovery();
      const exchange = vi.fn(async () => ({ outcome }));
      await recovery.renew({ ...args(), exchange });
      expect(recovery.state('local:one', 7)).toBe(outcome);
      await recovery.renew({ ...args(), now: 500_000, exchange });
      expect(exchange).toHaveBeenCalledTimes(1);
      await recovery.renew({ ...args(), identity: 'new-authorization', now: 600_000, exchange });
      expect(exchange).toHaveBeenCalledTimes(2);
    },
  );
});
