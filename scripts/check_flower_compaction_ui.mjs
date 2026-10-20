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
const entry = 'virtual:compaction';
const source = [path.join(ui, 'src/index.css'), path.join(root, 'internal/flower_ui/testing/compaction/main.tsx')]
  .map(file => 'import ' + JSON.stringify(file) + ';').join('\n');
await build({
  ...loaded.config, root: ui, base: '/', configFile: false, logLevel: 'error',
  plugins: [...loaded.config.plugins, {
    name: 'compaction-qualification',
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
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url + '/?thread=' + setup.source);
  await page.locator('.flower-composer textarea').waitFor();
  await api('start');
  const running = page.locator('[data-flower-compaction-status="compacting"]');
  try { await running.waitFor({ timeout: 30000 }); }
  catch (error) {
    const detail = await api('detail', setup.source);
    console.error(JSON.stringify({ activity: detail.current.activity, failure: detail.current.failure, error: detail.current.error, operations: detail.thread.context_compactions, pageErrors: errors, text: (await page.locator('main').innerText()).slice(-1500) }));
    throw error;
  }
  const decorationID = await running.getAttribute('data-flower-decoration-id');
  const active = await api('detail', setup.source);
  assert.equal(active.current.activity, 'active');
  assert.equal(active.thread.context_compactions.at(-1).phase, 'start');
  assert.equal(active.thread.context_compactions.at(-1).trigger === 'manual', false);
  await api('summary');
  const done = page.locator('[data-flower-decoration-id="' + decorationID + '"][data-flower-compaction-status="compacted"]');
  await done.waitFor({ timeout: 30000 });
  assert.equal((await api('detail', setup.source)).current.activity, 'active');
  await api('answer');
  await page.getByText('Qualification complete.', { exact: true }).waitFor();
  const turnID = active.thread.context_compactions.at(-1).turn_id;
  const summary = page.locator('[data-flower-turn-id="' + turnID + '"] .flower-turn-summary-button');
  await summary.waitFor();
  if (await summary.getAttribute('aria-expanded') === 'true') await summary.click();
  await done.waitFor({ state: 'hidden' });
  await summary.click(); await done.waitFor({ state: 'visible' });
  const stable = await api('detail', setup.source);
  assert.equal(stable.thread.context_compactions.at(-1).operation_id, active.thread.context_compactions.at(-1).operation_id);
  assert.equal(stable.thread.context_compactions.at(-1).canonical_ordinal, active.thread.context_compactions.at(-1).canonical_ordinal);
  await page.reload(); await summary.waitFor();
  if (await summary.getAttribute('aria-expanded') === 'false') await summary.click();
  await done.waitFor({ state: 'visible' });
  assert.equal(await done.count(), 1);
  if (setup.history) {
    await page.goto(url + '/?history=1&thread=' + setup.history);
    const detail = await api('detail', setup.history);
    const operations = detail.thread.context_compactions.filter(value => !setup.history_turn || value.turn_id === setup.history_turn);
    assert.ok(operations.length > 0);
    assert.deepEqual(operations.map(value => value.canonical_ordinal), operations.map(value => value.canonical_ordinal).sort((a,b) => a-b));
    const turns = new Map();
    for (const operation of operations) turns.set(operation.turn_id, [...(turns.get(operation.turn_id) ?? []), operation]);
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await page.reload();
      for (const [turnID, turnOperations] of turns) {
        const turn = page.locator('[data-flower-turn-id="' + turnID + '"]');
        await turn.first().waitFor();
        const summary = turn.locator('.flower-turn-summary-button');
        const collapsible = await summary.count() > 0;
        if (collapsible && await summary.getAttribute('aria-expanded') === 'false') await summary.click();
        const ids = [];
        for (const operation of turnOperations) {
          const row = page.locator('[data-flower-decoration-id="context-compaction:' + operation.operation_id + '"]');
          await row.waitFor({ state: 'visible' });
          assert.equal(await row.count(), 1);
          assert.equal(await row.getAttribute('data-flower-compaction-status'), operation.status);
          const prose = detail.current.items.filter(item => item.kind === 'assistant' && item.text);
          const before = prose.filter(item => item.canonical_ordinal < operation.canonical_ordinal).at(-1);
          const after = prose.find(item => item.canonical_ordinal > operation.canonical_ordinal);
          for (const [neighbor, follows] of [[before, true], [after, false]]) {
            if (!neighbor) continue;
            const relation = await row.evaluate((node, id) => {
              const other = document.querySelector('[data-flower-message-id="' + id + '"]');
              return other?.compareDocumentPosition(node) ?? null;
            }, neighbor.id);
            assert.notEqual(relation, null, 'the adjacent canonical assistant message must remain rendered');
            assert.ok(relation & (follows ? 4 : 2), 'the divider must keep its canonical position');
          }
          ids.push(await row.getAttribute('data-flower-decoration-id'));
        }
        const actual = await turn.locator('.flower-compaction-divider').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-flower-decoration-id')));
        assert.deepEqual(actual, ids);
        if (collapsible) {
          await summary.click();
          for (const id of ids) await page.locator('[data-flower-decoration-id="' + id + '"]').waitFor({ state: 'hidden' });
        }
      }
    }
    console.log(JSON.stringify({ readonlyHistory: setup.history, operations: operations.map(value => ({ operation: value.operation_id, turn: value.turn_id, ordinal: value.canonical_ordinal })), expanded: operations.length, canonicalNeighbors: true, collapsed: 0, refreshed: true }));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ liveStart: true, liveCompleteWhileActive: true, automatic: true, stableIdentityAndPosition: true, fold: true, reload: true }));
} finally { await browser.close(); }
