import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { refreshSignedRuntimeManifests } from '../desktop/scripts/sign-packaged-runtime.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-signed-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, bytes) => fs.writeFileSync(path.join(root, name), bytes);
  function file(name, executable = false) {
    const bytes = Buffer.from(`original ${name}`);
    write(name, bytes);
    fs.chmodSync(path.join(root, name), executable ? 0o755 : 0o644);
    return { path: name, sha256: digest(bytes), size_bytes: bytes.length, executable };
  }
  fs.mkdirSync(path.join(root, 'computer'));
  const runtime = [file('redeven', true), file('redevplugin-runtime', true), file('redevplugin-runtime.sig')];
  const files = [file('computer/node', true), file('computer/host.mjs')]
    .map(value => ({ ...value, path: value.path.slice('computer/'.length) }));
  write('computer/manifest.json', JSON.stringify({ schema_version: 1, files }));
  write('desktop-bundle-manifest.json', JSON.stringify({ schema_version: 5, runtime_files: runtime }));
  return { root, write, signed: new Set([path.join(root, 'redeven'), path.join(root, 'computer/node')]) };
}

test('signing binds changed native bytes before the enclosing app seal', t => {
  const { root, write, signed } = fixture(t);
  const evidenceBefore = fs.readFileSync(path.join(root, 'redevplugin-runtime.sig'));
  write('redeven', 'signed Runtime');
  write('computer/node', 'signed Node');
  refreshSignedRuntimeManifests(root, signed);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop-bundle-manifest.json')));
  const computerBytes = fs.readFileSync(path.join(root, 'computer/manifest.json'));
  assert.equal(manifest.computer_manifest_sha256, digest(computerBytes));
  for (const [directory, files] of [[root, manifest.runtime_files], [path.join(root, 'computer'), JSON.parse(computerBytes).files]]) {
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(directory, file.path));
      assert.equal(file.sha256, digest(bytes));
      assert.equal(file.size_bytes, bytes.length);
    }
  }
  const identity = { schema_version: 1, files: manifest.runtime_files.map(file => ({
    name: file.path, sha256: `sha256:${file.sha256}`, size_bytes: file.size_bytes, executable: file.executable,
  })).sort((a, b) => a.name.localeCompare(b.name)) };
  assert.equal(manifest.runtime_files_sha256, `sha256:${digest(JSON.stringify(identity))}`);
  assert.deepEqual(fs.readFileSync(path.join(root, 'redevplugin-runtime.sig')), evidenceBefore);
});

for (const name of ['redevplugin-runtime', 'redevplugin-runtime.sig', 'computer/host.mjs']) {
  test(`signing rejects changed protected or unsigned bytes: ${name}`, t => {
    const { root, write, signed } = fixture(t);
    if (name.startsWith('redevplugin')) signed.add(path.join(root, name));
    const manifestBefore = fs.readFileSync(path.join(root, 'desktop-bundle-manifest.json'));
    const computerBefore = fs.readFileSync(path.join(root, 'computer/manifest.json'));
    write(name, 'unexpected modification');
    assert.throws(() => refreshSignedRuntimeManifests(root, signed), /unapproved bundled file/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'desktop-bundle-manifest.json')), manifestBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, 'computer/manifest.json')), computerBefore);
  });
}

test('signing rejects a native resource replaced with a symlink', t => {
  const { root, signed } = fixture(t);
  fs.unlinkSync(path.join(root, 'computer/node'));
  fs.symlinkSync('../redeven', path.join(root, 'computer/node'));
  assert.throws(() => refreshSignedRuntimeManifests(root, signed), /file structure/);
});

import { execFileSync } from 'node:child_process';
import { captureMediaSigningState, deriveSignedMediaManifest, mediaManifestPath, mediaUpstreamPath, normalizeUnsignedMachO } from '../desktop/scripts/signed-media.mjs';

function mediaFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-media-sign-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'node_modules/@floegence/floebrowser');
  const relative = process.platform + '-' + process.arch + '/floebrowser-media';
  const file = path.join(packageRoot, 'dist/bin', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const compile = value => execFileSync('/usr/bin/cc', ['-x', 'c', '-', '-o', file], { input: 'int main(void) { return ' + value + '; }', stdio: ['pipe', 'pipe', 'pipe'] });
  compile(0);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'published.media', file], { stdio: 'pipe' });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const bytes = fs.readFileSync(file);
  const manifest = Buffer.from(JSON.stringify({ version: '1.2.3', mediaWireVersion: 1, artifacts: [{ platform: process.platform, arch: process.arch, path: relative, bytes: bytes.length, sha256: digest(bytes) }] }));
  for (const name of [mediaManifestPath, mediaUpstreamPath]) fs.writeFileSync(path.join(root, name), manifest);
  return { root, file, compile, manifest, sign: () => execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'packaged.media', file], { stdio: 'pipe' }) };
}

test('media signing preserves upstream evidence and derives a checked runtime manifest', { skip: process.platform !== 'darwin' }, t => {
  const f = mediaFixture(t);
  const state = captureMediaSigningState(f.root);
  f.sign();
  const bytes = fs.readFileSync(f.file);
  assert.notEqual(digest(bytes), JSON.parse(f.manifest).artifacts[0].sha256);
  const derived = JSON.parse(deriveSignedMediaManifest(state, new Set([f.file])));
  assert.equal(derived.artifacts[0].sha256, digest(bytes));
  assert.equal(derived.artifacts[0].bytes, bytes.length);
  assert.deepEqual(fs.readFileSync(path.join(f.root, mediaUpstreamPath)), f.manifest);
  assert.throws(() => deriveSignedMediaManifest(state, new Set()), /not visited/);
  fs.writeFileSync(path.join(f.root, mediaManifestPath), '{}');
  assert.throws(() => deriveSignedMediaManifest(state, new Set([f.file])), /manifest changed/);
});

test('media signing rejects changed executable content even with a valid new signature', { skip: process.platform !== 'darwin' }, t => {
  const f = mediaFixture(t);
  const state = captureMediaSigningState(f.root);
  f.compile(1); f.sign();
  assert.throws(() => deriveSignedMediaManifest(state, new Set([f.file])), /executable content/);
});

test('media signing rejects corrupt published bytes before invoking the signer', { skip: process.platform !== 'darwin' }, t => {
  const f = mediaFixture(t);
  fs.appendFileSync(f.file, 'corrupt');
  assert.throws(() => captureMediaSigningState(f.root), /upstream integrity/);
});

test('unsigned Mach-O comparison rejects malformed executable input', () => {
  assert.throws(() => normalizeUnsignedMachO(Buffer.alloc(32)), /Mach-O/);
  const bytes = Buffer.alloc(40); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(1, 16); bytes.writeUInt32LE(8, 20); bytes.writeUInt32LE(0x1d, 32); bytes.writeUInt32LE(8, 36);
  assert.throws(() => normalizeUnsignedMachO(bytes), /signature was not removed/);
});

test('signed media and both enclosing inventories bind the same final bytes', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t), media = mediaFixture(t);
  fs.cpSync(path.join(media.root, 'node_modules'), path.join(f.root, 'computer/node_modules'), { recursive: true });
  const computerPath = path.join(f.root, 'computer/manifest.json');
  const computer = JSON.parse(fs.readFileSync(computerPath));
  for (const name of [mediaManifestPath, mediaUpstreamPath, 'node_modules/@floegence/floebrowser/package.json', 'node_modules/@floegence/floebrowser/dist/bin/' + process.platform + '-' + process.arch + '/floebrowser-media']) {
    const file = path.join(f.root, 'computer', name), bytes = fs.readFileSync(file);
    computer.files.push({ path: name, sha256: digest(bytes), size_bytes: bytes.length, executable: Boolean(fs.statSync(file).mode & 0o111) });
  }
  fs.writeFileSync(computerPath, JSON.stringify(computer));
  const state = captureMediaSigningState(path.join(f.root, 'computer'));
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'packaged.media', state.file], { stdio: 'pipe' });
  f.signed.add(state.file);
  refreshSignedRuntimeManifests(f.root, f.signed, state);
  const finalBytes = fs.readFileSync(computerPath), finalManifest = JSON.parse(finalBytes);
  for (const entry of finalManifest.files) {
    const bytes = fs.readFileSync(path.join(f.root, 'computer', entry.path));
    assert.equal(entry.sha256, digest(bytes)); assert.equal(entry.size_bytes, bytes.length);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'desktop-bundle-manifest.json'))).computer_manifest_sha256, digest(finalBytes));
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(f.root, 'computer', mediaManifestPath)));
  assert.equal(runtimeManifest.artifacts[0].sha256, digest(fs.readFileSync(state.file)));
});
