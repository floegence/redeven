import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyELF } from '../../../../scripts/redevplugin_release_contract.mjs';
import {
  createLinuxReDevPluginRuntimeFixture,
  installReDevPluginRuntimeFixture,
} from './redevpluginRuntimeFixture.mjs';

test('creates admission-compatible Linux runtime fixtures for supported architectures', async () => {
  for (const [arch, target, machine] of [
    ['x64', 'linux/amd64', 62],
    ['arm64', 'linux/arm64', 183],
  ]) {
    const fixture = createLinuxReDevPluginRuntimeFixture(arch);
    assert.equal(fixture.length, 64);
    assert.equal(fixture.readUInt16LE(16), 3);
    assert.equal(fixture.readUInt16LE(18), machine);
    assert.equal(fixture.readUInt16LE(56), 0);

    const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-redevplugin-fixture-'));
    try {
      const runtimePath = path.join(root, 'redevplugin-runtime');
      await writeFile(runtimePath, fixture);
      verifyELF(runtimePath, target);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('installs the fixture only for Linux and preserves executable-only permissions', async () => {
  const linuxRoot = await mkdtemp(path.join(os.tmpdir(), 'redeven-redevplugin-linux-'));
  const darwinRoot = await mkdtemp(path.join(os.tmpdir(), 'redeven-redevplugin-darwin-'));
  try {
    const runtimePath = await installReDevPluginRuntimeFixture(linuxRoot, {
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(runtimePath, path.join(linuxRoot, 'redevplugin-runtime'));
    assert.equal((await stat(runtimePath)).mode & 0o777, 0o500);
    assert.equal((await readFile(runtimePath)).length, 64);
    verifyELF(runtimePath, 'linux/amd64');

    assert.equal(await installReDevPluginRuntimeFixture(darwinRoot, {
      platform: 'darwin',
      arch: 'arm64',
    }), null);
    await assert.rejects(stat(path.join(darwinRoot, 'redevplugin-runtime')), { code: 'ENOENT' });
  } finally {
    await rm(linuxRoot, { recursive: true, force: true });
    await rm(darwinRoot, { recursive: true, force: true });
  }
});

test('rejects unsupported Linux runtime architectures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-redevplugin-unsupported-'));
  try {
    await assert.rejects(
      installReDevPluginRuntimeFixture(root, { platform: 'linux', arch: 'riscv64' }),
      /unsupported ReDevPlugin test runtime architecture/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
