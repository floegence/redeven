import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEnvironmentPlatformIconAssets } from './environment_platform_icon_integrity.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

test('validates the pinned local OS and default device assets and both license notices', () => {
  const result = collectEnvironmentPlatformIconAssets(root);
  assert.deepEqual(result.rows.map(row => row.license), ['CC0-1.0', 'CC0-1.0', 'MIT', 'MIT']);
  assert.equal(result.licenseNotices.length, 2);
});
for (const [name, mutate, failure] of [
  ['asset bytes', dir => fs.appendFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/apple.svg'), '\n'), /hash mismatch/],
  ['default device bytes', dir => fs.appendFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/default-device.svg'), '\n'), /hash mismatch/],
  ['license text', dir => fs.appendFileSync(path.join(dir, 'assets/licenses/CC0-1.0.txt'), 'changed'), /license hash mismatch/],
  ['source revision', (_dir, manifest) => { manifest.source.revision = '0'.repeat(40); }, /pinned theSVG/],
  ['license assignment', (_dir, manifest) => { manifest.assets[0].license = 'MIT'; }, /reviewed asset and license/],
  ['extra asset', dir => fs.writeFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/extra.svg'), '<svg/>'), /exactly match/],
]) test(`rejects changed ${name}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-platform-icons-'));
  try {
    for (const file of ['assets/environment_platform_icons.json', 'assets/licenses/CC0-1.0.txt', 'assets/licenses/thesvg-MIT.txt',
      ...['apple.svg', 'linux.svg', 'windows.svg', 'default-device.svg'].map(file => `desktop/src/welcome/assets/environment-platform-icons/${file}`)]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(dir, file));
    }
    const manifestPath = path.join(dir, 'assets/environment_platform_icons.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    mutate(dir, manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => collectEnvironmentPlatformIconAssets(dir), failure);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
