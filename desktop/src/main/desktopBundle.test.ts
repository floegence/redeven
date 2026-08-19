import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDesktopBundle } from './desktopBundle';

const roots: string[] = [];

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function bundleFixture(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-desktop-bundle-'));
  roots.push(root);
  const runtime = Buffer.from("#!/bin/sh\nprintf 'redeven v1.2.3 (abc123) 2026-08-19T00:00:00Z\\n'\n");
  const gateway = Buffer.from("#!/bin/sh\nprintf 'redeven-gateway v1.2.3 (abc123) 2026-08-19T00:00:00Z\\n'\n");
  fs.writeFileSync(path.join(root, 'redeven'), runtime, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'redeven-gateway'), gateway, { mode: 0o755 });
  const manifest = {
    schema_version: 1,
    version: 'v1.2.3',
    commit: 'abc123',
    platform: 'linux',
    architecture: 'amd64',
    gateway: {
      path: 'redeven-gateway',
      sha256: sha256(gateway),
      size_bytes: gateway.length,
      executable: true,
    },
    runtime_suite: [{
      path: 'redeven',
      sha256: sha256(runtime),
      size_bytes: runtime.length,
      executable: true,
    }],
    ...overrides,
  };
  fs.writeFileSync(path.join(root, 'desktop-bundle-manifest.json'), `${JSON.stringify(manifest)}\n`);
  return root;
}

function replaceBundleArtifact(root: string, name: 'redeven' | 'redeven-gateway', value: Buffer): void {
  fs.writeFileSync(path.join(root, name), value, { mode: 0o755 });
  const manifestPath = path.join(root, 'desktop-bundle-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
    gateway: Record<string, unknown>;
    runtime_suite: Array<Record<string, unknown>>;
  };
  const descriptor = name === 'redeven-gateway'
    ? manifest.gateway
    : manifest.runtime_suite.find((artifact) => artifact.path === name);
  if (!descriptor) throw new Error(`Missing bundle artifact ${name}.`);
  descriptor.sha256 = sha256(value);
  descriptor.size_bytes = value.length;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Desktop precompiled bundle', () => {
  it('validates the exact packaged Gateway and Runtime identities before startup', async () => {
    const root = bundleFixture();

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).resolves.toMatchObject({
      root,
      version: 'v1.2.3',
      commit: 'abc123',
      gateway: { path: path.join(root, 'redeven-gateway') },
      runtime_suite: [{ path: path.join(root, 'redeven') }],
    });
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

  it.each(['redeven', 'redeven-gateway'])('rejects a digest mismatch for %s', async (name) => {
    const root = bundleFixture();
    const filePath = path.join(root, name);
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

  it.each([
    ['redeven', "#!/bin/sh\nprintf 'redeven v9.9.9 (abc123) now\\n'\n", 'version'],
    ['redeven-gateway', "#!/bin/sh\nprintf 'redeven-gateway v1.2.3 (different) now\\n'\n", 'commit'],
  ] as const)('rejects a digest-valid %s with a mismatched embedded identity', async (name, script, mismatch) => {
    const root = bundleFixture();
    replaceBundleArtifact(root, name, Buffer.from(script));

    await expect(loadDesktopBundle({
      root,
      expectedPlatform: 'linux',
      expectedArchitecture: 'amd64',
      expectedVersion: 'v1.2.3',
    })).rejects.toThrow(mismatch);
  });
});
