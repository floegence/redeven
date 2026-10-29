import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const patched = version => {
  const [major, minor, patch] = version.split('.').map(Number);
  return major > 1 || (major === 1 && (minor > 6 || (minor === 6 && patch >= 11)));
};
for (const folder of ['desktop', 'internal/envapp/ui_src']) test(folder + ': both lock formats retain patched serialization', () => {
  const manifest = JSON.parse(read(folder + '/package.json'));
  assert.equal(manifest.overrides.seroval, '^1.6.11');
  assert.equal(manifest.pnpm.overrides.seroval, manifest.overrides.seroval);
  const npm = JSON.parse(read(folder + '/package-lock.json'));
  const versions = Object.entries(npm.packages).filter(([key]) => key.endsWith('node_modules/seroval')).map(([, value]) => value.version);
  const pnpm = [...read(folder + '/pnpm-lock.yaml').matchAll(/^  seroval@(\d+\.\d+\.\d+):/gmu)].map(match => match[1]);
  assert.ok(versions.length > 0 && pnpm.length > 0);
  for (const version of [...versions, ...pnpm]) assert.ok(patched(version), 'vulnerable Seroval ' + version);
});

test('Go JOSE dependency retains the RSA JWK and panic fixes', () => {
  const match = read('go.mod').match(/^\s*github\.com\/go-jose\/go-jose\/v4 v4\.(\d+)\.(\d+)/mu);
  assert.ok(match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 6)));
});

test('Desktop test configs remain explicit ESM and warning overrides stay absent', () => {
  for (const config of ['desktop/vitest.config.mts', 'desktop/vitest.client.config.mts']) assert.match(read(config), /import .*vitest\/config/u);
  assert.doesNotMatch(read('desktop/package.json'), /VITE_CONFIG_NATIVE_IGNORE_WARNING/u);
});
