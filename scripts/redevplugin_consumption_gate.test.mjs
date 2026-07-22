import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPublicationVerification,
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
const sourceCommit = '1'.repeat(40);
const productCommit = '2'.repeat(40);
const packageSet = {
  schema_version: 'redevplugin.platform_package_set.v1',
  platform_version: version,
  go_module: { module: 'github.com/floegence/redevplugin', version: `v${version}` },
  npm_packages: [
    { name: '@floegence/redevplugin-contracts', version },
    { name: '@floegence/redevplugin-ui', version },
  ],
  rust_crates: [
    { name: 'redevplugin-contracts', version, role: 'contracts' },
    { name: 'redevplugin-ipc', version, role: 'ipc' },
    { name: 'redevplugin-wasm-abi', version, role: 'wasm_abi' },
    { name: 'redevplugin-target-classifier', version, role: 'target_classifier' },
    { name: 'redevplugin-worker-sdk', version, role: 'worker_sdk' },
    { name: 'redevplugin-runtime', version, role: 'runtime' },
  ],
  contract_registry_version: 'contract-registry-v2',
  contract_set_sha256: '3'.repeat(64),
};
const integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const publication = {
  schema_version: 'redevplugin.platform_package_publication.v1',
  platform_version: version,
  source_commit: sourceCommit,
  workflow: {
    repository: 'floegence/redevplugin',
    path: '.github/workflows/release.yml',
    ref: `refs/tags/v${version}`,
    sha: sourceCommit,
  },
  go_module: {
    module: 'github.com/floegence/redevplugin', version: `v${version}`,
    h1: `h1:${Buffer.alloc(32, 8).toString('base64')}`,
    go_mod_h1: `h1:${Buffer.alloc(32, 9).toString('base64')}`,
  },
  npm_packages: packageSet.npm_packages.map((coordinate) => ({
    ...coordinate, integrity, provenance_subject_sha512: Buffer.alloc(64, 7).toString('hex'),
  })),
  rust_crates: packageSet.rust_crates.map(({ name }) => ({
    name, version, registry_checksum_sha256: '4'.repeat(64),
  })),
  contract_set_sha256: packageSet.contract_set_sha256,
};

function createFixture(root) {
  mkdirSync(root, { recursive: true });
  const publicationPath = path.join(root, 'platform-package-publication-v1.json');
  writeFileSync(publicationPath, `${JSON.stringify(publication)}\n`);
  const verification = createPublicationVerification(publication, packageSet, `v${version}`, publicationPath);
  rmSync(publicationPath);
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
    profile: 'development',
    target: 'linux/amd64',
    publicationVerification: verification,
    packageSet,
    runtimePath: runtime,
    sbomPath: sbom,
    provenancePath: provenance,
    noticesPath: notices,
    signaturePath: signature,
    certificatePath: certificate,
    product: {
      repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml',
      ref: 'refs/heads/fixture', source_commit: productCommit,
    },
    cargoVersion: 'cargo 1.88.0 (873a06493 2025-05-10)',
    rustcVersion: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
  });
  writeFileSync(path.join(root, runtimeMarkerName), `${JSON.stringify(marker, null, 2)}\n`);
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(script, args, { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

test('accepts a signed development runtime and rejects tampered evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-'));
  try {
    createFixture(root);
    run(['--scan-root', root, '--runtime-target', 'linux/amd64']);
    writeFileSync(path.join(root, runtimeNoticesName), 'tampered\n');
    assert.match(run(['--scan-root', root, '--runtime-target', 'linux/amd64'], 1), /descriptor mismatch/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts a closed Linux archive and requires release evidence when requested', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-'));
  try {
    const payload = path.join(root, 'payload');
    createFixture(payload);
    writeFileSync(path.join(payload, 'redeven'), 'redeven\n');
    writeFileSync(path.join(payload, 'LICENSE'), 'license\n');
    writeFileSync(path.join(payload, 'THIRD_PARTY_NOTICES.md'), 'product notices\n');
    const archive = path.join(root, 'redeven_linux_amd64.tar.gz');
    execFileSync('tar', ['--format=ustar', '-czf', archive, '-C', payload, ...readdirSync(payload).sort()], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    rmSync(payload, { recursive: true, force: true });
    run(['--scan-root', root]);
    assert.match(run(['--scan-root', root, '--require-release'], 1), /profile/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Darwin policy accepts absence and rejects runtime payloads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-consumption-'));
  try {
    run(['--scan-root', root, '--runtime-target', 'darwin/arm64']);
    writeFileSync(path.join(root, 'redevplugin-runtime'), 'forbidden\n');
    assert.match(run(['--scan-root', root, '--runtime-target', 'darwin/arm64'], 1), /must not contain/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
