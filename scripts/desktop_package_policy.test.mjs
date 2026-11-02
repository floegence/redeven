import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('Desktop ships bundled frontend code without reinstalling its build dependency tree', () => {
  const pkg = JSON.parse(read('desktop/package.json'));
  for (const name of ['@floegence/floe-webapp-core', 'lucide-solid', 'qrcode-generator', 'thinking-orbs']) {
    assert.ok(pkg.devDependencies[name], `${name} is a renderer/build dependency`);
    assert.equal(pkg.dependencies[name], undefined, `${name} must not pull its complete tree into the installer`);
  }
  assert.match(pkg.scripts.build, /build-main/);
  const config = read('desktop/electron-builder.config.mjs');
  assert.ok(!config.includes("'dist/**/*'"));
  assert.ok(config.includes("'dist/main/main.js'"));
});

test('offline runtime resources remain bundled while the optional browser stays separate', () => {
  const config = read('desktop/electron-builder.config.mjs');
  assert.match(config, /from: bundledRuntimeArtifact/);
  assert.ok(config.includes('fs.cpSync(computerResources'));
  const staging = read('scripts/stage_computer_resources.mjs');
  assert.ok(staging.includes('bin/node'));
  assert.match(staging, /playwright-core/);
  assert.match(staging, /quickjs-emscripten/);
  assert.doesNotMatch(staging, /playwright install|chromium.executablePath/);
});
