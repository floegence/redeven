import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEnvironmentPlatformIconAssets } from './environment_platform_icon_integrity.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

test('validates the pinned OS, distribution and default device assets and all license notices', () => {
  const result = collectEnvironmentPlatformIconAssets(root);
  assert.equal(result.rows.length, 23);
  assert.equal(result.rows.find(row => row.label === 'Debian').license, 'CC-BY-SA-3.0');
  assert.equal(result.rows.find(row => row.label === 'Fedora').license, 'Custom');
  assert.equal(result.licenseNotices.length, 6);
});
for (const [name, mutate, failure] of [
  ['asset bytes', dir => fs.appendFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/apple.svg'), '\n'), /hash mismatch/],
  ['dark Apple bytes', dir => fs.appendFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/apple-dark.svg'), '\n'), /hash mismatch/],
  ['default device bytes', dir => fs.appendFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/default-device.svg'), '\n'), /hash mismatch/],
  ['license text', dir => fs.appendFileSync(path.join(dir, 'assets/licenses/CC0-1.0.txt'), 'changed'), /license hash mismatch/],
  ['source revision', (_dir, manifest) => { manifest.source.revision = '0'.repeat(40); }, /pinned theSVG/],
  ['license assignment', (_dir, manifest) => { manifest.assets[0].license = 'MIT'; }, /reviewed asset and license/],
  ['extra asset', dir => fs.writeFileSync(path.join(dir, 'desktop/src/welcome/assets/environment-platform-icons/extra.svg'), '<svg/>'), /exactly match/],
]) test(`rejects changed ${name}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-platform-icons-'));
  try {
    for (const file of ['assets/environment_platform_icons.json', 'assets/licenses/CC0-1.0.txt', 'assets/licenses/thesvg-MIT.txt', 'assets/licenses/CC-BY-SA-2.5.txt', 'assets/licenses/CC-BY-SA-3.0.txt', 'assets/licenses/CC-BY-SA-4.0.txt', 'assets/licenses/fedora-trademark-guidelines.txt',
      ...JSON.parse(fs.readFileSync(path.join(root, 'assets/environment_platform_icons.json'), 'utf8')).assets.map(asset => `desktop/src/welcome/assets/environment-platform-icons/${asset.file}`)]) {
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
