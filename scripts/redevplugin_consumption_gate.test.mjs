import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  createReleaseVerification,
  createRuntimeEvidence,
  runtimeCertificateName,
  runtimeMarkerName,
  runtimeNoticesName,
  runtimeProvenanceName,
  runtimeSBOMName,
  runtimeSignatureName,
} from './redevplugin_release_contract.mjs';

const script = path.resolve(import.meta.dirname, 'check_redevplugin_consumption_gate.sh');
const version = '1.2.3';
const manifest = {
  platform_version: version,
  plugin_api: 1,
  internal_wire: 1,
  artifacts: [
    { name: 'contract:plugin/api.json', sha256: '1'.repeat(64) },
    { name: 'crate:redevplugin-runtime', sha256: '2'.repeat(64) },
    { name: 'crate:redevplugin-worker-sdk', sha256: '3'.repeat(64) },
    { name: 'go:github.com/floegence/redevplugin/v3', sha256: '4'.repeat(64) },
    { name: 'npm:@floegence/redevplugin-contracts', sha256: '5'.repeat(64) },
    { name: 'npm:@floegence/redevplugin-ui', sha256: '6'.repeat(64) },
  ],
};

function createFixture(root, target = 'linux/amd64', invalidSignature = false) {
  mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, 'platform-release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const verification = createReleaseVerification(manifest, `v${version}`, manifestPath);
  const runtime = path.join(root, 'redevplugin-runtime');
  const sbom = path.join(root, runtimeSBOMName);
  const provenance = path.join(root, runtimeProvenanceName);
  const notices = path.join(root, runtimeNoticesName);
  const signature = path.join(root, runtimeSignatureName);
  const certificate = path.join(root, runtimeCertificateName);
  const executable = Buffer.alloc(target.startsWith('linux/') ? 64 : 32);
  if (target.startsWith('linux/')) {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(executable);
    executable.writeUInt16LE(3, 16);
    executable.writeUInt16LE(target === 'linux/amd64' ? 62 : 183, 18);
  } else {
    executable.writeUInt32LE(0xfeedfacf, 0);
    executable.writeUInt32LE(target === 'darwin/amd64' ? 0x01000007 : 0x0100000c, 4);
    executable.writeUInt32LE(2, 12);
  }
  writeFileSync(runtime, executable, { mode: 0o755 });
  writeFileSync(sbom, '{}\n');
  writeFileSync(provenance, '{}\n');
  writeFileSync(notices, 'notices\n');
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(signature, invalidSignature ? Buffer.alloc(64) : sign(null, executable, keys.privateKey));
  writeFileSync(certificate, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const marker = createRuntimeEvidence({
    profile: 'development', target, releaseVerification: verification,
    runtimePath: runtime, sbomPath: sbom, provenancePath: provenance, noticesPath: notices,
    signaturePath: signature, certificatePath: certificate,
    product: { repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml', ref: 'refs/heads/fixture', source_commit: '2'.repeat(40) },
    cargoVersion: 'cargo 1.98.0 (fixture)', rustcVersion: 'rustc 1.98.0 (fixture)',
  });
  writeFileSync(path.join(root, runtimeMarkerName), `${JSON.stringify(marker, null, 2)}\n`);
}

function run(args, expectedStatus = 0, env = process.env) {
  const result = spawnSync(script, args, { encoding: 'utf8', env });
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`);
}

test('accepts a signed development runtime and rejects tampered evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-'));
  try {
    createFixture(root);
    writeFileSync(path.join(root, 'redeven_relink_linux_amd64.tar.gz'), 'relink payload is verified by the Linux relink gate');
    run(['--scan-root', root, '--runtime-target', 'linux/amd64']);
    writeFileSync(path.join(root, runtimeNoticesName), 'tampered\n');
    run(['--scan-root', root, '--runtime-target', 'linux/amd64'], 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Darwin consumption verifies the exact Mach-O identity and hardened signature', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-darwin-'));
  try {
    createFixture(root, 'darwin/arm64');
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\nprintf Darwin\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'codesign'), [
      '#!/bin/sh', 'set -eu',
      'if [ "$1" = --verify ]; then exit "$FIXTURE_CODESIGN_STATUS"; fi',
      'if [ "$2" = --verbose=4 ]; then printf "CodeDirectory v=20500 flags=%s\\n" "$FIXTURE_FLAGS" >&2; exit 0; fi',
      'cat "$FIXTURE_ENTITLEMENTS"', '',
    ].join('\n'), { mode: 0o755 });
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      FIXTURE_CODESIGN_STATUS: '0', FIXTURE_FLAGS: '0x10002(adhoc,runtime)',
      FIXTURE_ENTITLEMENTS: new URL('./redevplugin-runtime-entitlements.plist', import.meta.url).pathname };
    run(['--scan-root', root, '--runtime-target', 'darwin/arm64'], 0, env);
    run(['--scan-root', root, '--runtime-target', 'darwin/amd64'], 1, env);
    run(['--scan-root', root, '--runtime-target', 'darwin/arm64'], 1, { ...env, FIXTURE_CODESIGN_STATUS: '1' });
    run(['--scan-root', root, '--runtime-target', 'darwin/arm64'], 1, { ...env, FIXTURE_FLAGS: '0x2(adhoc)' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive consumption cannot swallow a failed cryptographic signature inside a shell conditional', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-archive-'));
  try {
    const payload = path.join(root, 'payload');
    const archives = path.join(root, 'archives');
    mkdirSync(archives);
    const archive = path.join(archives, 'redeven_linux_amd64.tar.gz');
    for (const invalidSignature of [false, true]) {
      createFixture(payload, 'linux/amd64', invalidSignature);
      for (const name of ['redeven', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) writeFileSync(path.join(payload, name), name);
      const packed = spawnSync('python3', ['-c', [
        'import sys, tarfile', 'from pathlib import Path',
        'root = Path(sys.argv[1])',
        'with tarfile.open(sys.argv[2], "w:gz", format=tarfile.USTAR_FORMAT) as archive:',
        '    for item in sorted(root.iterdir()):',
        '        if item.name != "platform-release-manifest.json": archive.add(item, arcname=item.name)',
      ].join('\n'), payload, archive], { encoding: 'utf8' });
      assert.equal(packed.status, 0, packed.stderr);
      run(['--scan-root', archives], invalidSignature ? 1 : 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
