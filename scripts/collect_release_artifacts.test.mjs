import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collect } from './collect_release_artifacts.mjs';

const targets = [
  { goos: 'linux', goarch: 'amd64', desktopOS: 'linux', desktopArch: 'x64', extensions: ['deb', 'rpm'] },
  { goos: 'linux', goarch: 'arm64', desktopOS: 'linux', desktopArch: 'arm64', extensions: ['deb', 'rpm'] },
  { goos: 'darwin', goarch: 'amd64', desktopOS: 'mac', desktopArch: 'x64', extensions: ['dmg'] },
  { goos: 'darwin', goarch: 'arm64', desktopOS: 'mac', desktopArch: 'arm64', extensions: ['dmg'] },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function write(directory, name, bytes) {
  const output = path.join(directory, name);
  writeFileSync(output, bytes);
  return output;
}

function packageDescriptor(file) {
  return {
    name: path.basename(file),
    sha256: sha256(readFileSync(file)),
    size: statSync(file).size,
  };
}

function evidenceDescriptor(label) {
  const bytes = Buffer.from(`${label}\n`);
  return { sha256: sha256(bytes), size: bytes.length };
}

function createFixture(root) {
  const downloads = path.join(root, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const sharedFiles = new Map([
    ['LICENSE', Buffer.from('license\n')],
    ['THIRD_PARTY_NOTICES.md', Buffer.from('notices\n')],
    ['okf_bundle.manifest.json', Buffer.from('{}\n')],
    ['okf_bundle.sha256', Buffer.from(`${'a'.repeat(64)}\n`)],
  ]);

  for (const target of targets) {
    const packageDirectory = path.join(downloads, `package-${target.goos}-${target.goarch}`);
    const desktopDirectory = path.join(downloads, `desktop-${target.goos}-${target.goarch}`);
    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(desktopDirectory, { recursive: true });
    for (const [name, bytes] of sharedFiles) write(packageDirectory, name, bytes);
    write(packageDirectory, `redeven_${target.goos}_${target.goarch}.tar.gz`, Buffer.from(`runtime ${target.goos}/${target.goarch}\n`));
    write(packageDirectory, `redeven-gateway_${target.goos}_${target.goarch}.tar.gz`, Buffer.from(`gateway ${target.goos}/${target.goarch}\n`));

    for (const extension of target.extensions) {
      const installerName = `Redeven-Desktop-1.2.3-${target.desktopOS}-${target.desktopArch}.${extension}`;
      const installerPath = write(desktopDirectory, installerName, Buffer.from(`installer ${installerName}\n`));
      const hasRuntime = target.goos === 'linux';
      const targetLabel = `${target.goos}/${target.goarch}`;
      write(desktopDirectory, `${installerName}.redevplugin-verification.json`, `${JSON.stringify({
        schema_version: 'redeven.desktop_redevplugin_package_verification.v2',
        package: packageDescriptor(installerPath),
        runtime_target: targetLabel,
        redevplugin_runtime: hasRuntime ? evidenceDescriptor(`runtime ${targetLabel}`) : null,
        redevplugin_evidence: hasRuntime ? {
          marker: evidenceDescriptor(`marker ${targetLabel}`),
          notices: evidenceDescriptor(`notices ${targetLabel}`),
          sbom: evidenceDescriptor(`sbom ${targetLabel}`),
          provenance: evidenceDescriptor(`provenance ${targetLabel}`),
          signature: evidenceDescriptor(`signature ${targetLabel}`),
          certificate: evidenceDescriptor(`certificate ${targetLabel}`),
        } : null,
      }, null, 2)}\n`);
    }
  }
  return downloads;
}

test('collects only the closed four-target release inventory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-collector-'));
  try {
    const downloads = createFixture(root);
    const destination = path.join(root, 'release');
    collect(downloads, destination, 'v1.2.3');
    const outputs = readdirSync(destination).sort();
    assert.equal(outputs.filter((name) => name.startsWith('redeven_')).length, 4);
    assert.equal(outputs.filter((name) => name.startsWith('redeven-gateway_')).length, 4);
    assert.equal(outputs.filter((name) => /\.(?:deb|rpm|dmg)$/u.test(name)).length, 6);
    assert.equal(outputs.filter((name) => name.endsWith('.redevplugin-verification.json')).length, 6);
    assert.equal(outputs.length, 24);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unexpected artifact directories and tampered receipts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-collector-'));
  try {
    const downloads = createFixture(root);
    mkdirSync(path.join(downloads, 'desktop-unexpected'));
    assert.throws(
      () => collect(downloads, path.join(root, 'unexpected-output'), 'v1.2.3'),
      /downloaded artifact directory inventory mismatch/u,
    );
    rmSync(path.join(downloads, 'desktop-unexpected'), { recursive: true, force: true });

    const receipt = path.join(
      downloads,
      'desktop-linux-amd64',
      'Redeven-Desktop-1.2.3-linux-x64.deb.redevplugin-verification.json',
    );
    const value = JSON.parse(readFileSync(receipt, 'utf8'));
    value.package.sha256 = '0'.repeat(64);
    writeFileSync(receipt, `${JSON.stringify(value)}\n`);
    assert.throws(
      () => collect(downloads, path.join(root, 'tampered-output'), 'v1.2.3'),
      /installer descriptor mismatch/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a source path replacement after its no-follow descriptor is opened', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-collector-'));
  try {
    const downloads = createFixture(root);
    const destination = path.join(root, 'release');
    const installer = path.join(
      downloads,
      'desktop-linux-amd64',
      'Redeven-Desktop-1.2.3-linux-x64.deb',
    );
    let replaced = false;
    assert.throws(
      () => collect(downloads, destination, 'v1.2.3', {
        afterSourceOpen(source) {
          if (source !== installer || replaced) return;
          replaced = true;
          unlinkSync(source);
          writeFileSync(source, 'replacement installer bytes\n');
        },
      }),
      /release source changed while being staged/u,
    );
    assert.equal(replaced, true);
    assert.deepEqual(readdirSync(destination), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('never replaces an existing release output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-collector-'));
  try {
    const downloads = createFixture(root);
    const destination = path.join(root, 'release');
    mkdirSync(destination);
    writeFileSync(path.join(destination, 'LICENSE'), 'existing release license\n');
    assert.throws(
      () => collect(downloads, destination, 'v1.2.3'),
      /release collection output inventory mismatch before publication/u,
    );
    assert.deepEqual(readdirSync(destination), ['LICENSE']);
    assert.equal(readFileSync(path.join(destination, 'LICENSE'), 'utf8'), 'existing release license\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symbolic-link release sources without publishing output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-release-collector-'));
  try {
    const downloads = createFixture(root);
    const destination = path.join(root, 'release');
    const installer = path.join(
      downloads,
      'desktop-linux-amd64',
      'Redeven-Desktop-1.2.3-linux-x64.deb',
    );
    const outside = path.join(root, 'outside-installer.deb');
    writeFileSync(outside, readFileSync(installer));
    unlinkSync(installer);
    symlinkSync(outside, installer);
    assert.throws(
      () => collect(downloads, destination, 'v1.2.3'),
      /must be a regular file/u,
    );
    assert.deepEqual(readdirSync(destination), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
