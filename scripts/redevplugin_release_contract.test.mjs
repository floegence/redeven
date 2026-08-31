import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  verifyMachO,
  verifyRuntimeExecutable,
} from './redevplugin_release_contract.mjs';

const version = '1.2.3';
const productCommit = '2'.repeat(40);
const staticPIELinker = path.resolve(import.meta.dirname, 'link_redevplugin_runtime_static_pie.sh');

function writeExecutable(filePath, source) {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o700);
}

function runStaticPIELinker(arguments_, environment) {
  const result = spawnSync(staticPIELinker, arguments_, {
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('runtime staging derives its release tag from the published Go dependency', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, 'stage_redevplugin_release_artifacts.sh'), 'utf8');
  assert.match(source, /GOWORK=off go list -m -f '\{\{\.Version\}\}' github\.com\/floegence\/redevplugin\/v3/u);
  assert.match(source, /--manifest-file <file>/u);
  assert.match(source, /verify-release-manifest.*\$manifest.*\$tag/u);
  assert.match(source, /if \[\[ -n "\$manifest_file" \]\]/u);
  assert.match(source, /curl[\s\S]*releases\/download\/\$tag\/\$RELEASE_MANIFEST_ASSET/u);
  assert.doesNotMatch(source, /gh release download/u);
  const verificationSource = readFileSync(path.resolve(import.meta.dirname, 'check_redevplugin_release_artifacts.sh'), 'utf8');
  assert.match(verificationSource, /api\.github\.com\/repos\/\$REPOSITORY\/releases\/tags\/\$tag/u);
  assert.doesNotMatch(verificationSource, /gh release view/u);
  assert.match(source, /release manifest version does not match Go module version/u);
  assert.match(source, /redevplugin_release_contract\.mjs" verify-runtime-executable "\$runtime" "\$target"/u);
  assert.match(source, /link_redevplugin_runtime_static_pie\.sh/u);
  assert.doesNotMatch(source, /\breadelf\b/u);
  assert.doesNotMatch(source, /\bmapfile\b/u);
  assert.doesNotMatch(source, /read_redevplugin_release_manifest/u);
});

test('static PIE compiler driver keeps driver arguments', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-static-pie-cc-'));
  try {
    const bin = path.join(root, 'bin');
    const capture = path.join(root, 'arguments.txt');
    const compiler = path.join(bin, 'cc');
    mkdirSync(bin);
    writeExecutable(path.join(bin, 'uname'), '#!/usr/bin/env bash\nprintf "Linux\\n"\n');
    writeExecutable(compiler, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$LINK_CAPTURE"\n');

    runStaticPIELinker(
      ['-m64', '-Wl,--as-needed', '-nostartfiles', '-static', '-no-pie', '-nodefaultlibs', 'input.o'],
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REDEVPLUGIN_STATIC_PIE_CC: compiler,
        LINK_CAPTURE: capture,
      },
    );

    assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
      '-m64',
      '-Wl,--as-needed',
      '-nostartfiles',
      '-nodefaultlibs',
      'input.o',
      '-static-pie',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Darwin direct LLD removes compiler driver arguments', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-static-pie-lld-'));
  try {
    const bin = path.join(root, 'bin');
    const sysroot = path.join(root, 'rust');
    const capture = path.join(root, 'arguments.txt');
    const rustLLD = path.join(sysroot, 'lib', 'rustlib', 'aarch64-apple-darwin', 'bin', 'rust-lld');
    mkdirSync(bin);
    mkdirSync(path.dirname(rustLLD), { recursive: true });
    writeExecutable(path.join(bin, 'uname'), '#!/usr/bin/env bash\nprintf "Darwin\\n"\n');
    writeExecutable(path.join(bin, 'rustc'), `#!/usr/bin/env bash
if [[ "$1" == "--print" ]]; then
  printf "%s\\n" "$FAKE_RUST_SYSROOT"
else
  printf "host: aarch64-apple-darwin\\n"
fi
`);
    writeExecutable(rustLLD, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$LINK_CAPTURE"\n');

    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_RUST_SYSROOT: sysroot,
      LINK_CAPTURE: capture,
    };
    delete environment.REDEVPLUGIN_STATIC_PIE_CC;
    runStaticPIELinker(
      [
        '-m64',
        '-Wl,--as-needed,-z,relro',
        '-nostartfiles',
        '-static',
        '-no-pie',
        '-nodefaultlibs',
        '/fake/self-contained/crt1.o',
        '/fake/self-contained/crtbegin.o',
        'input.o',
        '/fake/self-contained/crtend.o',
      ],
      environment,
    );

    assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
      '-flavor',
      'gnu',
      '-static',
      '-pie',
      '--no-dynamic-linker',
      '-z',
      'text',
      '--as-needed',
      '-z',
      'relro',
      '/fake/self-contained/rcrt1.o',
      '/fake/self-contained/crtbeginS.o',
      'input.o',
      '/fake/self-contained/crtendS.o',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('runtime executable verification accepts exact Darwin Mach-O targets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-darwin-runtime-contract-'));
  try {
    const runtime = path.join(root, 'redevplugin-runtime');
    const macho = Buffer.alloc(32);
    macho.writeUInt32LE(0xfeedfacf, 0);
    macho.writeUInt32LE(0x0100000c, 4);
    macho.writeUInt32LE(2, 12);
    writeFileSync(runtime, macho);
    verifyMachO(runtime, 'darwin/arm64');
    verifyRuntimeExecutable(runtime, 'darwin/arm64');
    assert.throws(() => verifyMachO(runtime, 'darwin/amd64'), /CPU/u);
    assert.throws(() => verifyRuntimeExecutable(runtime, 'linux/arm64'), /ELF/u);
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
