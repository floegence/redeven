import { describe, expect, it, vi } from 'vitest';

import type { GatewayRuntimeOperation } from './gatewayClient';
import {
  RUNTIME_OPERATION_RENEWAL_LEAD_MS,
  startRuntimeOperationLease,
} from './runtimeOperationLease';

function operation(overrides: Partial<GatewayRuntimeOperation> = {}): GatewayRuntimeOperation {
  return {
    protocol_version: 'redeven-gateway-v2',
    operation_id: 'rop_lease',
    idempotency_key: 'runtime-operation:rop_lease',
    lifecycle_target_id: 'rlt_target',
    target_generation: 1,
    gateway_env_id: 'env_local',
    kind: 'update_runtime',
    authorized_client_key_id: 'gck_client',
    desired_runtime: {
      version: 'v0.0.0-dev',
      platform: 'linux',
      architecture: 'amd64',
      artifact_policy: 'custom_build',
    },
    state: 'awaiting_confirmation',
    expected_snapshot: {
      snapshot_revision: 1,
      process_inventory_digest: 'sha256:process',
      workload_identity_digest: 'sha256:workload',
      workload: { knowledge: 'known', protected_workload_present: false },
      observed_at_unix_ms: 1,
    },
    expires_at_unix_ms: 10_000,
    maximum_expires_at_unix_ms: 20_000,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    ...overrides,
  };
}

describe('runtimeOperationLease', () => {
  it('renews a cancellable operation when its deadline is close', async () => {
    vi.useFakeTimers();
    const renewed = operation({
      expires_at_unix_ms: RUNTIME_OPERATION_RENEWAL_LEAD_MS * 2,
      maximum_expires_at_unix_ms: RUNTIME_OPERATION_RENEWAL_LEAD_MS * 3,
    });
    const renew = vi.fn(async () => renewed);
    const onRenewed = vi.fn();
    const lease = startRuntimeOperationLease(
      operation({
        expires_at_unix_ms: RUNTIME_OPERATION_RENEWAL_LEAD_MS - 1,
        maximum_expires_at_unix_ms: RUNTIME_OPERATION_RENEWAL_LEAD_MS * 2,
      }),
      renew,
      onRenewed,
      { intervalMs: 10, now: () => 0 },
    );

    await vi.advanceTimersByTimeAsync(10);

    expect(renew).toHaveBeenCalledWith(RUNTIME_OPERATION_RENEWAL_LEAD_MS * 2);
    expect(onRenewed).toHaveBeenCalledWith(renewed);
    expect(lease.current()).toBe(renewed);
    lease.stop();
    vi.useRealTimers();
  });

  it('does not renew terminal operations', async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => operation({ state: 'succeeded' }));
    const lease = startRuntimeOperationLease(
      operation({ state: 'succeeded', expires_at_unix_ms: Date.now() + 1 }),
      renew,
      undefined,
      { intervalMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(20);

    expect(renew).not.toHaveBeenCalled();
    lease.stop();
    vi.useRealTimers();
  });
});
