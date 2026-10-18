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
const entry = 'virtual:computer-result';
const source = [path.join(ui, 'src/index.css'), path.join(root, 'internal/flower_ui/testing/computer-result/main.tsx')]
  .map(file => 'import ' + JSON.stringify(file) + ';').join('\n');
await build({
  ...loaded.config, root: ui, base: '/', configFile: false, logLevel: 'error',
  plugins: [...loaded.config.plugins, {
    name: 'computer-result-qualification',
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
  const response = await fetch(url + '/fixture?op=' + op + (id ? '&id=' + id : ''));
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  for (const [index, mode] of ['continue', 'stop', 'offline'].entries()) {
    const thread = await api('start');
    await page.goto(url + '/?thread=' + thread.thread_id);
    const prompt = page.locator('[data-flower-input-request-prompt]');
    await prompt.waitFor({ timeout: 15000 });
    assert.match(await prompt.innerText(), /action may already be complete/);
    const before = await api('counts');
    assert.equal(before.effects, index + 1);
    await api('restart');
    await page.reload();
    await prompt.waitFor();
    assert.deepEqual(await api('counts'), before);
    if (mode === 'offline') await api('offline');
    if (mode === 'stop') {
      await page.getByRole('button', { name: /^Stop/ }).first().click();
    } else {
      await prompt.getByText('Checked, continue', { exact: true }).click();
      if (mode === 'continue') {
        await api('fail-response');
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByText('Injected pre-admission submission failure', { exact: false }).first().waitFor();
        assert.equal(await prompt.count(), 1);
        assert.deepEqual(await api('counts'), before);
      }
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await prompt.waitFor({ state: 'hidden', timeout: 15000 });
    await page.waitForTimeout(500);
    const after = await api('counts');
    assert.equal(after.effects, before.effects);
    if (mode === 'stop') assert.equal(after.requests, before.requests);
    else assert.ok(after.requests > before.requests);
    if (mode === 'continue') assert.equal(after.observations, before.observations + 1);
    await page.reload();
    await page.waitForTimeout(500);
    assert.equal(await prompt.count(), 0);
    console.log(JSON.stringify({ mode, before, after, refreshRecovered: true, submissionRetry: mode === 'continue' }));
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}
