import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createReleaseVerification,
  createRuntimeEvidence,
  createRuntimeProvenance,
  parseStrictJSON,
  projectRuntimeCargoMetadata,
  runtimeCertificateName,
  runtimeNoticesName,
  runtimeProvenanceName,
  runtimeSBOMName,
  runtimeSignatureName,
  validateReleaseManifest,
  validateRuntimeEvidence,
  verifyELF,
} from './redevplugin_release_contract.mjs';

const version = '1.2.3';
const productCommit = '2'.repeat(40);

test('runtime staging derives its release tag from the published Go dependency', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, 'stage_redevplugin_release_artifacts.sh'), 'utf8');
  assert.match(source, /GOWORK=off go list -m -f '\{\{\.Version\}\}' github\.com\/floegence\/redevplugin\/v3/u);
  assert.match(source, /release manifest version does not match Go module version/u);
  assert.doesNotMatch(source, /read_redevplugin_release_manifest/u);
});
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

function clone(value) {
  return structuredClone(value);
}

test('strict JSON rejects duplicate fields and trailing data', () => {
  assert.deepEqual(parseStrictJSON('{"a":[true,null,-1.2e3]}'), { a: [true, null, -1200] });
  assert.throws(() => parseStrictJSON('{"a":1,"a":2}'), /duplicate field a/u);
  assert.throws(() => parseStrictJSON('{} null'), /trailing data/u);
});

test('platform release manifest is the single closed artifact contract', () => {
  assert.deepEqual(validateReleaseManifest(manifest, { tag: `v${version}` }), manifest);
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.platform_version = '01.2.3'; },
    (value) => { value.artifacts.reverse(); },
    (value) => { value.artifacts[0].sha256 = 'bad'; },
    (value) => { value.artifacts.pop(); },
  ]) {
    const candidate = clone(manifest);
    mutate(candidate);
    assert.throws(() => validateReleaseManifest(candidate, { tag: `v${version}` }));
  }
});

test('runtime Cargo projection excludes development-only dependencies', () => {
  const source = 'registry+https://github.com/rust-lang/crates.io-index';
  const root = `${source}#redevplugin-runtime@${version}`;
  const serde = `${source}#serde@1.0.0`;
  const build = `${source}#cc@1.0.0`;
  const dev = `${source}#proptest@1.0.0`;
  const pkg = (id, name, packageVersion = '1.0.0') => ({ id, name, version: packageVersion, source, license: 'MIT' });
  const metadata = {
    packages: [pkg(root, 'redevplugin-runtime', version), pkg(serde, 'serde'), pkg(build, 'cc'), pkg(dev, 'proptest')],
    resolve: { root, nodes: [
      { id: root, deps: [{ pkg: serde, dep_kinds: [{ kind: null }] }, { pkg: build, dep_kinds: [{ kind: 'build' }] }, { pkg: dev, dep_kinds: [{ kind: 'dev' }] }] },
      { id: serde, deps: [] }, { id: build, deps: [] }, { id: dev, deps: [] },
    ] },
    workspace_members: [root],
  };
  assert.equal(projectRuntimeCargoMetadata(metadata).packages.length, 3);
});

test('runtime evidence binds the release manifest and every product file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-contract-'));
  try {
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
    writeFileSync(runtime, elf);
    writeFileSync(sbom, '{}\n');
    writeFileSync(provenance, '{}\n');
    writeFileSync(notices, 'notices\n');
    const keys = generateKeyPairSync('ed25519');
    writeFileSync(signature, sign(null, elf, keys.privateKey));
    writeFileSync(certificate, keys.publicKey.export({ format: 'pem', type: 'spki' }));
    const product = {
      repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml',
      ref: 'refs/heads/feature', source_commit: productCommit,
    };
    const marker = createRuntimeEvidence({
      profile: 'development', target: 'linux/amd64', releaseVerification: verification,
      runtimePath: runtime, sbomPath: sbom, provenancePath: provenance, noticesPath: notices,
      signaturePath: signature, certificatePath: certificate, product,
      cargoVersion: 'cargo 1.88.0 (fixture)', rustcVersion: 'rustc 1.88.0 (fixture)',
    });
    assert.equal(validateRuntimeEvidence(marker, root, { target: 'linux/amd64' }).runtime.target, 'linux/amd64');
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/arm64' }), /target mismatch/u);
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/amd64', requireRelease: true }), /profile/u);
    verifyELF(runtime, 'linux/amd64');
    writeFileSync(notices, 'tampered\n');
    assert.throws(() => validateRuntimeEvidence(marker, root, { target: 'linux/amd64' }), /descriptor mismatch/u);
    assert.notEqual(readFileSync(notices, 'utf8'), 'notices\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime provenance requires the exact published runtime crate', () => {
  const source = 'registry+https://github.com/rust-lang/crates.io-index';
  const rootID = `${source}#redevplugin-runtime@${version}`;
  const serdeID = `${source}#serde@1.0.0`;
  const metadata = {
    packages: [
      { id: rootID, name: 'redevplugin-runtime', version, source: null, license: 'Apache-2.0' },
      { id: serdeID, name: 'serde', version: '1.0.0', source, license: 'MIT' },
    ],
    resolve: { root: rootID }, workspace_members: [rootID],
  };
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-provenance-'));
  try {
    const manifestPath = path.join(root, 'platform-release-manifest.json');
    const runtimePath = path.join(root, 'redevplugin-runtime');
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    writeFileSync(runtimePath, 'runtime\n');
    const verification = createReleaseVerification(manifest, `v${version}`, manifestPath);
    const provenance = createRuntimeProvenance({
      releaseVerification: verification,
      product: { repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml', ref: 'refs/heads/feature', source_commit: productCommit },
      target: 'linux/amd64', runtimePath, metadata,
    });
    assert.equal(provenance.resolved_registry_packages.length, 2);
    const invalid = clone(metadata);
    invalid.packages[0].version = '9.9.9';
    assert.throws(() => createRuntimeProvenance({
      releaseVerification: verification,
      product: { repository: 'floegence/redeven', workflow_path: '.github/workflows/release.yml', ref: 'refs/heads/feature', source_commit: productCommit },
      target: 'linux/amd64', runtimePath, metadata: invalid,
    }), /runtime crate/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
