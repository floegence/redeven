#!/usr/bin/env node
/* global window, document, innerHeight */
// A fresh product Runtime and optional owned Electron tree qualify pool summaries.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron } from 'playwright';
import { dump } from 'js-yaml';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { repeatedCallsDocument } from '../src/styles/tessiven-relation-summary.fixture.ts';

const [binary, outputArgument, desktopBundle] = process.argv.slice(2);
assert(binary && outputArgument, 'Usage: <Runtime bundle binary> <evidence directory> [Desktop bundle]');
const root = path.resolve(import.meta.dirname, '../../../..'), output = path.resolve(outputArgument);
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-relation-summary-')), state = path.join(temp, 'state'), marker = randomUUID();
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), marker, state, scenarios: [], geometry: [], errors: [] };
const originals = new Map();
let app, welcome, runtime, browser, page, runtimeLog = '', origin;
async function until(read, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime && (runtime.exitCode !== null || runtime.signalCode !== null)) throw new Error(runtimeLog);
    const value = await read(); if (value) return value; await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function ready(count) {
  await page.locator('[data-relation-summary]').first().waitFor();
  await until(async () => await page.locator('[data-relation-summary]').count() === 2 && await page.getByRole('status', { name: 'Arranging canvas', exact: true }).count() === 0, 'bounded collapsed graph');
  const group = await page.locator('.tessiven-group').boundingBox();
  report.geometry.push({ count, group });
  for (const row of await page.locator('[data-relation-summary]').all()) {
    assert.equal(await row.getAttribute('data-relation-count'), String(count), 'Original relation count');
    const box = await row.boundingBox(); assert(box.y + box.height <= group.y + group.height, 'Pattern inside group');
  }
  assert.equal(await page.locator('.tessiven-error').count(), 0);
}
async function canvas(count) {
  const id = `pool-${count}`;
  if (app) {
    const environment = app.context().pages().find(candidate => candidate.url().includes('/_redeven_proxy/env/') && !new URL(candidate.url()).searchParams.has('canvas'));
    assert(environment, 'Owned Env App session');
    assert.deepEqual(await environment.evaluate(request => window.redevenDesktopShell.openServiceCanvasWindow(request), { canvas_id: id }), { ok: true });
    page = await until(() => app.context().pages().find(candidate => candidate.url().includes('/_redeven_proxy/env/') && new URL(candidate.url()).searchParams.get('canvas') === id), 'Owned standalone canvas');
  } else await page.goto(new URL(`/_redeven_proxy/env/?surface=tessiven&window=service-canvas&canvas=${id}`, origin).href);
  page.on('pageerror', error => report.errors.push(error.message));
  await ready(count);
  // Flower loads independently of graph readiness. Close its public companion
  // window after it mounts so short-viewport graph controls remain accessible.
  const hide = page.getByRole('button', { name: 'Hide replies', exact: true });
  await hide.waitFor(); await hide.click();
  await page.getByRole('button', { name: 'Show replies', exact: true }).waitFor();
  assert.equal(await page.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(), 0);
}
try {
  await mkdir(output, { recursive: true });
  const library = path.join(state, 'local-environment/apps/tessiven/canvases.sqlite'); await mkdir(path.dirname(library), { recursive: true });
  const db = new DatabaseSync(library);
  try {
    db.exec(await readFile(path.join(root, 'internal/tessiven/testdata/schema_v1.sql'), 'utf8'));
    for (const count of [4,100,500,1000]) {
      const source = dump(repeatedCallsDocument(count)), id = `pool-${count}`;
      originals.set(id, source);
      db.prepare('INSERT INTO canvases VALUES(?,?,?,1,0,100,100)').run(id, `Runtime pool / ${count}`, '');
      db.prepare('INSERT INTO versions VALUES(?,1,?,?,100,?,?)').run(id, source, createHash('sha256').update(source).digest('hex'), 'import', 'Repeated local calls');
    }
  } finally { db.close(); }
  if (desktopBundle) {
    execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
    const require = createRequire(path.join(root, 'desktop/package.json'));
    const manifest = JSON.parse(await readFile(path.join(desktopBundle, 'desktop-bundle-manifest.json'), 'utf8'));
    assert(report.commit.startsWith(manifest.commit), 'Bundle belongs to source commit');
    app = await _electron.launch({ executablePath: require('electron'), cwd: temp,
      args: [path.join(root, 'desktop'), `--user-data-dir=${temp}/profile`, `--redeven-test-launch-id=${marker}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
        REDEVEN_DESKTOP_USER_DATA_ROOT: `${temp}/profile`, REDEVEN_DESKTOP_CACHE_ROOT: `${temp}/cache`, REDEVEN_DESKTOP_TEMP_ROOT: `${temp}/temp`,
        REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
        REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: desktopBundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit } });
    report.pid = app.process().pid;
    assert.equal(Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(report.pid)], { encoding: 'utf8' }).trim()), report.pid);
    welcome = await app.firstWindow(); await welcome.waitForFunction(() => Boolean(window.redevenDesktopSettings && window.redevenDesktopLanguage));
    await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
    await until(async () => (await welcome.evaluate(() => window.redevenDesktopSettings.requestRuntimeFlower({ method: 'GET', path: '/_redeven_proxy/api/ai/threads' }))).ok, 'Runtime readiness', 60000);
    await welcome.getByRole('button', { name: /^(Open|Show) Env App$/ }).first().click({ timeout: 60000 });
    await until(() => app.context().pages().some(candidate => candidate.url().includes('/_redeven_proxy/env/')), 'Owned Env App');
  } else {
    const staged = path.join(temp, 'redeven'); await copyFile(binary, staged);
    for (const name of ['redevplugin-runtime', '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json', 'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig', 'redevplugin-runtime.pem']) await copyFile(path.join(path.dirname(binary), name), path.join(temp, name));
    const startup = path.join(temp, 'startup.json');
    runtime = spawn(staged, ['run', '--mode', 'local', '--state-root', state, '--local-ui-bind', '127.0.0.1:0', '--presentation', 'machine', '--startup-report-file', startup], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] });
    runtime.stdout.on('data', chunk => { runtimeLog += chunk; }); runtime.stderr.on('data', chunk => { runtimeLog += chunk; });
    origin = (await until(async () => { try { return JSON.parse(await readFile(startup, 'utf8')); } catch { return null; } }, 'Runtime ready', 60000)).local_ui_url;
    report.runtime = { pid: runtime.pid, origin, state };
    browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  }
  for (const count of [4,100,500,1000]) await canvas(count);
  report.scenarios.push('four-to-thousand-hosts-have-two-bounded-patterns');
  await page.locator('[data-relation-summary]').first().click();
  assert.equal(await page.locator('[data-exact-relation-id]').count(), 50);
  for (let i = 0; i < 19; i++) await page.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.equal(await page.locator('[data-exact-relation-id="host-999-agent-call"]').count(), 1);
  await page.getByRole('searchbox', { name: 'Search nodes or endpoints', exact: true }).fill('host-999');
  assert.equal(await page.locator('[data-exact-relation-id]').count(), 1);
  await page.locator('[data-exact-relation-id]').click();
  assert((await page.locator('.tessiven-relation-exact').innerText()).includes('Design for Host 1000'));
  await page.getByRole('button', { name: 'Back to relationships', exact: true }).click();
  assert.equal(await page.getByRole('searchbox', { name: 'Search nodes or endpoints', exact: true }).inputValue(), 'host-999');
  report.scenarios.push('complete-last-page-search-evidence-and-back-state');
  for (const [mode, preset, forced] of [['light','porcelain-light',false], ['dark','porcelain-dark',false], ['light','hc-light',false], ['dark','porcelain-dark',true]]) {
    await page.emulateMedia({ forcedColors: forced ? 'active' : 'none', colorScheme: mode });
    if (welcome) {
      await welcome.evaluate(async ({mode,preset}) => { await window.redevenDesktopTheme.setShellTheme(mode,preset); await window.redevenDesktopTheme.setSource(mode); }, {mode,preset});
      await page.waitForFunction(({mode,preset}) => document.documentElement.classList.contains('dark') === (mode === 'dark') && document.documentElement.dataset.floeShellTheme === preset && !document.documentElement.dataset.redevenThemeSwitching, {mode,preset});
    } else await page.evaluate(({mode,tokens}) => {
      document.documentElement.classList.toggle('dark', mode === 'dark');
      for (const [name,value] of Object.entries(tokens)) if (value) document.documentElement.style.setProperty(name,value);
    }, {mode,tokens: builtInShellThemePresets.find(theme => theme.name === preset).semanticTokens});
    await page.screenshot({ path: path.join(output, `${welcome ? 'desktop' : 'envapp'}-${forced ? 'forced-dark' : preset}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ forcedColors: 'none' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Expand group', exact: true }).click();
    await page.locator('.tessiven-node').waitFor();
    assert.equal(await page.locator('.tessiven-pool-relations').count(), 1);
    await page.locator('.tessiven-node-selector select').selectOption('host-999');
    await page.locator('[data-node-id="host-999"]').waitFor();
    assert.equal(await page.locator('[data-node-id="host-999"] [data-relation-id]').count(), 2);
    await page.getByRole('button', { name: 'Collapse group', exact: true }).click(); await ready(1000);
  }
  report.scenarios.push('compact-reflows-and-stable-pool-overview');
  if (app) {
    await app.evaluate(({BrowserWindow}, url) => { const target = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url); target.setMinimumSize(600,320); target.setContentSize(800,420); }, page.url());
    await page.waitForFunction(() => innerHeight <= 420);
  } else await page.setViewportSize({ width: 800, height: 420 });
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.locator('[data-relation-summary]').first().click();
  await until(async () => page.locator('.tessiven-popup').evaluate(panel => panel.getBoundingClientRect().bottom <= innerHeight), 'Popup inside short viewport');
  await page.screenshot({ path: path.join(output, 'short-window.png'), animations: 'disabled' });
  await page.reload(); await ready(1000); report.scenarios.push('short-window-and-reload');
  const check = new DatabaseSync(library, { readOnly: true });
  try { for (const [id, source] of originals) assert.equal(check.prepare('SELECT document_yaml FROM versions WHERE canvas_id=? AND number=1').get(id).document_yaml, source); } finally { check.close(); }
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
} finally {
  await browser?.close();
  if (app) {
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:0,checkboxChecked:false}); }); await app.close();
    const inventory = JSON.parse(execFileSync(binary, ['desktop-target-process-inventory', '--target-root', state], { encoding: 'utf8' }));
    const stopped = JSON.parse(execFileSync(binary, ['desktop-target-process-stop', '--target-root', state, '--expected-inventory-digest', inventory.inventory_digest], { encoding: 'utf8' }));
    assert.deepEqual(stopped.after.instances, []);
  }
  if (runtime && runtime.exitCode === null) { const stopped = new Promise(resolve => runtime.once('exit',resolve)); runtime.kill('SIGTERM'); await stopped; }
  await writeFile(path.join(output, 'runtime.log'), runtimeLog); await writeFile(path.join(output, 'report.json'), JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
