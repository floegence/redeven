import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  runtimeExecutableFromArchive,
  validateRuntimeCompatibilityManifest,
} from './runtimeLifecycleArtifact';

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
});
