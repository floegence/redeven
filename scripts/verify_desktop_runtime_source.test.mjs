import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyDesktopRuntimeSource } from './verify_desktop_runtime_source.mjs';

test('Windows staging binds the Linux source version and commit to every extracted artifact', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-source-identity-'));
  try {
    const names = ['.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json',
      'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redeven', 'redevplugin-runtime',
      'redevplugin-runtime.pem', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig'];
    const runtimeFiles = names.map((name) => {
      const data = Buffer.from(`fixture ${name}`);
      writeFileSync(path.join(root, name), data);
      return { path: name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length,
        executable: name === 'redeven' || name === 'redevplugin-runtime' };
    });
    const identity = { schema_version: 1, files: runtimeFiles.map((file) => ({ name: file.path,
      sha256: `sha256:${file.sha256}`, size_bytes: file.size_bytes, executable: file.executable,
    })).sort((a, b) => a.name.localeCompare(b.name)) };
    const manifest = { schema_version: 4, platform: 'linux', architecture: 'amd64', provenance: 'packaged_bundle',
      distribution_kind: 'bundled_host_runtime', managed_wsl_runtime: null,
      version: 'v0.12.0-test.1', commit: '0123456789ab', runtime_files: runtimeFiles,
      runtime_files_sha256: `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}` };
    const manifestPath = path.join(root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const verify = (version = manifest.version, commit = manifest.commit) =>
      verifyDesktopRuntimeSource(manifestPath, root, version, commit);
    assert.doesNotThrow(() => verify());
    assert.throws(() => verify('v0.12.0-other'), /identity/u);
    assert.throws(() => verify(manifest.version, 'different'), /identity/u);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, runtime_files_sha256: 'sha256:bad' }));
    assert.throws(() => verify(), /suite digest/u);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(path.join(root, 'redeven'), 'tampered');
    assert.throws(() => verify(), /differs from its source manifest/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
