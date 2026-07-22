import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPublicationVerification,
  createRuntimeEvidence,
  createRuntimeProvenance,
  parseStrictJSON,
  runtimeCertificateName,
  runtimeNoticesName,
  runtimeProvenanceName,
  runtimeSBOMName,
  runtimeSignatureName,
  validatePackageSet,
  validatePublication,
  validateRuntimeEvidence,
  verifyELF,
} from './redevplugin_release_contract.mjs';

const version = '1.2.3';
const sourceCommit = '1'.repeat(40);
const productCommit = '2'.repeat(40);
const contractSetSHA256 = '3'.repeat(64);
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
  contract_set_sha256: contractSetSHA256,
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
    module: 'github.com/floegence/redevplugin',
    version: `v${version}`,
    h1: `h1:${Buffer.alloc(32, 8).toString('base64')}`,
    go_mod_h1: `h1:${Buffer.alloc(32, 9).toString('base64')}`,
  },
  npm_packages: packageSet.npm_packages.map((coordinate) => ({
    ...coordinate,
    integrity,
    provenance_subject_sha512: Buffer.alloc(64, 7).toString('hex'),
  })),
  rust_crates: packageSet.rust_crates.map(({ name }) => ({
    name,
    version,
    registry_checksum_sha256: '4'.repeat(64),
  })),
  contract_set_sha256: contractSetSHA256,
};

function clone(value) {
  return structuredClone(value);
}

test('strict JSON rejects duplicate fields and trailing data', () => {
  assert.deepEqual(parseStrictJSON('{"a":[true, null, -1.2e3]}'), { a: [true, null, -1200] });
  assert.throws(() => parseStrictJSON('{"a":1,"a":2}'), /duplicate field a/u);
  assert.throws(() => parseStrictJSON('{} null'), /trailing data/u);
  assert.throws(() => parseStrictJSON('{"a":"\\x"}'), /invalid escape/u);
});

test('package set is a closed two-npm six-crate contract', () => {
  assert.deepEqual(validatePackageSet(packageSet), packageSet);
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.platform_version = '01.2.3'; },
    (value) => { value.npm_packages.reverse(); },
    (value) => { value.rust_crates[5].name = 'runtime-copy'; },
    (value) => { value.rust_crates.pop(); },
    (value) => { value.contract_set_sha256 = 'x'; },
  ]) {
    const candidate = clone(packageSet);
    mutate(candidate);
    assert.throws(() => validatePackageSet(candidate));
  }
});

test('publication binds workflow, source, integrity, and all package coordinates', () => {
  assert.deepEqual(validatePublication(publication, packageSet, { tag: `v${version}`, sourceCommit }), publication);
  for (const mutate of [
    (value) => { value.workflow.repository = 'other/repository'; },
    (value) => { value.workflow.ref = 'refs/heads/main'; },
    (value) => { value.go_module.h1 = 'bad'; },
    (value) => { value.npm_packages[0].provenance_subject_sha512 = '5'.repeat(128); },
    (value) => { value.rust_crates[0].registry_checksum_sha256 = 'bad'; },
    (value) => { value.rust_crates.reverse(); },
  ]) {
    const candidate = clone(publication);
    mutate(candidate);
    assert.throws(() => validatePublication(candidate, packageSet, { tag: `v${version}` }));
  }
});

test('runtime provenance requires the exact crates.io package graph rooted at the runtime crate', () => {
  const source = 'registry+https://github.com/rust-lang/crates.io-index';
  const runtimeNames = new Set(['redevplugin-ipc', 'redevplugin-runtime', 'redevplugin-wasm-abi']);
  const packages = packageSet.rust_crates.filter(({ name }) => runtimeNames.has(name)).map((coordinate) => ({
    id: `${source}#${coordinate.name}@${coordinate.version}`,
    name: coordinate.name,
    version: coordinate.version,
    source,
    license: 'Apache-2.0',
  }));
  const runtime = packages.at(-1);
  runtime.source = null;
  const metadata = { packages, resolve: { root: runtime.id }, workspace_members: [runtime.id] };
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-redevplugin-provenance-'));
  try {
    const runtimePath = path.join(root, 'redevplugin-runtime');
    const publicationPath = path.join(root, 'platform-package-publication-v1.json');
    writeFileSync(runtimePath, 'runtime\n');
    writeFileSync(publicationPath, `${JSON.stringify(publication)}\n`);
    const verification = createPublicationVerification(publication, packageSet, `v${version}`, publicationPath);
    const product = {
      repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml',
      ref: 'refs/heads/feature', source_commit: productCommit,
    };
    const provenance = createRuntimeProvenance({
      publicationVerification: verification, packageSet, product, target: 'linux/amd64',
      runtimePath, metadata,
    });
    assert.equal(provenance.resolved_registry_packages.filter(({ name }) => name.startsWith('redevplugin-')).length, 3);
    assert.equal(provenance.resolved_registry_packages.at(-1).source, source);
    const missing = clone(metadata);
    missing.packages.splice(0, 1);
    assert.throws(() => createRuntimeProvenance({
      publicationVerification: verification, packageSet, product, target: 'linux/amd64',
      runtimePath, metadata: missing,
    }), /runtime crate set mismatch/u);
    const extra = clone(metadata);
    const classifier = packageSet.rust_crates.find(({ name }) => name === 'redevplugin-target-classifier');
    extra.packages.push({
      id: `${source}#${classifier.name}@${classifier.version}`,
      name: classifier.name,
      version: classifier.version,
      source,
      license: 'Apache-2.0',
    });
    assert.throws(() => createRuntimeProvenance({
      publicationVerification: verification, packageSet, product, target: 'linux/amd64',
      runtimePath, metadata: extra,
    }), /runtime crate set mismatch/u);
    const local = clone(metadata);
    local.packages[0].source = null;
    assert.throws(() => createRuntimeProvenance({
      publicationVerification: verification, packageSet, product, target: 'linux/amd64',
      runtimePath, metadata: local,
    }), /not from crates\.io/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime evidence binds every product-built file and rejects tampering', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-redevplugin-contract-'));
  try {
    const publicationPath = path.join(root, 'platform-package-publication-v1.json');
    writeFileSync(publicationPath, `${JSON.stringify(publication)}\n`);
    const verification = createPublicationVerification(publication, packageSet, `v${version}`, publicationPath);
    const runtime = path.join(root, 'redevplugin-runtime');
    const sbom = path.join(root, runtimeSBOMName);
    const provenance = path.join(root, runtimeProvenanceName);
    const notices = path.join(root, runtimeNoticesName);
    const signature = path.join(root, runtimeSignatureName);
    const certificate = path.join(root, runtimeCertificateName);
    const elf = Buffer.alloc(64);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf);
    elf.writeUInt16LE(62, 18);
    writeFileSync(runtime, elf);
    writeFileSync(sbom, '{}\n');
    writeFileSync(provenance, '{}\n');
    writeFileSync(notices, 'notices\n');
    const keys = generateKeyPairSync('ed25519');
    writeFileSync(signature, sign(null, elf, keys.privateKey));
    writeFileSync(certificate, keys.publicKey.export({ format: 'pem', type: 'spki' }));
    const product = {
      repository: 'floegence/redeven',
      workflow_path: '.github/workflows/release.yml',
      ref: 'refs/heads/feature',
      source_commit: productCommit,
    };
    const marker = createRuntimeEvidence({
      profile: 'development', target: 'linux/amd64', publicationVerification: verification,
      packageSet, runtimePath: runtime, sbomPath: sbom, provenancePath: provenance,
      noticesPath: notices, signaturePath: signature, certificatePath: certificate,
      product, cargoVersion: 'cargo 1.88.0 (873a06493 2025-05-10)',
      rustcVersion: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
    });
    assert.equal(validateRuntimeEvidence(marker, root, { target: 'linux/amd64' }).runtime.target, 'linux/amd64');
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/arm64' }), /target mismatch/u);
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/amd64', requireRelease: true }), /profile/u);
    verifyELF(runtime, 'linux/amd64');
    assert.throws(() => verifyELF(runtime, 'linux/arm64'), /does not match/u);
    writeFileSync(notices, 'tampered\n');
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/amd64' }), /descriptor mismatch/u);
    assert.notEqual(readFileSync(notices, 'utf8'), 'notices\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
