import { describe, expect, it, vi } from 'vitest';

import type { GatewayRuntimeOperation } from './gatewayClient';
import { advanceGatewayRuntimeOperation } from './runtimeLifecycleCompletion';

function operation(state: GatewayRuntimeOperation['state']): GatewayRuntimeOperation {
  return {
    protocol_version: 'redeven-gateway-v2',
    operation_id: 'rop_test',
    idempotency_key: 'runtime-operation:rop_test',
    lifecycle_target_id: 'rlt_test',
    target_generation: 1,
    gateway_env_id: 'env_local',
    kind: 'update_runtime',
    authorized_client_key_id: 'gck_test',
    desired_runtime: {
      version: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
      artifact_policy: 'published_release',
    },
    state,
    expected_snapshot: {
      snapshot_revision: 1,
      process_inventory_digest: 'sha256:inventory',
      workload_identity_digest: 'sha256:workload',
      workload: { knowledge: 'known', protected_workload_present: false },
      observed_at_unix_ms: 1,
    },
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
  };
}

describe('Runtime lifecycle completion', () => {
  it('does not prepare, upload, or commit while user confirmation is pending', async () => {
    const prepareArtifact = vi.fn();
    const upload = vi.fn();
    const commit = vi.fn();
    const awaitingConfirmation = operation('awaiting_confirmation');

    await expect(advanceGatewayRuntimeOperation(awaitingConfirmation, {
      prepareArtifact,
      upload,
      commit,
    })).resolves.toBe(awaitingConfirmation);
    expect(prepareArtifact).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('prepares, uploads, and commits an authorized update in order', async () => {
    const calls: string[] = [];
    const commitReady = operation('commit_ready');
    const succeeded = operation('succeeded');
    const artifact = Buffer.from('runtime archive');
    const metadata = {
      size_bytes: artifact.length,
      archive_sha256: 'a'.repeat(64),
      executable_sha256: 'b'.repeat(64),
      manifest: {},
    } as const;

    const result = await advanceGatewayRuntimeOperation(operation('awaiting_artifact'), {
      prepareArtifact: vi.fn(async () => {
        calls.push('prepare');
        return { artifact, metadata };
      }),
      upload: vi.fn(async () => {
        calls.push('upload');
        return commitReady;
      }),
      commit: vi.fn(async () => {
        calls.push('commit');
        return succeeded;
      }),
    });

    expect(calls).toEqual(['prepare', 'upload', 'commit']);
    expect(result).toBe(succeeded);
  });
});
