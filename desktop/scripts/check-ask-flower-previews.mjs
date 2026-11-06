import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
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
  const providerRequests = [];
  const expected = new Map();
  let providerError;
  let proofPath;
  let providerSequence = 0;
  const toolCalls = new Set();
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const provider = http.createServer(async (request, response) => {
    try {
      if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] })); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks)); const sequence = ++providerSequence;
      response.setHeader('Content-Type', 'text/event-stream');
      const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
      event({ type: 'response.created', response: { id: `ask-${sequence}`, created_at: Math.floor(Date.now() / 1000), model: 'gpt-5-mini' } });
      const complete = items => { event({ type: 'response.completed', response: { id: `ask-${sequence}`, model: 'gpt-5-mini', status: 'completed', output: items, usage: { input_tokens: 200, output_tokens: 40 } } }); response.end('data: [DONE]\n\n'); };
      const reply = text => {
        const item = { type: 'message', id: `message-${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
        event({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
        event({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text });
        event({ type: 'response.output_item.done', output_index: 0, item }); complete([item]);
      };
      if (!input.tools?.length) { reply('Ask Flower acceptance'); return; }
      const texts = strings(input.input);
      const marker = [...expected.keys()].find(key => texts.some(text => text.includes(key)));
      assert.ok(marker, 'The actual user prompt reaches the provider');
      const facts = expected.get(marker);
      assert.ok(texts.some(text => text.includes(facts) || text.includes(JSON.stringify(facts).slice(1, -1))), 'Exact preview facts reach the provider');
      assert.equal(input.model, 'gpt-5-mini');
      const images = value => value && typeof value === 'object' ? value.type === 'input_image' ? [value] : Object.values(value).flatMap(images) : [];
      const imageParts = images(input.input);
      if (marker === 'QUALIFY_ASK_IMAGE') {
        const native = await readFile(path.join(output, 'captured.png'));
        assert.ok(imageParts.some(part => part.image_url === `data:image/png;base64,${native.toString('base64')}`), 'Exact captured pixels reach the provider');
      }
      const results = (input.input ?? []).filter(item => item.type === 'function_call_output' && toolCalls.has(item.call_id));
      providerRequests.push({ marker, model: input.model, referencesExact: true, imageParts: imageParts.length, toolResults: results.length });
      if (!results.length) {
        assert.ok(input.tools.some(tool => tool.name === 'read_file'));
        const id = `read-${sequence}`; toolCalls.add(id);
        const item = { type: 'function_call', id, call_id: id, name: 'read_file', arguments: JSON.stringify({ path: proofPath }) };
        event({ type: 'response.output_item.added', output_index: 0, item }); event({ type: 'response.output_item.done', output_index: 0, item }); complete([item]); return;
      }
      assert.ok(results.some(item => String(item.output).includes('Ask Flower preview acceptance')), 'A real read tool returns the isolated fixture');
      reply(`ASK_FLOWER_COMPLETE_${marker}: context verified and fixture read successfully.`);
    } catch (error) { providerError = error.stack ?? String(error); if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await session.port(provider.address().port);
  await session.defer('Ask Flower qualification provider', async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const state = await session.directory(await mkdtemp(path.join(os.homedir(), '.redeven-ask-preview-')));
  await session.target(path.resolve(binary), state);
  await installReDevPluginRuntimeFixture(state);
  await copyFile(binary, path.join(state, 'redeven'));
  const directory = path.join(state, 'files');
  await mkdir(directory);
  proofPath = path.join(directory, 'preview-evidence.txt');
  await writeFile(proofPath, 'Ask Flower preview acceptance\nThe reference and screenshot must remain readable.\n');
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
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(new URL(route, startup.local_ui_url), { method, headers: { 'Content-Type': 'application/json', Origin: new URL(startup.local_ui_url).origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok && result.ok !== false, JSON.stringify(result)); return result.data ?? result;
  };
  await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', { model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'Ask Flower qualification', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini', input_modalities: ['text', 'image'], context_window: 128000, max_output_tokens: 8192 }] }] }, provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'qualification-only' }], web_search_provider_key_patches: [] });
  await api('/_redeven_proxy/api/ai/default_permission', 'PUT', { permission_type: 'readonly' });
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
  const report = { passed: false, carriers: 'Electron with built Env App and real local runtime', previews: [], targets: [], sends: [], providerRequests };
  try {
    await page.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
    await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Ask Flower', exact: true }).count(), 0, 'No extra Ask Flower header icon');
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
    const context = await text.textContent();
    assert.ok(context.includes('File Browser (files)'));
    assert.ok(context.includes(`directory: ${directory}`));
    assert.ok(!context.includes('selected_paths:'));
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
    await preview.locator('[data-floe-floating-window-control="close"]').click();
    await preview.waitFor({ state: 'hidden' });
    const sendAndVerify = async (marker, facts) => {
      expected.set(marker, facts);
      const previous = new Set((await api('/_redeven_proxy/api/ai/threads?limit=100')).threads.map(thread => thread.thread_id));
      await card.locator('textarea').fill(`${marker}: inspect the attached context and read ${proofPath}.`);
      await card.locator('.floe-prompt-card-submit').click();
      // The real renderer sends over the authenticated session, not page fetch.
      let threadID;
      for (let attempt = 0; attempt < 600; attempt++) {
        assert.ok(!providerError, providerError);
        const created = (await api('/_redeven_proxy/api/ai/threads?limit=100')).threads.filter(thread => !previous.has(thread.thread_id));
        assert.ok(created.length <= 1, 'One click creates exactly one task');
        if (created.length) { threadID = created[0].thread_id; break; }
        await delay(50);
      }
      assert.ok(threadID, await card.innerText());
      let detail;
      for (let attempt = 0; attempt < 600; attempt++) {
        assert.ok(!providerError, providerError);
        detail = await api(`/_redeven_proxy/api/ai/threads/${threadID}`);
        assert.notEqual(detail.current.last_outcome, 'failed', JSON.stringify(detail.current));
        if (detail.current.activity === 'idle' && detail.current.last_outcome === 'completed') break;
        await delay(50);
      }
      assert.equal(detail.current.last_outcome, 'completed');
      await card.waitFor({ state: 'hidden' });
      await page.getByText(`ASK_FLOWER_COMPLETE_${marker}: context verified and fixture read successfully.`, { exact: true }).filter({ visible: true }).waitFor();
      assert.ok(strings(detail).some(text => text.includes(facts)), 'Canonical admitted context matches the preview');
      assert.ok(!report.sends.some(previous => previous.threadID === threadID), 'Every Ask creates a new task');
      report.sends.push({ marker, threadID, outcome: detail.current.last_outcome, previewEqualsSubmission: true, answerVisible: true });
      await page.screenshot({ path: path.join(output, `completed-${marker}.png`) });
    };
    await sendAndVerify('QUALIFY_ASK_IMAGE', context);
    const rail = page.locator('[data-floe-shell-slot="activity-bar"]');
    const navigation = identity => rail.locator(`[data-floe-rail-icon="${identity}"]`).locator('xpath=ancestor::button[1]');
    await navigation('containers').click();
    await page.locator('[data-flower-context-page="containers"]').filter({ visible: true }).waitFor();
    await page.locator('[data-floe-shell-slot="top-bar"] button').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
    await card.locator('.flower-composer-context-source').first().click(); await text.waitFor();
    const shellContext = await text.innerText();
    assert.ok(shellContext.includes('kind: shell'));
    assert.ok(!shellContext.includes('containers'));
    report.shell = { context: shellContext, targetExact: true, extraHeaderAction: false };
    await page.screenshot({ path: path.join(output, 'shell-context.png') });
    await preview.locator('[data-floe-floating-window-control="close"]').click(); await preview.waitFor({ state: 'hidden' });
    for (const identity of ['files', 'terminal', 'monitor', 'code', 'globe', 'applications', 'settings']) {
      const target = navigation(identity);
      const label = await target.getAttribute('aria-label');
      await target.click({ button: 'right' });
      const action = page.getByRole('menuitem', { name: 'Ask Flower', exact: true });
      const slot = action.locator('.floe-context-action-icon');
      assert.ok((await slot.boundingBox()).width <= 14);
      assert.ok((await slot.locator('svg').boundingBox()).height <= 14);
      if (identity === 'files') await page.screenshot({ path: path.join(output, 'compact-context-menu.png') });
      await action.click(); await card.waitFor();
      if (identity === 'files') await card.locator('textarea').fill('Keep this question across targets');
      assert.equal(await card.locator('textarea').inputValue(), 'Keep this question across targets');
      const chip = card.locator('.flower-composer-context-source').first();
      assert.ok((await chip.innerText()).includes(label));
      await chip.click(); await text.waitFor();
      const context = await text.innerText();
      assert.ok(context.includes('kind: navigation'));
      assert.ok(context.includes(label));
      for (const unwanted of ['containers', 'filter:', 'selected_paths', 'screen_text:', 'source_instance_id']) assert.ok(!context.includes(unwanted), `${identity}: ${unwanted}`);
      await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: path.join(output, `navigation-${identity}.png`) });
      report.targets.push({ identity, label, context, iconBounded: true });
      await preview.locator('[data-floe-floating-window-control="close"]').click(); await preview.waitFor({ state: 'hidden' });
    }
    await sendAndVerify('QUALIFY_ASK_NAVIGATION', report.targets.at(-1).context);
    assert.equal(await app.evaluate(() => global.captures), 1);
    report.passed = true; report.captureCount = 1; report.draftRetained = true;
  } catch (error) {
    report.error = error.stack ?? String(error); report.providerError = providerError;
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally {
    await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(path.join(output, 'runtime.log'), logs);
  }
});
