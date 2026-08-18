import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  buildCustomRuntimeArtifactMetadata,
  runtimeExecutableFromArchive,
  validateRuntimeCompatibilityManifest,
} from './runtimeLifecycleArtifact';
import type { GatewayRuntimeOperation } from './gatewayClient';

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  header.write(text, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function archive(entries: readonly Readonly<{ name: string; data: Buffer }>[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 0o755, 100, 8);
    writeOctal(header, entry.data.length, 124, 12);
    header.fill(0x20, 148, 156);
    header.write('0', 156, 1, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeOctal(header, checksum, 148, 8);
    blocks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    release_set_id: 'v1.2.3',
    gateway: {
      version: 'v9.8.7',
      sha256: 'a'.repeat(64),
      protocol: 'redeven-gateway-v2',
      capabilities: ['runtime_operations_v2', 'manual_recovery_v1', 'signed_artifact_policy_v1'],
    },
    runtime: {
      version: 'v1.2.3',
      sha256: 'b'.repeat(64),
      service_protocol: 'redeven-runtime-v2',
      compatibility_epoch: 9,
      capabilities: ['lifecycle_fence_v1'],
      platform: 'linux',
      architecture: 'amd64',
    },
    compatibility: {
      desktop_gateway_protocols: ['redeven-gateway-v2'],
      gateway_runtime_epochs: [9],
      upgrade_from_runtime_epochs: [],
      required_upgrade_order: ['gateway', 'runtime'],
    },
    ...overrides,
  };
}

describe('runtime lifecycle artifact', () => {
  it('hashes the final executable bytes independently from the archive bytes', () => {
    const executable = Buffer.from('runtime-executable-bytes');
    const tarGzip = archive([
      { name: 'LICENSE', data: Buffer.from('license') },
      { name: 'redeven', data: executable },
    ]);

    expect(runtimeExecutableFromArchive(tarGzip)).toEqual(executable);
    expect(runtimeExecutableFromArchive(tarGzip)).not.toEqual(tarGzip);
  });

  it('accepts independent Gateway and Runtime versions when protocol facts match', () => {
    expect(validateRuntimeCompatibilityManifest({
      value: manifest(),
      releaseTag: 'v1.2.3',
      platform: {
        goos: 'linux',
        goarch: 'amd64',
        platform_id: 'linux_amd64',
        release_package_name: 'redeven_linux_amd64.tar.gz',
        platform_label: 'linux/amd64',
      },
      currentRuntimeEpoch: 9,
    }).gateway.version).toBe('v9.8.7');
  });

  it('rejects a same-version manifest that lacks a required capability', () => {
    expect(() => validateRuntimeCompatibilityManifest({
      value: manifest({
        gateway: {
          version: 'v1.2.3',
          sha256: 'a'.repeat(64),
          protocol: 'redeven-gateway-v2',
          capabilities: ['runtime_operations_v2', 'manual_recovery_v1'],
        },
      }),
      releaseTag: 'v1.2.3',
      platform: {
        goos: 'linux',
        goarch: 'amd64',
        platform_id: 'linux_amd64',
        release_package_name: 'redeven_linux_amd64.tar.gz',
        platform_label: 'linux/amd64',
      },
      currentRuntimeEpoch: 9,
    })).toThrow('does not authorize');
  });

  it('rejects an unlisted cross-epoch managed update', () => {
    expect(() => validateRuntimeCompatibilityManifest({
      value: manifest(),
      releaseTag: 'v1.2.3',
      platform: {
        goos: 'linux',
        goarch: 'amd64',
        platform_id: 'linux_amd64',
        release_package_name: 'redeven_linux_amd64.tar.gz',
        platform_label: 'linux/amd64',
      },
      currentRuntimeEpoch: 8,
    })).toThrow('does not authorize');
  });

  it('binds a custom source build to the operation, target, inputs, archive, and executable', () => {
    const executable = Buffer.from('custom-runtime');
    const tarGzip = archive([{ name: 'redeven', data: executable }]);
    const operation: GatewayRuntimeOperation = {
      protocol_version: 'redeven-gateway-v2',
      operation_id: 'rop_custom',
      idempotency_key: 'runtime-initialization:rop_custom',
      lifecycle_target_id: 'rlt_local',
      target_generation: 7,
      gateway_env_id: 'env_local',
      kind: 'update_runtime',
      authorized_client_key_id: 'gck_desktop',
      desired_runtime: {
        version: 'v0.0.0-dev',
        platform: 'darwin',
        architecture: 'arm64',
        artifact_policy: 'custom_build',
      },
      build_inputs: {
        version: 'v0.0.0-dev',
        source: 'desktop_source_build',
        commit: 'abc123',
        architecture: 'arm64',
        platform: 'darwin',
      },
      state: 'awaiting_artifact',
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

    const metadata = buildCustomRuntimeArtifactMetadata(operation, tarGzip);
    expect(metadata.executable_sha256).toBe(createHash('sha256').update(executable).digest('hex'));
    expect(metadata.archive_sha256).toBe(createHash('sha256').update(tarGzip).digest('hex'));
    expect(metadata.build_attestation).toEqual({
      operation_id: 'rop_custom',
      lifecycle_target_id: 'rlt_local',
      target_generation: 7,
      build_inputs_digest: createHash('sha256').update(JSON.stringify({
        architecture: 'arm64',
        commit: 'abc123',
        platform: 'darwin',
        source: 'desktop_source_build',
        version: 'v0.0.0-dev',
      })).digest('base64url'),
      archive_sha256: metadata.archive_sha256,
      executable_sha256: metadata.executable_sha256,
      platform: 'darwin',
      architecture: 'arm64',
    });
  });
});
