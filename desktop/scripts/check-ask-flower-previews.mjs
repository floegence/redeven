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
  const expectedFiles = new Map();
  const fixtureBodies = new Map();
  let providerError;
  let proofPath;
  let expectedModelImage;
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
      const marker = [...expected.keys()].reverse().find(key => texts.some(text => text.includes(key)));
      assert.ok(marker, 'The actual user prompt reaches the provider');
      const facts = expected.get(marker);
      assert.ok(texts.some(text => text.includes(facts) || text.includes(JSON.stringify(facts).slice(1, -1))), 'Exact preview facts reach the provider');
      const sourceFile = expectedFiles.get(marker);
      if (sourceFile) assert.ok(texts.some(text => text.includes(sourceFile) || text.includes(JSON.stringify(sourceFile).slice(1, -1))), 'The selected file identity accompanies its text');
      assert.equal(input.model, 'gpt-5-mini');
      const images = value => value && typeof value === 'object' ? value.type === 'input_image' ? [value] : Object.values(value).flatMap(images) : [];
      const imageParts = images(input.input);
      if (marker === 'QUALIFY_ASK_IMAGE') {
        assert.ok(imageParts.some(part => typeof part.image_url === 'string' && part.image_url.startsWith(`data:${expectedModelImage.mimeType};base64,`)
          && hash(Buffer.from(part.image_url.split(',')[1], 'base64')) === expectedModelImage.sha256), 'The exact prepared representation of the captured screenshot reaches the provider');
      } else {
        assert.equal(imageParts.length, 0, 'A new navigation task does not inherit the previous screenshot');
      }
      const results = (input.input ?? []).filter(item => item.type === 'function_call_output' && toolCalls.has(item.call_id));
      providerRequests.push({ marker, model: input.model, referencesExact: true, imageParts: imageParts.length, toolResults: results.length, readPath: sourceFile ?? proofPath });
      if (!results.length) {
        assert.ok(input.tools.some(tool => tool.name === 'file_read'));
        const id = `read-${sequence}`; toolCalls.add(id);
        const item = { type: 'function_call', id, call_id: id, name: 'file_read', arguments: JSON.stringify({ path: sourceFile ?? proofPath }) };
        event({ type: 'response.output_item.added', output_index: 0, item }); event({ type: 'response.output_item.done', output_index: 0, item }); complete([item]); return;
      }
      assert.ok(results.some(item => strings(JSON.parse(item.output)).includes(fixtureBodies.get(sourceFile ?? proofPath))), 'A real file read returns the exact referenced fixture');
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
  const selectedCode = '  const selected = "quoted context";\n\treturn selected;';
  const codePath = path.join(directory, 'selection.ts');
  const markdownPath = path.join(directory, 'reading.md');
  await writeFile(codePath, 'const unrelated = "outside selection";\n' + selectedCode + '\nconst tail = true;\n');
  await writeFile(markdownPath, '# Preview reading\n\nOnly this selected paragraph.\n\nDo not include the other paragraph.\n');
  for (const file of [proofPath, codePath, markdownPath]) fixtureBodies.set(file, await readFile(file, 'utf8'));
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
  // Runtime HTTP readiness precedes the asynchronously prepared Flower host.
  // Observe readiness before configuring the isolated provider; never replay writes.
  let readiness;
  for (let attempt = 0; attempt < 600; attempt++) {
    readiness = await api('/_redeven_proxy/api/ai/readiness');
    if (readiness.state === 'ready') break;
    assert.ok(!['blocked', 'unavailable', 'stopped'].includes(readiness.state), JSON.stringify(readiness));
    await delay(50);
  }
  assert.equal(readiness.state, 'ready', JSON.stringify(readiness));
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
  const report = { passed: false, carriers: 'Electron with built Env App and real local runtime',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeClean: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '',
    binarySHA256: hash(await readFile(binary)),
    floe: JSON.parse(await readFile(path.join(root, 'internal/envapp/ui_src/node_modules/@floegence/floe-webapp-core/package.json'), 'utf8')).version,
    previews: [], targets: [], sends: [], providerRequests };
  try {
    await page.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
    await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Ask Flower', exact: true }).count(), 0, 'No extra Ask Flower header icon');
    report.extraHeaderAction = false;
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
    await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
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
    expectedModelImage = JSON.parse(execFileSync('go', ['run', './scripts/fixtures/ask_flower_model_image', path.join(output, 'captured.png')], { cwd: root, env: { ...process.env, GOWORK: 'off' }, encoding: 'utf8' }));
    assert.equal(expectedModelImage.sourceSHA256, hash(captured));
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
    report.previews.push({ type: 'screenshot', sha256: hash(bytes), width: png.width, height: png.height, pixelProof: true, visible: true, modelImage: expectedModelImage });
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
    const sendAndVerify = async (marker, facts, sourceFile) => {
      if (sourceFile) expectedFiles.set(marker, sourceFile);
      expected.set(marker, facts);
      const previous = new Set((await api('/_redeven_proxy/api/ai/threads?limit=100')).threads.map(thread => thread.thread_id));
      await card.locator('textarea').fill(`${marker}: inspect the attached context and read ${sourceFile ?? proofPath}.`);
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
      const answer = page.getByText(`ASK_FLOWER_COMPLETE_${marker}: context verified and fixture read successfully.`, { exact: true }).filter({ visible: true });
      await answer.waitFor();
      await page.waitForFunction(marker => {
        const element = [...document.querySelectorAll('[data-flower-message-role="assistant"]')].find(node => node.textContent?.includes(`ASK_FLOWER_COMPLETE_${marker}:`));
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(Math.min(innerWidth - 1, rect.x + rect.width / 2), Math.min(innerHeight - 1, rect.y + rect.height / 2));
        return target && element.contains(target);
      }, marker);
      const references = (detail.current.items ?? []).flatMap(item => item.references ?? []);
      if (sourceFile !== facts) assert.ok(references.some(reference => reference.text === facts), 'Canonical admitted reference exactly matches the preview');
      if (sourceFile) {
        assert.equal(references.length, sourceFile === facts ? 1 : 2, 'Only the selected file and explicit text enter canonical history');
        const source = detail.current.items.find(item => item.references?.some(reference => reference.kind === 'file'));
        const reference = source?.references.find(reference => reference.kind === 'file');
        assert.ok(reference, 'Canonical history contains the source file');
        assert.equal(reference.text, undefined, 'Public references keep resource locators behind authorized resolution');
        const target = await api(`/_redeven_proxy/api/ai/threads/${threadID}/reference-open-target`, 'POST', { turn_id: source.turn_id, reference_id: reference.reference_id });
        assert.equal(target.kind, 'file');
        assert.equal(target.path, sourceFile, 'Authorized canonical reference resolves the exact source file');
        if (sourceFile !== facts) assert.ok(references.some(reference => reference.kind === 'text' && reference.text === facts && !reference.truncated), 'Canonical selection preserves whitespace without truncation');
      }
      assert.ok(!report.sends.some(previous => previous.threadID === threadID), 'Every Ask creates a new task');
      report.sends.push({ marker, threadID, outcome: detail.current.last_outcome, previewEqualsSubmission: true, answerVisible: true, references: references.map(({ kind, label, text, truncated }) => ({ kind, label, text, truncated: !!truncated })) });
      await page.screenshot({ path: path.join(output, `completed-${marker}.png`) });
    };
    await sendAndVerify('QUALIFY_ASK_IMAGE', context);
    const rail = page.locator('[data-floe-shell-slot="activity-bar"]');
    const navigation = identity => rail.locator(`[data-floe-rail-icon="${identity}"]`).locator('xpath=ancestor::button[1]');
    await navigation('containers').click();
    await page.locator('[data-flower-context-page="containers"]').filter({ visible: true }).waitFor();
    await page.locator('[data-floe-shell-slot="top-bar"] button').filter({ visible: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
    await card.locator('.flower-composer-context-source').first().click(); await text.waitFor();
    const shellContext = await text.innerText();
    assert.ok(shellContext.includes('kind: shell'));
    assert.ok(!shellContext.includes('containers'));
    report.shell = { context: shellContext, targetExact: true, extraHeaderAction: false };
    await page.screenshot({ path: path.join(output, 'shell-context.png') });
    await preview.locator('[data-floe-floating-window-control="close"]').click(); await preview.waitFor({ state: 'hidden' });
    for (const identity of ['flower', 'files', 'terminal', 'monitor', 'code', 'globe', 'applications', 'containers', 'connections', 'launchpad', 'settings']) {
      const target = navigation(identity);
      const label = await target.getAttribute('aria-label');
      await target.click({ button: 'right' });
      const action = page.getByRole('menuitem', { name: 'Ask Flower', exact: true });
      const slot = action.locator('.floe-context-action-icon');
      assert.ok((await slot.boundingBox()).width <= 14);
      assert.ok((await slot.locator('svg').boundingBox()).height <= 14);
      if (identity === 'files') await page.screenshot({ path: path.join(output, 'compact-context-menu.png') });
      await action.click(); await card.waitFor();
      if (identity === 'flower') await card.locator('textarea').fill('Keep this question across targets');
      assert.equal(await card.locator('textarea').inputValue(), 'Keep this question across targets');
      const chip = card.locator('.flower-composer-context-source').first();
      assert.ok((await chip.innerText()).includes(label));
      await chip.click(); await text.waitFor();
      const context = await text.innerText();
      assert.ok(context.includes('kind: navigation'));
      assert.ok(context.includes(label));
      for (const unwanted of [...(identity === 'containers' ? [] : ['containers']), 'filter:', 'selected_paths', 'screen_text:', 'source_instance_id']) assert.ok(!context.includes(unwanted), `${identity}: ${unwanted}`);
      await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: path.join(output, `navigation-${identity}.png`) });
      report.targets.push({ identity, label, context, iconBounded: true });
      await preview.locator('[data-floe-floating-window-control="close"]').click(); await preview.waitFor({ state: 'hidden' });
    }
    await sendAndVerify('QUALIFY_ASK_NAVIGATION', report.targets.at(-1).context);

    // Exercise the real conversation menu and renderer, not just the launcher.
    await navigation('flower').click();
    const product = page.locator('#redeven-activity-flower-product');
    const surface = product.locator('[data-flower-selected-thread-id]');
    const originalThreadID = report.sends.at(-1).threadID;
    await page.waitForFunction(id => document.querySelector('#redeven-activity-flower-product [data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === id, originalThreadID);
    const originalEditor = product.locator('.flower-composer textarea');
    const draft = 'Retain this unsent source conversation draft';
    await originalEditor.fill(draft);
    await page.waitForFunction(() => document.querySelector('#redeven-activity-flower-product')?.getAttribute('data-presentation') === 'full_page');
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    await product.evaluate(element => {
      const surface = element.querySelector('[data-flower-selected-thread-id]');
      const editor = element.querySelector('.flower-composer textarea');
      window.askFlowerContinuity = { product: element, surface, editor, bounds: element.getBoundingClientRect().toJSON() };
    });
    const assertOriginalPage = async () => {
      assert.equal(await surface.getAttribute('data-flower-selected-thread-id'), originalThreadID);
      assert.equal(await originalEditor.inputValue(), draft);
      const retained = await product.evaluate(element => {
        const source = window.askFlowerContinuity;
        return { visible: !element.hidden && !element.inert && element.getAttribute('aria-hidden') !== 'true' && element.checkVisibility(),
          sameProduct: element === source.product, sameSurface: element.querySelector('[data-flower-selected-thread-id]') === source.surface,
          sameEditor: element.querySelector('.flower-composer textarea') === source.editor,
          sameBounds: ['x', 'y', 'width', 'height'].every(key => Math.abs(element.getBoundingClientRect()[key] - source.bounds[key]) < 1),
          transcriptVisible: source.surface.getAttribute('data-flower-transcript-visible') === 'true' };
      });
      for (const [name, passed] of Object.entries(retained)) assert.equal(passed, true, `Flower page continuity: ${name}`);
      await product.locator('[data-flower-message-role="assistant"]').filter({ hasText: 'ASK_FLOWER_COMPLETE_QUALIFY_ASK_NAVIGATION' }).waitFor();
    };
    const openFromMessage = async () => {
      await product.locator('[data-flower-message-role="user"]').last().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
      await card.waitFor();
      await assertOriginalPage();
    };
    for (const dismissal of ['close', 'escape']) {
      await openFromMessage();
      if (dismissal === 'close') await card.locator('.floe-prompt-card-close').click();
      else await card.locator('textarea').press('Escape');
      await card.waitFor({ state: 'hidden' });
      await assertOriginalPage();
    }
    await openFromMessage();
    await card.locator('.flower-composer-context-source').first().click();
    await text.waitFor();
    const flowerContext = await text.innerText();
    assert.ok(flowerContext.includes('Flower (ai)'), 'The reference identifies the Flower surface');
    assert.ok(flowerContext.includes(`thread_id: ${originalThreadID}`), 'The reference identifies the original conversation');
    await assertOriginalPage();
    await page.screenshot({ path: path.join(output, 'flower-page-reference.png') });
    await preview.locator('[data-floe-floating-window-control="close"]').click();
    await preview.waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'flower-page-card.png') });
    await sendAndVerify('QUALIFY_ASK_FLOWER_PAGE', flowerContext);
    assert.equal(await surface.getAttribute('data-flower-selected-thread-id'), report.sends.at(-1).threadID);
    assert.equal(await product.getAttribute('data-presentation'), 'full_page');
    assert.equal(await product.evaluate(element => element.hidden), false);
    await product.locator(`[data-thread-id="${originalThreadID}"] button`).first().click();
    await page.waitForFunction(id => document.querySelector('#redeven-activity-flower-product [data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === id, originalThreadID);
    await assertOriginalPage();
    report.flowerPage = { originalThreadID, newThreadID: report.sends.at(-1).threadID, pageRetained: true, draftRetained: true, contextPreviewed: true, dismissals: ['close', 'escape'], newTaskAnswerVisible: true };
    assert.equal(await app.evaluate(() => global.captures), 1);
    await navigation('files').click();
    const fileWindow = page.locator('.file-preview-floating-window').filter({ has: page.locator('.redeven-file-preview') });
    const openFile = async name => {
      await page.getByText(name, { exact: true }).filter({ visible: true }).last().dblclick();
      await fileWindow.waitFor();
    };
    const askAt = async (target, position) => {
      await target.click({ button: 'right', ...(position ? { position } : {}) });
      // Monaco arms pointer selection after its native menu appears.
      await page.waitForTimeout(120);
      await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
      await card.waitFor();
      await card.locator('textarea').evaluate(async element => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = element.getBoundingClientRect();
        if (element !== document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) throw new Error('Ask Flower is covered by its source window');
        if (document.activeElement !== element) throw new Error('Ask Flower does not own typing focus');
      });
    };
    const closeCard = async () => { await card.locator('.floe-prompt-card-close').click(); await card.waitFor({ state: 'hidden' }); };
    const inspectSelection = async (selection, file) => {
      const chips = card.locator('.flower-composer-context-source');
      assert.equal(await chips.count(), 2, 'Only the file and explicit selection are attached');
      await chips.nth(1).click(); await text.waitFor();
      assert.equal(await text.textContent(), selection, 'Preview preserves the exact selected text');
      await preview.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
      await page.waitForFunction(() => document.querySelector('.flower-context-preview-window')?.getAttribute('data-floating-presence') === 'open');
      await page.screenshot({ path: path.join(output, `selection-${path.basename(file)}.png`) });
      await preview.locator('[data-floe-floating-window-control="close"]').click(); await preview.waitFor({ state: 'hidden' });
      report.previews.push({ type: 'file-selection', file, selection, exact: true });
    };
    await openFile('selection.ts');
    const editor = fileWindow.locator('.monaco-editor');
    await editor.locator('.view-lines').click();
    await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ArrowLeft');
    for (const _ of 'const unrelated = "outside selection";\n') await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    for (const _ of selectedCode) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    assert.ok(await editor.locator('.selected-text').count(), 'A real Monaco text selection exists before asking');
    const selectedLine = editor.locator('.view-line').filter({ hasText: 'const selected' });
    await askAt(selectedLine, { x: 100, y: 9 });
    await inspectSelection(selectedCode, codePath);
    await card.locator('textarea').fill('Keep this draft');
    await askAt(selectedLine, { x: 100, y: 9 });
    assert.equal(await card.locator('textarea').inputValue(), 'Keep this draft');
    await inspectSelection(selectedCode, codePath);
    await sendAndVerify('QUALIFY_ASK_FILE_SELECTION', selectedCode, codePath);
    await fileWindow.locator('[data-floe-floating-window-control="close"]').click();
    await openFile('reading.md');
    const paragraph = fileWindow.locator('.file-markdown-body p').first();
    await paragraph.click();
    await paragraph.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await askAt(paragraph);
    await inspectSelection('Only this selected paragraph.', markdownPath);
    await sendAndVerify('QUALIFY_ASK_MARKDOWN_SELECTION', 'Only this selected paragraph.', markdownPath);
    await askAt(fileWindow.locator('[data-floe-floating-window-titlebar]'));
    assert.equal(await card.locator('.flower-composer-context-source').count(), 1);
    assert.ok((await card.innerText()).includes('reading.md'));
    await sendAndVerify('QUALIFY_ASK_FILE_TITLE', markdownPath, markdownPath);
    await fileWindow.locator('[data-floe-floating-window-control="close"]').click();
    const standalone = new URL(page.url());
    standalone.search = ''; standalone.hash = '';
    standalone.searchParams.set('window', 'file-preview'); standalone.searchParams.set('path', codePath);
    await page.goto(standalone.href);
    const standaloneEditor = page.locator('[data-file-preview-standalone] .monaco-editor');
    await standaloneEditor.locator('.view-lines').click(); await page.keyboard.press('ControlOrMeta+a');
    const allCode = await readFile(codePath, 'utf8');
    await askAt(standaloneEditor.locator('.view-line').first(), { x: 100, y: 9 });
    await inspectSelection(allCode, codePath);
    await sendAndVerify('QUALIFY_ASK_STANDALONE', allCode, codePath);
    await askAt(page.locator('[data-file-preview-standalone] header'));
    await closeCard();
    report.filePreview = { repeatedContextMenu: true, draftRetained: true, titlebar: true, monaco: true, markdown: true, standalone: true };
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
