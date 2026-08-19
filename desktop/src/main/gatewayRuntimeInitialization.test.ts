import { describe, expect, it, vi } from 'vitest';

import type {
  GatewayRuntimeArtifactMetadata,
  GatewayRuntimeOperation,
  GatewayRuntimeOperationPrepareRequest,
} from './gatewayClient';
import {
  initializeGatewayRuntime,
  selectGatewayRuntimeArtifactPlan,
} from './gatewayRuntimeInitialization';

function operation(
  state: GatewayRuntimeOperation['state'],
  policy: GatewayRuntimeOperationPrepareRequest['desired_runtime']['artifact_policy'] = 'custom_build',
): GatewayRuntimeOperation {
  return {
    protocol_version: 'redeven-gateway-v2',
    operation_id: 'rop_initialize',
    idempotency_key: 'runtime-initialization:rop_initialize',
    lifecycle_target_id: 'rlt_local',
    target_generation: 4,
    gateway_env_id: 'env_local',
    kind: 'update_runtime',
    authorized_client_key_id: 'gck_desktop',
    desired_runtime: {
      version: 'v0.0.0-dev',
      platform: 'darwin',
      architecture: 'arm64',
      artifact_policy: policy,
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

describe('Gateway Runtime initialization', () => {
  it('selects a bound custom build for source Desktop lifecycle updates', () => {
    expect(selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['published_release', 'custom_build'],
      sourceBuildAvailable: true,
      sourceCommit: 'abc123',
      desiredVersion: 'v0.0.0-dev',
      platform: 'darwin',
      architecture: 'arm64',
    })).toEqual({
      artifact_policy: 'custom_build',
      build_inputs: {
        architecture: 'arm64',
        commit: 'abc123',
        platform: 'darwin',
        source: 'desktop_source_build',
        version: 'v0.0.0-dev',
      },
    });
  });

  it('uses a published release only when a source build is unavailable', () => {
    expect(selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['published_release', 'custom_build'],
      sourceBuildAvailable: false,
      sourceCommit: 'abc123',
      desiredVersion: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
    })).toEqual({ artifact_policy: 'published_release' });
  });

  it('rejects lifecycle updates without an authorized artifact policy', () => {
    expect(() => selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['custom_build'],
      sourceBuildAvailable: false,
      sourceCommit: 'abc123',
      desiredVersion: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
    })).toThrow('does not expose an authorized Runtime artifact policy');
  });

  it('never lets a source checkout change absent Runtime initialization into a custom build', async () => {
    const calls: string[] = [];
    const artifact = Buffer.from('custom Runtime archive');
    const metadata: GatewayRuntimeArtifactMetadata = {
      size_bytes: artifact.length,
      archive_sha256: 'a'.repeat(64),
      executable_sha256: 'b'.repeat(64),
      manifest: { schema_version: 1 },
      build_attestation: { operation_id: 'rop_initialize' },
    };
    const prepare = vi.fn(async (request: GatewayRuntimeOperationPrepareRequest) => {
      calls.push(`prepare:${request.operation}:${request.desired_runtime.artifact_policy}`);
      expect(request.build_inputs).toBeUndefined();
      return {
        protocol_version: 'redeven-gateway-v2',
        operation: operation('awaiting_confirmation', 'published_release'),
        confirmation_required: true,
        artifact_max_bytes: 512 << 20,
      };
    });

    await expect(initializeGatewayRuntime({
      operationID: 'rop_initialize',
      authorizedClientKeyID: 'gck_desktop',
      gatewayEnvironmentID: 'env_local',
      desiredVersion: 'v0.0.0-dev',
      sourceCommit: 'abc123',
      sourceBuildAvailable: true,
      capability: {
        target: { lifecycle_target_id: 'rlt_local', target_generation: 4 },
        compatibility: {
          runtime_platform: 'darwin',
          runtime_architecture: 'arm64',
          compatibility_epoch: 9,
        },
        operations: ['update_runtime'],
        artifact_policies: ['published_release', 'custom_build'],
      },
      prepare,
      confirm: vi.fn(async () => {
        calls.push('confirm');
        return operation('awaiting_artifact', 'published_release');
      }),
      prepareArtifact: vi.fn(async (current) => {
        calls.push(`artifact:${current.desired_runtime.artifact_policy}`);
        return { artifact, metadata };
      }),
      upload: vi.fn(async () => {
        calls.push('upload');
        return operation('commit_ready');
      }),
      commit: vi.fn(async () => {
        calls.push('commit');
        return operation('succeeded');
      }),
      observe: vi.fn(async () => operation('succeeded')),
    })).resolves.toMatchObject({ state: 'succeeded' });

    expect(calls).toEqual([
      'prepare:update_runtime:published_release',
      'confirm',
      'artifact:published_release',
      'upload',
      'commit',
    ]);
    expect(calls.some((call) => call.includes('start'))).toBe(false);
  });

  it('fails before preparing when the absent Runtime capability has no update operation', async () => {
    const prepare = vi.fn();
    await expect(initializeGatewayRuntime({
      operationID: 'rop_initialize',
      authorizedClientKeyID: 'gck_desktop',
      gatewayEnvironmentID: 'env_local',
      desiredVersion: 'v0.0.0-dev',
      sourceCommit: 'abc123',
      sourceBuildAvailable: true,
      capability: {
        target: { lifecycle_target_id: 'rlt_local', target_generation: 4 },
        compatibility: {
          runtime_platform: 'darwin',
          runtime_architecture: 'arm64',
          compatibility_epoch: 9,
        },
        operations: [],
        artifact_policies: ['custom_build'],
      },
      prepare,
      confirm: vi.fn(),
      prepareArtifact: vi.fn(),
      upload: vi.fn(),
      commit: vi.fn(),
      observe: vi.fn(),
    })).rejects.toThrow('does not expose Runtime installation');
    expect(prepare).not.toHaveBeenCalled();
  });
});
