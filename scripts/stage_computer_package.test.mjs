import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyComputerPackage } from './stage_computer_package.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-package-target-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'published');
  const write = (name, bytes) => { const file = path.join(source, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); };
  write('package.json', JSON.stringify({ name: '@floegence/floebrowser', version: '1.2.3' }));
  const artifacts = [];
  for (const platform of ['darwin', 'linux', 'win32']) for (const arch of ['arm64', 'x64']) {
    const name = `${platform}-${arch}/floebrowser-media${platform === 'win32' ? '.exe' : ''}`;
    const bytes = Buffer.from(name);
    write('dist/bin/' + name, bytes);
    artifacts.push({ platform, arch, path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = JSON.stringify({ version: '1.2.3', mediaWireVersion: 1, artifacts });
  write('dist/bin/manifest.json', manifest);
  write('dist/host.js', 'export const ready = true;');
  write('dist/host.js.map', '{}');
  write('dist/THIRD_PARTY_LICENSES.txt', 'Published licenses');
  write('dist/worker.wasm', 'wasm fixture');
  return { root, source, write, manifest };
}

for (const platform of ['darwin', 'linux']) for (const arch of ['arm64', 'x64']) {
  test(`stages only ${platform}/${arch} media with unchanged upstream evidence and offline resources`, t => {
    const f = fixture(t); const destination = path.join(f.root, 'staged');
    copyComputerPackage(f.source, destination, { mediaTarget: { platform, arch } });
    assert.equal(readFileSync(path.join(destination, 'dist/bin/manifest.json'), 'utf8'), f.manifest);
    assert.equal(readFileSync(path.join(destination, 'dist/bin/manifest.upstream.json'), 'utf8'), f.manifest);
    for (const p of ['darwin', 'linux', 'win32']) for (const a of ['arm64', 'x64']) assert.equal(existsSync(path.join(destination, `dist/bin/${p}-${a}`)), p === platform && a === arch);
    for (const file of ['package.json', 'dist/host.js', 'dist/worker.wasm', 'dist/THIRD_PARTY_LICENSES.txt']) assert.deepEqual(readFileSync(path.join(destination, file)), readFileSync(path.join(f.source, file)));
    assert.equal(existsSync(path.join(destination, 'dist/host.js.map')), false);
  });
}

test('rejects corrupt, missing and mismatched target artifacts before staging', t => {
  const f = fixture(t); const destination = path.join(f.root, 'staged');
  f.write('dist/bin/darwin-arm64/floebrowser-media', 'corrupt');
  assert.throws(() => copyComputerPackage(f.source, destination, { mediaTarget: { platform: 'darwin', arch: 'arm64' } }), /integrity/);
  assert.equal(existsSync(destination), false);
  assert.throws(() => copyComputerPackage(f.source, destination, { mediaTarget: { platform: 'linux', arch: 'ia32' } }), /Unsupported/);
  f.write('dist/bin/manifest.json', JSON.stringify({ version: 'wrong', artifacts: [] }));
  assert.throws(() => copyComputerPackage(f.source, destination, { mediaTarget: { platform: 'linux', arch: 'arm64' } }), /manifest/);
});
