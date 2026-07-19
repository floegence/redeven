import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const installerSource = readFileSync(path.join(repositoryRoot, 'scripts/install.sh'), 'utf8');
const installerLibrary = installerSource.replace(/\n# Run main function\nmain\s*$/u, '\n');

function runInstallerLibrary(root, body, env = {}) {
  const script = path.join(root, 'scenario.sh');
  writeFileSync(script, `${installerLibrary}\n${body}\n`);
  const result = spawnSync('sh', [script], {
    cwd: repositoryRoot,
    env: { ...process.env, HOME: root, ...env },
    encoding: 'utf8',
  });
  return result;
}

function writeRuntimeSuite(directory, label, omit = '') {
  mkdirSync(directory);
  const files = new Map([
    ['redeven', `#!/bin/sh\n[ "$1" = version ]\n# ${label}\n`],
    ['redevplugin-runtime', `#!/bin/sh\nexit 0\n# ${label}\n`],
    ['REDEVPLUGIN_THIRD_PARTY_NOTICES.md', `plugin notices ${label}\n`],
    ['.redevplugin-release-artifacts-verified.json', `{"label":"${label}"}\n`],
    ['LICENSE', `license ${label}\n`],
    ['THIRD_PARTY_NOTICES.md', `redeven notices ${label}\n`],
  ]);
  for (const [name, content] of files) {
    if (name !== omit) writeFileSync(path.join(directory, name), content);
  }
  for (const name of ['redeven', 'redevplugin-runtime']) {
    if (name !== omit) chmodSync(path.join(directory, name), 0o755);
  }
}

test('accepts only canonical release tags', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const accepted = runInstallerLibrary(root, 'validate_release_version v1.2.3\nvalidate_release_version v1.2.3-rc.1+build.7');
    assert.equal(accepted.status, 0, accepted.stderr);
    for (const invalid of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-', 'v1.2.3..1']) {
      const result = runInstallerLibrary(root, `if validate_release_version '${invalid}'; then exit 91; fi`);
      assert.equal(result.status, 0, `${invalid}: ${result.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds cosign verification to the exact selected tag identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const argsFile = path.join(root, 'cosign.args');
    const cosign = path.join(bin, 'cosign');
    writeFileSync(cosign, '#!/bin/sh\nprintf "%s\\n" "$@" > "$COSIGN_ARGS_FILE"\n');
    chmodSync(cosign, 0o755);
    for (const name of ['SHA256SUMS', 'SHA256SUMS.sig', 'SHA256SUMS.pem']) writeFileSync(path.join(root, name), name);
    const result = runInstallerLibrary(root, [
      'LATEST_VERSION=v1.2.3',
      `verify_signature '${path.join(root, 'SHA256SUMS')}' '${path.join(root, 'SHA256SUMS.sig')}' '${path.join(root, 'SHA256SUMS.pem')}'`,
    ].join('\n'), {
      PATH: `${bin}:${process.env.PATH}`,
      COSIGN_ARGS_FILE: argsFile,
    });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(argsFile, 'utf8');
    assert.match(args, /--certificate-identity\nhttps:\/\/github\.com\/floegence\/redeven\/\.github\/workflows\/release\.yml@refs\/tags\/v1\.2\.3\n/u);
    assert.doesNotMatch(args, /certificate-identity-regexp/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomically activates and verifies the complete versioned ReDevPlugin runtime suite', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const extracted = path.join(root, 'extracted');
    const install = path.join(root, 'install');
    mkdirSync(install);
    writeRuntimeSuite(extracted, 'first');

    const result = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${path.join(repositoryRoot, 'scripts', 'safe_extract_tar.py')}'`,
      `ARCHIVE_SHA256='${'a'.repeat(64)}'`,
      `publish_runtime_suite '${extracted}'`,
      'activate_runtime_suite',
      'verify_installed_runtime_suite',
    ].join('\n'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(path.join(install, 'redeven')).isSymbolicLink(), true);
    assert.equal(readlinkSync(path.join(install, 'redeven')), `.redeven-runtime-suites/${'a'.repeat(64)}/redeven`);
    const suite = path.join(install, '.redeven-runtime-suites', 'a'.repeat(64));
    for (const name of [
      'redeven',
      'redevplugin-runtime',
      'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
      '.redevplugin-release-artifacts-verified.json',
      'REDEVEN_LICENSE',
      'REDEVEN_THIRD_PARTY_NOTICES.md',
    ]) {
      assert.equal(readFileSync(path.join(suite, name)).length > 0, true, name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the prior runtime suite active when a replacement is incomplete', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const first = path.join(root, 'first');
    const incomplete = path.join(root, 'incomplete');
    const install = path.join(root, 'install');
    mkdirSync(install);
    writeRuntimeSuite(first, 'first');
    writeRuntimeSuite(incomplete, 'second', 'redevplugin-runtime');
    const extractor = path.join(repositoryRoot, 'scripts', 'safe_extract_tar.py');
    const firstHash = 'a'.repeat(64);
    const secondHash = 'b'.repeat(64);

    const installed = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${extractor}'`,
      `ARCHIVE_SHA256='${firstHash}'`,
      `publish_runtime_suite '${first}'`,
      'activate_runtime_suite',
      'verify_installed_runtime_suite',
    ].join('\n'));
    assert.equal(installed.status, 0, installed.stderr);

    const rejected = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${extractor}'`,
      `ARCHIVE_SHA256='${secondHash}'`,
      `publish_runtime_suite '${incomplete}'`,
    ].join('\n'));
    assert.notEqual(rejected.status, 0);
    assert.equal(readlinkSync(path.join(install, 'redeven')), `.redeven-runtime-suites/${firstHash}/redeven`);
    assert.match(readFileSync(path.join(install, 'redeven'), 'utf8'), /first/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not change activation when a later preparation step fails', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    const install = path.join(root, 'install');
    mkdirSync(install);
    writeRuntimeSuite(first, 'first');
    writeRuntimeSuite(second, 'second');
    const extractor = path.join(repositoryRoot, 'scripts', 'safe_extract_tar.py');
    const firstHash = 'a'.repeat(64);
    const secondHash = 'b'.repeat(64);

    const installed = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${extractor}'`,
      `ARCHIVE_SHA256='${firstHash}'`,
      `publish_runtime_suite '${first}'`,
      'activate_runtime_suite',
    ].join('\n'));
    assert.equal(installed.status, 0, installed.stderr);

    const failed = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${extractor}'`,
      `ARCHIVE_SHA256='${secondHash}'`,
      `publish_runtime_suite '${second}'`,
      'exit 73',
    ].join('\n'));
    assert.equal(failed.status, 73, failed.stderr);
    assert.equal(readlinkSync(path.join(install, 'redeven')), `.redeven-runtime-suites/${firstHash}/redeven`);
    assert.match(readFileSync(path.join(install, 'redeven'), 'utf8'), /first/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an unknown activation symlink without replacing it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const extracted = path.join(root, 'extracted');
    const install = path.join(root, 'install');
    mkdirSync(install);
    writeRuntimeSuite(extracted, 'new');
    symlinkSync('/opt/unmanaged/redeven', path.join(install, 'redeven'));

    const result = runInstallerLibrary(root, [
      `INSTALL_DIR='${install}'`,
      `REDEVEN_INSTALL_DIR='${install}'`,
      `SAFE_EXTRACTOR_PATH='${path.join(repositoryRoot, 'scripts', 'safe_extract_tar.py')}'`,
      `ARCHIVE_SHA256='${'a'.repeat(64)}'`,
      `publish_runtime_suite '${extracted}'`,
    ].join('\n'));
    assert.notEqual(result.status, 0);
    assert.equal(readlinkSync(path.join(install, 'redeven')), '/opt/unmanaged/redeven');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retains only the active and newly activated runtime suites', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-installer-contract-'));
  try {
    const install = path.join(root, 'install');
    mkdirSync(install);
    const extractor = path.join(repositoryRoot, 'scripts', 'safe_extract_tar.py');
    const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

    for (const [index, hash] of hashes.entries()) {
      const extracted = path.join(root, `suite-${index}`);
      writeRuntimeSuite(extracted, `suite-${index}`);
      const result = runInstallerLibrary(root, [
        `INSTALL_DIR='${install}'`,
        `REDEVEN_INSTALL_DIR='${install}'`,
        `SAFE_EXTRACTOR_PATH='${extractor}'`,
        `ARCHIVE_SHA256='${hash}'`,
        `publish_runtime_suite '${extracted}'`,
        'activate_runtime_suite',
      ].join('\n'));
      assert.equal(result.status, 0, result.stderr);
    }

    assert.deepEqual(
      readdirSync(path.join(install, '.redeven-runtime-suites')).sort(),
      hashes.slice(1).sort(),
    );
    assert.equal(readlinkSync(path.join(install, 'redeven')), `.redeven-runtime-suites/${hashes[2]}/redeven`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
