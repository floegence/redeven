import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectDesktopArchive } from './package-size.mjs';

const require = createRequire(import.meta.url);
const appRequire = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
const asar = appRequire('@electron/asar');

async function fixture(t, extra, transform = () => {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-package-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'app');
  const names = ['dist/main/main.js', 'dist/preload/utility.js', 'dist/preload/session.js', 'dist/preload/web-service-browser.js', 'dist/preload/host-application-window.js', 'dist/welcome/index.html', ...(extra ? [extra] : [])];
  for (const name of names) { const file = path.join(source, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'offline'); }
  transform(source);
  const archive = path.join(root, 'app.asar');
  await asar.createPackage(source, archive);
  return archive;
}

test('reports actual archive contents and preserves offline renderer assets', async t => {
  const report = inspectDesktopArchive(await fixture(t, 'dist/welcome/assets/renderer.wasm'));
  assert.equal(report.payload_bytes, 49);
  assert.ok(report.largest_files.some(file => file.path.endsWith('.wasm')));
});
for (const file of ['dist/main/start.test.js', 'dist/build/tool.js', 'node_modules/example/index.js.map', 'node_modules/example/demo/image.gif', 'node_modules/@floegence/flowersec-core/dist/interop/serverParityPeer.js']) {
  test(`rejects unwanted packaged file ${file}`, async t => {
    const archive = await fixture(t, file);
    assert.throws(() => inspectDesktopArchive(archive), /artifact|Unexpected/);
  });
}

test('rejects a missing preload from the final archive', async t => {
  const archive = await fixture(t, undefined, source => rmSync(path.join(source, 'dist/preload/session.js')));
  assert.throws(() => inspectDesktopArchive(archive), /Missing Desktop entry/);
});

test('rejects an application payload exceeding the byte budget', async t => {
  const archive = await fixture(t, undefined, source => writeFileSync(path.join(source, 'dist/main/main.js'), Buffer.alloc(80 * 1024 * 1024)));
  assert.throws(() => inspectDesktopArchive(archive), /exceeds 80 MiB/);
});
