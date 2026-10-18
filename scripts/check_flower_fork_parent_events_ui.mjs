import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Explicit, opt-in browser qualification. The Go test owns the runtime/state.
const root = process.cwd();
const url = process.argv.find(value => value.startsWith('--url='))?.slice(6);
const dist = process.argv.find(value => value.startsWith('--dist='))?.slice(7);
assert.ok(url && dist, 'The owning Go test must supply --url and --dist');
const ui = path.join(root, 'internal/envapp/ui_src');
const require = createRequire(path.join(ui, 'package.json'));
const { build, loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')));
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(ui, 'vite.config.ts'));
const entry = 'virtual:fork-parent-events';
const source = [path.join(ui, 'src/index.css'), path.join(root, 'internal/flower_ui/testing/fork-parent-events/main.tsx')]
  .map(file => 'import ' + JSON.stringify(file) + ';').join('\n');
await build({
  ...loaded.config, root: ui, base: '/', configFile: false, logLevel: 'error',
  plugins: [...loaded.config.plugins, {
    name: 'fork-parent-events-qualification',
    resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? source : undefined,
  }],
  build: {
    ...loaded.config.build, outDir: dist, emptyOutDir: true, manifest: false, cssCodeSplit: false,
    rolldownOptions: undefined, rollupOptions: { input: entry, output: { entryFileNames: 'qualification.js' } },
  },
});
const assets = await readdir(path.join(dist, 'assets'));
await writeFile(path.join(dist, 'index.html'), '<!doctype html><html class="light"><head><meta charset="utf-8">'
  + assets.filter(file => file.endsWith('.css')).map(file => '<link rel="stylesheet" href="/assets/' + file + '">').join('')
  + '</head><body><div id="root"></div><script type="module" src="/qualification.js"></script></body></html>');
const api = async (op, id) => {
  const response = await fetch(url + '/fixture?op=' + op + (id ? '&id=' + encodeURIComponent(id) : ''));
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
const setup = await api('setup');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(url + '/?thread=' + setup.source);
  const sourceCard = page.locator('[data-thread-id="' + setup.source + '"]');
  await sourceCard.locator('.flower-thread-card-menu-button').waitFor();
  const sourceBody = page.locator('[data-parent-event-kind="report"] [data-parent-event-body]');
  await sourceBody.waitFor();
  assert.equal(await sourceBody.textContent(), setup.report);
  await api('arm');
  await sourceCard.hover();
  await sourceCard.locator('.flower-thread-card-menu-button').click();
  await page.getByRole('menuitem', { name: 'Fork', exact: true }).click();
  await page.locator('.flower-thread-load-error').waitFor();
  const forkID = await page.locator('[data-flower-thread-active="true"]').getAttribute('data-thread-id');
  assert.ok(forkID && forkID !== setup.source);
  assert.equal((await api('counts')).forks, 1);
  await page.locator('.flower-thread-load-error').getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('.flower-parent-event-reading').waitFor();
  assert.equal(await page.locator('.flower-thread-load-error').count(), 0);
  assert.equal(await page.locator('.flower-composer textarea').isEnabled(), true);
  await page.locator('.flower-parent-event-reading').getByRole('button', { name: 'Retry', exact: true }).click();
  const body = page.locator('[data-parent-event-kind="report"] [data-parent-event-body]');
  await body.waitFor();
  assert.equal(await body.textContent(), setup.report);
  const row = page.locator('[data-parent-event-kind="report"]');
  assert.equal(await row.locator('button.flower-parent-event-source, .flower-parent-event-open').count(), 0);
  const disclosure = row.locator('.flower-parent-event-disclosure');
  await disclosure.click();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.flower-error-card').count(), 0);
  const before = await api('counts');
  assert.equal(before.forks, 1);
  assert.equal(before.parent_requests, 1);
  assert.equal(before.child_requests, 2);
  await api('restart');
  await page.goto(url + '/?thread=' + forkID);
  await body.waitFor();
  assert.equal(await body.textContent(), setup.report);
  await page.locator('[data-thread-id="' + setup.source + '"] .flower-thread-card-select-button').click();
  await page.waitForFunction(id => document.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === id, setup.source);
  await page.locator('[data-thread-id="' + forkID + '"] .flower-thread-card-select-button').click();
  await page.waitForFunction(id => document.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === id, forkID);
  await body.waitFor();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  const after = await api('counts');
  assert.equal(after.forks, 1);
  assert.equal(after.parent_requests, before.parent_requests);
  assert.equal(after.child_requests, before.child_requests);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ forkID, before, after, inheritedReport: true, detailRetry: true, reportRetry: true, restart: true, navigation: true }));
} finally {
  await browser.close();
}
