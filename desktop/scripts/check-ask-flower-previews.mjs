import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { build } from 'esbuild';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { PNG } from '../../internal/envapp/ui_src/node_modules/pngjs/lib/png.js';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { installReDevPluginRuntimeFixture } from '../../internal/envapp/ui_src/scripts/redevpluginRuntimeFixture.mjs';

const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const binary = argument('--binary');
const output = argument('--output');
if (!binary || !output) throw new Error('Required: --binary <built runtime> --output <evidence directory>');
const root = path.resolve(import.meta.dirname, '../..');
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 240000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await session.run(async () => {
  await mkdir(output, { recursive: true });
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const state = await session.directory(await mkdtemp(path.join(os.homedir(), '.redeven-ask-preview-')));
  await session.target(path.resolve(binary), state);
  await installReDevPluginRuntimeFixture(state);
  await copyFile(binary, path.join(state, 'redeven'));
  const directory = path.join(state, 'files');
  await mkdir(directory);
  await writeFile(path.join(directory, 'preview-evidence.txt'), 'Ask Flower preview acceptance\nThe reference and screenshot must remain readable.\n');
  const startupFile = path.join(state, 'startup.json');
  const runtime = await session.spawn(path.join(state, 'redeven'), ['run', '--mode', 'desktop', '--state-root', path.join(state, 'state'),
    '--local-ui-bind', '127.0.0.1:0', '--local-ui-protocol', 'http', '--presentation', 'machine', '--startup-report-file', startupFile],
  { cwd: state, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'service' });
  let logs = '';
  runtime.stdout.on('data', chunk => { logs += chunk; }); runtime.stderr.on('data', chunk => { logs += chunk; });
  let startup;
  for (let attempt = 0; attempt < 600; attempt++) {
    try { const value = JSON.parse(await readFile(startupFile, 'utf8')); if (value.status === 'ready') { startup = value; break; } }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (runtime.exitCode !== null) throw new Error(logs);
    await delay(50);
  }
  assert.ok(startup, logs);
  await build({ stdin: { contents: "import { bootstrapDesktopShellBridge } from './desktop/src/preload/desktopShell'; bootstrapDesktopShellBridge();", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(state, 'preload.cjs') });
  await build({ entryPoints: [path.join(root, 'desktop/src/main/manualScreenshot.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(state, 'capture.cjs') });
  await writeFile(path.join(state, 'main.cjs'), `const { app, BrowserWindow, ipcMain } = require('electron');
const { captureAuthorizedPage } = require('./capture.cjs');
app.commandLine.appendSwitch('lang', 'en-US');
app.whenReady().then(() => { const win = new BrowserWindow({ width: 1440, height: 960, useContentSize: true,
webPreferences: { preload: ${JSON.stringify(path.join(state, 'preload.cjs'))}, contextIsolation: true, sandbox: true } });
global.captures = 0; ipcMain.handle('redeven-desktop:manual-screenshot', async (event, input) => {
 if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Wrong capture source');
 global.captures++; const image = await captureAuthorizedPage(event.sender, { ...input, valid: () => event.sender === win.webContents });
 require('fs').writeFileSync(${JSON.stringify(path.join(output, 'captured.png'))}, image.png); return image; });
win.loadURL('about:blank'); }); app.on('window-all-closed', () => app.quit());`);
  const app = await session.launchElectron(_electron, { executablePath: electron, args: [path.join(state, 'main.cjs'), `--user-data-dir=${state}/profile`], cwd: state, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const report = { passed: false, carriers: 'Electron with built Env App and real local runtime', previews: [] };
  try {
    await page.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
    await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'File Browser', exact: true }).filter({ visible: true }).last().click();
    await page.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last().click();
    await page.getByRole('textbox', { name: 'Go to path', exact: true }).fill(directory);
    await page.getByRole('textbox', { name: 'Go to path', exact: true }).press('Enter');
    await page.getByText('preview-evidence.txt', { exact: true }).filter({ visible: true }).last().waitFor();
    await page.getByRole('textbox', { name: 'Filter files', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
    const card = page.locator('[data-floe-prompt-card]'); await card.waitFor();
    await card.locator('textarea').fill('Inspect this file browser context');
    assert.equal(await app.evaluate(() => global.captures), 0);
    await card.locator('.flower-composer-context-source').first().click();
    const preview = page.locator('.flower-context-preview-window');
    const text = preview.locator('[data-flower-context-preview-text]');
    await text.waitFor();
    const context = JSON.parse(await text.textContent());
    assert.equal(context.page.id, 'files');
    assert.equal(context.state.directory, directory);
    assert.ok((await text.boundingBox()).height > 240);
    assert.equal(await preview.locator('.redeven-file-preview-toolbar').count(), 0);
    assert.equal(await preview.locator('[data-flower-context-preview-close]').count(), 0);
    await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: path.join(output, 'context.png') });
    report.previews.push({ type: 'frozen-context', context, visible: true });
    await preview.locator('[data-floe-floating-window-control="close"]').click();
    await preview.waitFor({ state: 'hidden' });
    const proof = await page.evaluate(() => {
      const source = [...document.querySelectorAll('[data-flower-context-page="files"]')].find(element => element.getClientRects().length);
      const bounds = source.getBoundingClientRect();
      const marker = document.createElement('div'); marker.id = 'preview-capture-marker';
      Object.assign(marker.style, { position: 'absolute', right: '30px', bottom: '80px', width: '40px', height: '40px', background: 'rgb(225, 86, 165)', zIndex: '1' });
      source.style.position = 'relative'; source.append(marker);
      const rect = marker.getBoundingClientRect();
      return { x: rect.x + 20 - Math.floor(bounds.x), y: rect.y + 20 - Math.floor(bounds.y), width: Math.ceil(bounds.right) - Math.floor(bounds.left), height: Math.ceil(bounds.bottom) - Math.floor(bounds.top) };
    });
    await card.getByRole('button', { name: 'Capture view', exact: true }).click();
    const screenshot = card.locator('.flower-composer-context-source').filter({ hasText: /Screenshot-.*\.png/ });
    await screenshot.waitFor(); await screenshot.click();
    const image = preview.locator('img'); await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.flower-context-preview-window img')?.naturalWidth > 0);
    const bytes = Buffer.from(await image.evaluate(async element => [...new Uint8Array(await (await fetch(element.src)).arrayBuffer())]));
    const captured = await readFile(path.join(output, 'captured.png'));
    assert.equal(hash(bytes), hash(captured));
    const png = PNG.sync.read(bytes);
    const offset = (Math.floor(proof.y * png.height / proof.height) * png.width + Math.floor(proof.x * png.width / proof.width)) * 4;
    const pixel = [...png.data.subarray(offset, offset + 3)];
    // Native macOS capture applies the display color profile; retain a tight channel tolerance.
    assert.ok(pixel.every((channel, index) => Math.abs(channel - [225, 86, 165][index]) < 20), `Capture proof pixel: ${pixel}`);
    assert.ok((await image.boundingBox()).height > 240);
    assert.equal(await preview.locator('.redeven-file-preview-toolbar').count(), 0);
    const title = await screenshot.innerText();
    assert.equal((await preview.innerText()).trim(), title.trim());
    await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: path.join(output, 'image.png') });
    report.previews.push({ type: 'screenshot', sha256: hash(bytes), width: png.width, height: png.height, pixelProof: true, visible: true });
    await preview.locator('[data-floe-floating-window-control="close"]').click();
    await preview.waitFor({ state: 'hidden' });
    assert.equal(await card.locator('textarea').inputValue(), 'Inspect this file browser context');
    await screenshot.click(); await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.flower-context-preview-window img')?.naturalWidth > 0);
    assert.equal(await app.evaluate(() => global.captures), 1);
    await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: path.join(output, 'image-reopened.png') });
    report.passed = true; report.captureCount = 1; report.draftRetained = true;
  } catch (error) {
    report.error = error.stack ?? String(error);
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally {
    await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(path.join(output, 'runtime.log'), logs);
  }
});
