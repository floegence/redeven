import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const targets = [
  ['linux', 'amd64'],
  ['linux', 'arm64'],
  ['darwin', 'amd64'],
  ['darwin', 'arm64'],
];

function writeOctal(header, value, offset, length) {
  header.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function archive(executableName, executable) {
  const header = Buffer.alloc(512, 0);
  header.write(executableName, 0, 100, 'utf8');
  writeOctal(header, 0o755, 100, 8);
  writeOctal(header, executable.length, 124, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);
  const padding = Buffer.alloc((512 - (executable.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, executable, padding, Buffer.alloc(1024)]));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('generates signed-manifest inputs with executable digests and the reviewed upgrade epoch', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'redeven-runtime-compatibility-'));
  try {
    const expected = new Map();
    for (const [platform, architecture] of targets) {
      const runtime = Buffer.from(`runtime ${platform}/${architecture}\n`);
      const gateway = Buffer.from(`gateway ${platform}/${architecture}\n`);
      expected.set(`${platform}/${architecture}`, { runtime: sha256(runtime), gateway: sha256(gateway) });
      writeFileSync(path.join(dist, `redeven_${platform}_${architecture}.tar.gz`), archive('redeven', runtime));
      writeFileSync(path.join(dist, `redeven-gateway_${platform}_${architecture}.tar.gz`), archive('redeven-gateway', gateway));
    }

    const result = spawnSync(process.execPath, [
      new URL('./generate_runtime_compatibility_manifests.mjs', import.meta.url).pathname,
      '--dist', dist,
      '--tag', 'v0.11.0',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    for (const [platform, architecture] of targets) {
      const manifest = JSON.parse(readFileSync(
        path.join(dist, `redeven-runtime-compatibility_${platform}_${architecture}.json`),
        'utf8',
      ));
      const digests = expected.get(`${platform}/${architecture}`);
      assert.equal(manifest.gateway.sha256, digests.gateway);
      assert.equal(manifest.runtime.sha256, digests.runtime);
      assert.equal(manifest.runtime.compatibility_epoch, 9);
      assert.deepEqual(manifest.compatibility.upgrade_from_runtime_epochs, [8]);
      assert.deepEqual(manifest.compatibility.required_upgrade_order, ['gateway', 'runtime']);
    }
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
