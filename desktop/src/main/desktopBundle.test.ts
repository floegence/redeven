import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDesktopBundle } from './desktopBundle';

const roots: string[] = [];
const managedWSLArchiveFiles = [
  '.redevplugin-release-artifacts-verified.json',
  'LICENSE',
  'REDEVPLUGIN_RUNTIME.spdx.json',
  'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_NOTICES.md',
  'redeven',
  'redevplugin-runtime',
  'redevplugin-runtime.pem',
  'redevplugin-runtime.provenance.json',
  'redevplugin-runtime.sig',
].sort((left, right) => left.localeCompare(right));

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function suiteSHA256(runtimeSuite: Array<Record<string, unknown>>): string {
  const identity = {
    schema_version: 1,
    files: runtimeSuite.map((artifact) => ({
      name: artifact.path,
      sha256: `sha256:${artifact.sha256}`,
      size_bytes: artifact.size_bytes,
      executable: artifact.executable,
    })).sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function bundleFixture(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-desktop-bundle-'));
  roots.push(root);
  const runtime = Buffer.from("#!/bin/sh\nprintf 'redeven v1.2.3 (abc123) 2026-08-19T00:00:00Z\\n'\n");
  fs.writeFileSync(path.join(root, 'redeven'), runtime, { mode: 0o755 });
  const runtimeContents = new Map<string, Buffer>([
    ['redeven', runtime],
    ['redevplugin-runtime', Buffer.from('plugin runtime')],
    ['.redevplugin-release-artifacts-verified.json', Buffer.from('{}\n')],
    ['REDEVPLUGIN_RUNTIME.spdx.json', Buffer.from('{}\n')],
    ['REDEVPLUGIN_THIRD_PARTY_NOTICES.md', Buffer.from('notices\n')],
    ['redevplugin-runtime.pem', Buffer.from('certificate\n')],
    ['redevplugin-runtime.provenance.json', Buffer.from('{}\n')],
    ['redevplugin-runtime.sig', Buffer.from('signature\n')],
  ]);
  for (const [name, bytes] of runtimeContents) {
    fs.writeFileSync(path.join(root, name), bytes, { mode: name === 'redeven' || name === 'redevplugin-runtime' ? 0o755 : 0o600 });
  }
  const runtimeFiles = [...runtimeContents].map(([name, bytes]) => ({
    path: name,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    executable: name === 'redeven' || name === 'redevplugin-runtime',
  }));
  const manifest = {
    schema_version: 4,
    version: 'v1.2.3',
    commit: 'abc123',
    platform: 'linux',
    architecture: 'amd64',
    provenance: 'packaged_bundle',
    distribution_kind: 'bundled_host_runtime',
    managed_wsl_runtime: null,
    runtime_files: runtimeFiles,
    runtime_files_sha256: suiteSHA256(runtimeFiles),
    ...overrides,
  };
  fs.writeFileSync(path.join(root, 'desktop-bundle-manifest.json'), `${JSON.stringify(manifest)}\n`);
  return root;
}

function windowsBundleFixture(attestationOverrides: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-desktop-wsl-bundle-'));
  roots.push(root);
  const archive = Buffer.from('verified-linux-amd64-runtime-archive');
  fs.writeFileSync(path.join(root, 'redeven_linux_amd64.tar.gz'), archive);
  const runtimeFiles = [{
    path: 'redeven_linux_amd64.tar.gz',
    sha256: sha256(archive),
    size_bytes: archive.length,
    executable: false,
  }];
  fs.writeFileSync(path.join(root, 'desktop-bundle-manifest.json'), `${JSON.stringify({
    schema_version: 4,
    version: 'v1.2.3',
    commit: 'abc123',
    platform: 'windows',
    architecture: 'amd64',
    provenance: 'packaged_bundle',
    distribution_kind: 'managed_wsl_archive',
    managed_wsl_runtime: {
      archive_path: 'redeven_linux_amd64.tar.gz',
      archive_sha256: runtimeFiles[0]!.sha256,
      archive_size_bytes: runtimeFiles[0]!.size_bytes,
      platform: 'linux',
      architecture: 'amd64',
      version: 'v1.2.3',
      commit: 'abc123',
      archive_files: managedWSLArchiveFiles,
      ...attestationOverrides,
    },
    runtime_files: runtimeFiles,
    runtime_files_sha256: suiteSHA256(runtimeFiles),
  })}\n`);
  return root;
}

function replaceBundleRuntime(root: string, value: Buffer): void {
  fs.writeFileSync(path.join(root, 'redeven'), value, { mode: 0o755 });
  const manifestPath = path.join(root, 'desktop-bundle-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
    runtime_files: Array<Record<string, unknown>>;
  };
  const descriptor = manifest.runtime_files.find((artifact) => artifact.path === 'redeven');
  if (!descriptor) throw new Error('Missing bundle Runtime artifact.');
  descriptor.sha256 = sha256(value);
  descriptor.size_bytes = value.length;
  manifest.runtime_files_sha256 = suiteSHA256(manifest.runtime_files);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Desktop precompiled bundle', () => {
  it('validates the exact packaged Runtime identity before startup', async () => {
    const root = bundleFixture();

    const bundle = await loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    });
    expect(bundle).toMatchObject({
      root,
      version: 'v1.2.3',
      commit: 'abc123',
    });
    expect(bundle.runtime_files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(root, 'redeven') }),
      expect.objectContaining({ path: path.join(root, 'redevplugin-runtime') }),
    ]));
  });

  it('accepts the complete Darwin Runtime suite and rejects a missing ReDevPlugin companion', async () => {
    const root = bundleFixture({ platform: 'darwin', architecture: 'arm64' });
    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'darwin',
      expectedArchitecture: 'arm64',
      expectedVersion: 'v1.2.3',
    })).resolves.toMatchObject({ platform: 'darwin', architecture: 'arm64' });

    const manifestPath = path.join(root, 'desktop-bundle-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
      runtime_files: Array<Record<string, unknown>>;
    };
    manifest.runtime_files = manifest.runtime_files.filter((artifact) => artifact.path !== 'redevplugin-runtime');
    manifest.runtime_files_sha256 = suiteSHA256(manifest.runtime_files);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'darwin',
      expectedArchitecture: 'arm64',
    })).rejects.toThrow('inventory');
  });

  it.each([
    ['platform', { platform: 'darwin' }, 'platform'],
    ['architecture', { architecture: 'arm64' }, 'architecture'],
    ['version', { version: 'v9.9.9' }, 'version'],
    ['commit', { commit: 'different' }, 'commit'],
  ])('rejects a bundle with the wrong %s', async (_label, overrides, message) => {
    await expect(loadDesktopBundle({
      root: bundleFixture(overrides),
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
      expectedCommit: message === 'commit' ? 'abc123' : undefined,
    })).rejects.toThrow(message);
  });

  it('rejects a Runtime digest mismatch', async () => {
    const root = bundleFixture();
    const filePath = path.join(root, 'redeven');
    const tampered = fs.readFileSync(filePath);
    tampered[0] = tampered[0] === 0 ? 1 : 0;
    fs.writeFileSync(filePath, tampered, { mode: 0o755 });

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).rejects.toThrow('digest');
  });

  it('rejects symlinked bundle entries', async () => {
    const root = bundleFixture();
    const external = path.join(root, 'external-runtime');
    fs.renameSync(path.join(root, 'redeven'), external);
    fs.symlinkSync(external, path.join(root, 'redeven'));

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).rejects.toThrow('regular non-symlink file');
  });

  it('rejects a digest-valid Runtime with a mismatched embedded identity', async () => {
    const root = bundleFixture();
    replaceBundleRuntime(root, Buffer.from("#!/bin/sh\nprintf 'redeven v9.9.9 (abc123) now\\n'\n"));

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).rejects.toThrow('version');
  });

  it('rejects the retired Gateway and Runtime suite manifest shape', async () => {
    await expect(loadDesktopBundle({
      root: bundleFixture({ schema_version: 2, gateway: {}, runtime_suite: [] }),
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
    })).rejects.toThrow('unsupported shape');
  });

  it('validates a Windows bundle containing only the managed Linux x64 archive', async () => {
    const root = windowsBundleFixture();

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'windows',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).resolves.toMatchObject({
      distribution_kind: 'managed_wsl_archive',
      managed_wsl_runtime: {
        platform: 'linux',
        architecture: 'amd64',
        version: 'v1.2.3',
        commit: 'abc123',
        archive_files: managedWSLArchiveFiles,
      },
      managed_wsl_archive_path: path.join(root, 'redeven_linux_amd64.tar.gz'),
      runtime_files: [{ executable: false }],
    });
  });

  it('rejects a Windows bundle whose managed WSL target attestation was changed', async () => {
    const root = windowsBundleFixture({ architecture: 'arm64' });

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'windows',
      expectedArchitecture: 'amd64',
    })).rejects.toThrow('attestation');
  });
});
