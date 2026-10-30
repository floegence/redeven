import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFlowerProviderIconAssets, collectFlowerSourceIconAssets } from './flower_icon_integrity.mjs';
import { sha256 } from './terminal_agent_icon_integrity.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
test('verifies unchanged provider and website assets against the pinned upstream hashes', () => {
  assert.equal(collectFlowerProviderIconAssets(root).rows.length, 11);
  assert.equal(collectFlowerSourceIconAssets(root).rows.length, 27);
});

for (const [name, mutate, failure] of [
  ['redrawn SVG', (dir, manifest) => {
    const file = path.join(dir, 'internal/flower_ui/src/assets/provider-icons/openai.svg');
    fs.appendFileSync(file, '<!-- modified -->');
    manifest.assets[0].sha256 = sha256(fs.readFileSync(file));
  }, /differs from pinned upstream/],
  ['source revision', (_dir, manifest) => { manifest.source.revision = '0'.repeat(40); }, /pinned theSVG/],
  ['unsupported license', (_dir, manifest) => { manifest.assets[0].license = 'unknown'; }, /invalid Flower icon provenance/],
  ['missing mark', (_dir, manifest) => { manifest.assets.pop(); }, /pinned theSVG/],
  ['extra mark', dir => { fs.writeFileSync(path.join(dir, 'internal/flower_ui/src/assets/provider-icons/extra.svg'), '<svg/>'); }, /match their manifest exactly/],
]) test('rejects ' + name, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-provider-icons-'));
  try {
    for (const file of ['assets/flower_provider_icons.json', 'assets/licenses/CC0-1.0.txt', 'assets/licenses/thesvg-MIT.txt', 'internal/flower_ui/src/assets/provider-icons']) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.cpSync(path.join(root, file), path.join(dir, file), { recursive: true });
    }
    const manifestPath = path.join(dir, 'assets/flower_provider_icons.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    mutate(dir, manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => collectFlowerProviderIconAssets(dir), failure);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
