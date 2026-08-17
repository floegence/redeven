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

function createFixture(root) {
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
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf);
  elf.writeUInt16LE(3, 16);
  elf.writeUInt16LE(62, 18);
  writeFileSync(runtime, elf, { mode: 0o755 });
  writeFileSync(sbom, '{}\n');
  writeFileSync(provenance, '{}\n');
  writeFileSync(notices, 'notices\n');
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(signature, sign(null, elf, keys.privateKey));
  writeFileSync(certificate, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const marker = createRuntimeEvidence({
    profile: 'development', target: 'linux/amd64', releaseVerification: verification,
    runtimePath: runtime, sbomPath: sbom, provenancePath: provenance, noticesPath: notices,
    signaturePath: signature, certificatePath: certificate,
    product: { repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml', ref: 'refs/heads/fixture', source_commit: '2'.repeat(40) },
    cargoVersion: 'cargo 1.88.0 (fixture)', rustcVersion: 'rustc 1.88.0 (fixture)',
  });
  writeFileSync(path.join(root, runtimeMarkerName), `${JSON.stringify(marker, null, 2)}\n`);
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(script, args, { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`);
}

test('accepts a signed development runtime and rejects tampered evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-'));
  try {
    createFixture(root);
    run(['--scan-root', root, '--runtime-target', 'linux/amd64']);
    writeFileSync(path.join(root, runtimeNoticesName), 'tampered\n');
    run(['--scan-root', root, '--runtime-target', 'linux/amd64'], 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
