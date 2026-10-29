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
  for (const [index, mode] of ['autonomous', 'user', 'stop', 'offline'].entries()) {
    const initial = await api('counts');
    const thread = await api('start&mode=' + mode);
    await page.goto(url + '/?thread=' + thread.thread_id);
    const prompt = page.locator('[data-flower-input-request-prompt]');
    if (mode === 'user' || mode === 'stop') {
      await prompt.waitFor({ timeout: 15000 });
      assert.match(await prompt.innerText(), /Which destination should I use/);
      assert.doesNotMatch(await prompt.innerText(), /Checked, continue/);
      const before = await api('counts');
      assert.equal(before.effects, index + 1);
      assert.equal(before.observations, initial.observations + 1);
      await api('restart');
      await page.reload();
      await prompt.waitFor();
      assert.deepEqual(await api('counts'), before);
      if (mode === 'stop') {
        await page.getByRole('button', { name: /^Stop/ }).first().click();
      } else {
        await prompt.getByText('Fixture destination', { exact: true }).click();
        await api('fail-response');
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByText('Injected pre-admission submission failure', { exact: false }).first().waitFor();
        assert.equal(await prompt.count(), 1);
        assert.deepEqual(await api('counts'), before);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await prompt.waitFor({ state: 'hidden', timeout: 15000 });
    }
    if (mode !== 'stop') {
      const completion = mode === 'offline'
        ? 'Observation unavailable; completed action was not replayed.'
        : 'Current state checked; completed action was not replayed.';
      await page.getByText(completion, { exact: false }).first().waitFor({ timeout: 15000 });
    }
    assert.equal(await prompt.count(), 0);
    const after = await api('counts');
    assert.equal(after.effects, initial.effects + 1);
    assert.equal(after.observations, initial.observations + (mode === 'offline' ? 0 : 1));
    await api('restart');
    await page.reload();
    await page.waitForTimeout(500);
    assert.equal(await prompt.count(), 0);
    assert.deepEqual(await api('counts'), after);
    console.log(JSON.stringify({ mode, initial, after, refreshRecovered: true, submissionRetry: mode === 'user' }));
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}
