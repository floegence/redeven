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
