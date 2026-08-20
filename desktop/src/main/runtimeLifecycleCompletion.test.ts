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
    const progress: GatewayRuntimeOperation['state'][] = [];
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
      onProgress: (current) => progress.push(current.state),
    });

    expect(calls).toEqual(['prepare', 'upload', 'commit']);
    expect(progress).toEqual(['awaiting_artifact', 'commit_ready', 'succeeded']);
    expect(result).toBe(succeeded);
  });

  it('continues after an artifact response is lost once the durable operation advances', async () => {
    const artifact = Buffer.from('runtime archive');
    const uploadError = new Error('artifact response lost');
    const observed = [operation('staging'), operation('commit_ready')];
    const commit = vi.fn(async () => operation('succeeded'));

    await expect(advanceGatewayRuntimeOperation(operation('awaiting_artifact'), {
      prepareArtifact: vi.fn(async () => ({
        artifact,
        metadata: {
          size_bytes: artifact.length,
          archive_sha256: 'a'.repeat(64),
          executable_sha256: 'b'.repeat(64),
          manifest: {},
        },
      })),
      upload: vi.fn(async () => { throw uploadError; }),
      commit,
      observe: vi.fn(async () => observed.shift() ?? operation('commit_ready')),
      wait: vi.fn(async () => undefined),
      onProgress: vi.fn(),
    })).resolves.toMatchObject({ state: 'succeeded' });

    expect(commit).toHaveBeenCalledOnce();
  });

  it('waits for a durable commit after its response is lost', async () => {
    const commitError = new Error('commit response lost');
    const observed = [operation('committing'), operation('succeeded')];

    await expect(advanceGatewayRuntimeOperation(operation('commit_ready'), {
      prepareArtifact: vi.fn(),
      upload: vi.fn(),
      commit: vi.fn(async () => { throw commitError; }),
      observe: vi.fn(async () => observed.shift() ?? operation('succeeded')),
      wait: vi.fn(async () => undefined),
    })).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('preserves the transport failure when the operation did not advance', async () => {
    const uploadError = new Error('upload was not accepted');
    const artifact = Buffer.from('runtime archive');

    await expect(advanceGatewayRuntimeOperation(operation('awaiting_artifact'), {
      prepareArtifact: vi.fn(async () => ({
        artifact,
        metadata: {
          size_bytes: artifact.length,
          archive_sha256: 'a'.repeat(64),
          executable_sha256: 'b'.repeat(64),
          manifest: {},
        },
      })),
      upload: vi.fn(async () => { throw uploadError; }),
      commit: vi.fn(),
      observe: vi.fn(async () => operation('awaiting_artifact')),
      wait: vi.fn(async () => undefined),
    })).rejects.toBe(uploadError);
  });
});
