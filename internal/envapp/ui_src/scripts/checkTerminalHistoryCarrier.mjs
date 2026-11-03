#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { createDesktopTestSession } from '../../../../scripts/desktop_test_session.mjs';
import { terminalPerformanceSourceStateHash } from './terminalCarrierThreshold.mjs';
import { startRuntime, stopRuntime, readTLSServerSPKIHash, openEnvPage, selectSurface, activateSession, createSession, sendTerminalCommand, runtimeTrace, waitForTrace } from './checkSemanticTerminalCarrier.mjs';

const args = process.argv.slice(2);
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 240000 });
const electronMode = args.includes('--electron');
async function run() {
  const outputIndex = args.indexOf('--output');
  const output = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : '/tmp/redeven-terminal-history-acceptance');
  await mkdir(output, { recursive: true });
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'redeven-history-runtime-'));
  await session.directory(stateDir);
  const endpoint = '/_redeven_proxy/api/terminal/history-retention';
  const inputSelector = '[data-terminal-input-bridge="semantic"]';
  const clipboardModifier = process.platform === 'darwin' ? 'Meta' : 'Control+Shift';
  const sourceDiff = execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'utf8' });
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const untracked = execFileSync('git', ['ls-files', '--full-name', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const sourceState = terminalPerformanceSourceStateHash({ trackedDiff: sourceDiff, untrackedEntries: await Promise.all(untracked.map(async name => ({ path: name, content: await readFile(path.join(repoRoot, name)) }))) });
  const report = { browser: null, sourceStateSHA256: sourceState.sha256, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cases: [], ports: [], stateDir };
  let runtime, browser, page, dockerContainer;
  await session.defer('Stop terminal history Runtime', () => stopRuntime(runtime));
  const originalDockerConfig = process.env.DOCKER_CONFIG, originalDockerContext = process.env.DOCKER_CONTEXT;
  const check = async (name, operation) => { const result = await operation(); report.cases.push({ name, result: result ?? 'passed' }); console.log('PASS ' + name); };
  async function poll(read, predicate, label) {
    const deadline = Date.now() + 15000; let value;
    do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
    throw new Error(label + ': ' + JSON.stringify(value));
  }
  async function api(sessionId) {
    return page.evaluate(async ({ endpoint, sessionId }) => {
      const response = await fetch(endpoint + (sessionId ? '?session_id=' + encodeURIComponent(sessionId) : ''));
      const value = await response.json(); if (!response.ok || !value.ok) throw new Error(JSON.stringify(value)); return value.data;
    }, { endpoint, sessionId });
  }
  async function settings(panel) {
    await panel.getByTitle('More options', { exact: true }).click();
    await page.getByText('Terminal settings', { exact: true }).last().click();
    const dialog = page.getByRole('dialog').last();
    await dialog.locator('[data-terminal-history-settings] input').first().waitFor();
    return dialog;
  }
  async function fillLimits(dialog, lines, memory) {
    await dialog.getByLabel('Maximum history rows', { exact: true }).fill(lines);
    await dialog.getByLabel('Memory budget (MiB)', { exact: true }).fill(memory);
  }
  async function close(dialog) { await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); }
  async function browse(terminal) {
    const bar = terminal.getByRole('scrollbar');
    await bar.focus(); await page.keyboard.press('Home');
    await waitForTrace(terminal, trace => trace.history_projected && !trace.history_busy && trace.history_offset === 0);
    return bar;
  }
  async function portReleased(port) {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => server.close(resolve));
  }
  async function restart() {
    const previous = runtime;
    await stopRuntime(previous);
    assert(previous.state.exited);
    await portReleased(Number(new URL(previous.startup.local_ui_url).port));
    const startupPath = path.join(stateDir, 'startup.json'); await rm(startupPath);
    const child = await session.spawn(path.join(stateDir, 'redeven'), ['run', '--mode', 'local', '--state-root', previous.stateRoot, '--local-ui-bind', '127.0.0.1:0', '--local-ui-protocol', 'https', '--presentation', 'machine', '--startup-report-file', startupPath], { env: { ...process.env, HOME: path.join(stateDir, 'home'), GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { exited: false, stdout: '', stderr: '' };
    child.stdout.on('data', value => { state.stdout += value; }); child.stderr.on('data', value => { state.stderr += value; });
    child.once('exit', () => { state.exited = true; });
    runtime = { ...previous, child, state, startup: null };
    runtime.startup = await poll(async () => { try { return JSON.parse(await readFile(startupPath, 'utf8')); } catch { return null; } }, value => value?.status === 'ready', 'cold restart readiness');
  }
  async function closeClient() {
    if (electronMode) await session.closeElectron(browser);
    else await session.closeBrowser(browser);
    browser = null;
  }
  async function openClient() {
    const spki = await readTLSServerSPKIHash(runtime.startup.local_ui_url, runtime.authorityCertificatePath);
    const url = new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).href;
    let context;
    if (electronMode) {
      const entry = path.join(stateDir, 'history-electron.cjs');
      await writeFile(entry, `const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('lang', 'en-US');
  app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', process.env.REDEVEN_HISTORY_SPKI);
  app.whenReady().then(() => {
   const window = new BrowserWindow({ width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
   window.loadURL(process.env.REDEVEN_HISTORY_URL);
  });
  app.on('window-all-closed', () => app.quit());
  `);
      const require = createRequire(new URL('../../../../desktop/package.json', import.meta.url));
      browser = await session.launchElectron(electron, { executablePath: require('electron'), args: [entry, '--user-data-dir=' + path.join(stateDir, 'electron-profile')], env: { ...process.env, REDEVEN_HISTORY_URL: url, REDEVEN_HISTORY_SPKI: spki } });
      report.browser = await browser.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));
      context = browser.context(); page = await browser.firstWindow();
      await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 30000 });
    } else {
      browser = await session.launchBrowser(chromium, { headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
      report.browser = browser.version();
      context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
      ({ page } = await openEnvPage(context, url));
    }
    const port = Number(new URL(runtime.startup.local_ui_url).port);
    report.ports.push(port);
    await session.port(port);
    return context;
  }
  try {
    if (args.includes('--docker')) {
      const selected = JSON.parse(execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8' }))[0];
      const host = selected.Endpoints.docker.Host;
      assert(host.startsWith('unix://'), 'container qualification requires a local Docker socket');
      const config = path.join(stateDir, 'docker'); await mkdir(config);
      execFileSync('docker', ['--config', config, 'context', 'create', 'history-acceptance', '--docker', 'host=' + host]);
      process.env.DOCKER_CONFIG = config; process.env.DOCKER_CONTEXT = 'history-acceptance';
      dockerContainer = execFileSync('docker', ['run', '-d', '--rm', '--network', 'none', '--name', path.basename(stateDir).toLowerCase(), '--label', 'redeven.acceptance=terminal-history', 'debian:bookworm-slim', 'sleep', '1800'], { encoding: 'utf8' }).trim();
      await session.defer('Remove owned history acceptance container', () => {
        if (dockerContainer) execFileSync('docker', ['--config', config, '--context', 'history-acceptance', 'rm', '-f', dockerContainer]);
      });
    }
    runtime = await startRuntime(stateDir, { processSession: session });
    const context = await openClient();
    let panel = await selectSurface(page, 'panel');
    const first = await createSession(page, panel);
    const terminal = panel.locator('[data-terminal-runtime-session="' + first.sessionID + '"]').first();
    const original = await api(first.sessionID);
    await check('save defaults affects only newly created sessions', async () => {
      const dialog = await settings(panel); await fillLimits(dialog, '600', '4');
      await dialog.getByRole('button', { name: 'Save for new sessions', exact: true }).click();
      await poll(() => api(), value => value.defaults.max_lines === 600 && value.defaults.max_bytes === 4194304, 'saved defaults');
      assert.deepEqual((await api(first.sessionID)).configured, original.configured);
      await close(dialog); const next = await createSession(page, panel);
      assert.deepEqual((await api(next.sessionID)).configured, { max_lines: 600, max_bytes: 4194304 });
      await activateSession(panel, first.sessionID);
    });
    await sendTerminalCommand(page, 'for i in $(seq 1 800); do echo HISTORY_ROW_$i; done', terminal);
    await poll(() => terminal.getByRole('scrollbar').getAttribute('aria-valuemax'), value => Number(value) > 600, 'history populated');
    await check('pointer capture, grab cursor, outside dragging and keyboard navigation', async () => {
      const bar = terminal.getByRole('scrollbar'), thumb = bar.locator('[data-floeterm-scrollbar-thumb]');
      const box = await thumb.boundingBox(), track = await bar.boundingBox();
      const canvas = await terminal.locator('[data-terminal-semantic-canvas]').boundingBox();
      assert(track.x >= canvas.x + canvas.width - 1, 'history rail must not cover terminal cells');
      assert(track.width >= 16 && box.height >= 28, 'usable thumb hit target');
      assert.equal(await thumb.evaluate(element => globalThis.getComputedStyle(element).cursor), 'grab');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      assert.equal(await bar.getAttribute('data-dragging'), 'true');
      assert.equal(await bar.evaluate(element => globalThis.getComputedStyle(element).cursor), 'grabbing');
      await page.mouse.move(track.x - 70, track.y + 1, { steps: 12 }); await page.mouse.up();
      await waitForTrace(terminal, trace => trace.history_projected && trace.history_offset === 0 && !trace.history_busy);
      assert.equal(await bar.getAttribute('data-dragging'), 'false');
      await bar.focus(); await page.keyboard.press('PageDown');
      await waitForTrace(terminal, trace => trace.history_offset > 0 && !trace.history_busy);
      await page.keyboard.press('End'); await waitForTrace(terminal, trace => !trace.history_projected);
    });
    await check('touch dragging, forced colors and reduced motion preserve navigation', async () => {
      const session = await context.newCDPSession(page);
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const bar = terminal.getByRole('scrollbar'), thumb = bar.locator('[data-floeterm-scrollbar-thumb]');
        const bounds = await thumb.boundingBox(), track = await bar.boundingBox();
        const x = Math.round(bounds.x + bounds.width / 2);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: Math.round(bounds.y + bounds.height / 2) }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(track.y + 1) }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await waitForTrace(terminal, trace => trace.history_projected && trace.history_offset === 0 && !trace.history_busy);
        await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
        const colors = await bar.evaluate(element => ({ track: globalThis.getComputedStyle(element).backgroundColor, thumb: globalThis.getComputedStyle(element.firstElementChild).backgroundColor }));
        assert.notEqual(colors.track, colors.thumb);
        await page.screenshot({ path: path.join(output, 'forced-colors.png') });
        await bar.focus(); await page.keyboard.press('End');
        await waitForTrace(terminal, trace => !trace.history_projected);
      } finally {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await session.detach();
        await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      }
    });
    await check('copy and modifiers preserve history; typing, Enter, paste and IME commit follow latest', async () => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await browse(terminal); await terminal.locator(inputSelector).focus();
      await page.keyboard.press('Shift'); await page.keyboard.press(clipboardModifier + '+c');
      assert((await runtimeTrace(terminal)).history_projected);
      await page.keyboard.insertText(' '); await waitForTrace(terminal, trace => !trace.history_projected);
      await browse(terminal); await terminal.locator(inputSelector).focus(); await page.keyboard.press('Enter');
      await waitForTrace(terminal, trace => !trace.history_projected);
      await browse(terminal); await page.evaluate(() => navigator.clipboard.writeText(' '));
      await terminal.locator(inputSelector).focus(); await page.keyboard.press(clipboardModifier + '+v'); await waitForTrace(terminal, trace => !trace.history_projected);
      await browse(terminal); await terminal.locator(inputSelector).focus();
      await terminal.locator(inputSelector).evaluate(element => element.dispatchEvent(new globalThis.CompositionEvent('compositionstart', { bubbles: true })));
      assert((await runtimeTrace(terminal)).history_projected);
      await terminal.locator(inputSelector).evaluate(element => { element.dispatchEvent(new globalThis.CompositionEvent('compositionend', { bubbles: true, data: '中' })); });
      await waitForTrace(terminal, trace => !trace.history_projected); await page.keyboard.press('Control+u');
    });
    await check('background output preserves history browsing', async () => {
      await sendTerminalCommand(page, '(sleep 1; echo HISTORY_BACKGROUND) &', terminal);
      await browse(terminal); const before = await runtimeTrace(terminal);
      await waitForTrace(terminal, trace => trace.sequence > before.sequence && trace.history_projected && !trace.history_busy);
      const bar = terminal.getByRole('scrollbar'); await bar.focus(); await page.keyboard.press('End');
      await waitForTrace(terminal, trace => !trace.history_projected);
    });
    await check('local follow preference persists across reload and permits history browsing while typing', async () => {
      let dialog = await settings(panel); await dialog.getByText('Return to latest when typing', { exact: true }).click(); assert.equal(await dialog.getByLabel('Return to latest when typing', { exact: true }).isChecked(), false); await close(dialog);
      await browse(terminal); await terminal.locator(inputSelector).focus(); await page.keyboard.insertText(' ');
      assert((await runtimeTrace(terminal)).history_projected);
      await page.reload(); panel = await selectSurface(page, 'panel'); await activateSession(panel, first.sessionID);
      dialog = await settings(panel); assert.equal(await dialog.getByLabel('Return to latest when typing', { exact: true }).isChecked(), false);
      await dialog.getByLabel('Return to latest when typing', { exact: true }).focus(); await page.keyboard.press('Space'); assert.equal(await dialog.getByLabel('Return to latest when typing', { exact: true }).isChecked(), true); await close(dialog);
    });
    await check('split-pane scrollbar activates its own session and returns input focus', async () => {
      await panel.locator('[data-floe-split-pane="' + first.sessionID + '"] button[aria-label="Split pane"]').click();
      await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
      await poll(() => panel.locator('[data-floe-split-pane]:visible').count(), count => count === 2, 'split panes');
      const bar = terminal.getByRole('scrollbar');
      await bar.focus(); await page.keyboard.press('Home');
      await waitForTrace(terminal, trace => trace.session_active && trace.history_projected && !trace.history_busy);
      const track = await bar.boundingBox(), thumb = await bar.locator('[data-floeterm-scrollbar-thumb]').boundingBox();
      await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down();
      await page.mouse.move(track.x + track.width / 2, track.y + track.height - 1, { steps: 8 }); await page.mouse.up();
      await waitForTrace(terminal, trace => !trace.history_projected);
      assert(await terminal.locator(inputSelector).evaluate(element => element === globalThis.document.activeElement));
      await page.screenshot({ path: path.join(output, 'split-history.png') });
      const other = panel.locator('[data-floe-split-pane]:visible:not([data-floe-split-pane="' + first.sessionID + '"])');
      await other.getByRole('button', { name: 'Close', exact: true }).click();
      await poll(() => panel.locator('[data-terminal-vacant-slot]:visible').count(), count => count === 1, 'closed session leaves its layout slot intact');
    });
    await check('current-session confirmation, zero retention and process/geometry preservation', async () => {
      await activateSession(panel, first.sessionID); await terminal.locator(inputSelector).focus(); await page.keyboard.press('Control+u');
      await sendTerminalCommand(page, 'HISTORY_PRESERVED=alive', terminal);
      const before = await runtimeTrace(terminal), dialog = await settings(panel);
      await fillLimits(dialog, '0', '0'); await dialog.getByRole('button', { name: 'Apply to current session', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.deepEqual((await api(first.sessionID)).configured, original.configured);
      await dialog.getByRole('button', { name: 'Apply to current session', exact: true }).click();
      await dialog.getByRole('alert').getByRole('button', { name: 'Apply to current session', exact: true }).click();
      await poll(() => api(first.sessionID), value => value.configured.max_lines === 0 && value.configured.max_bytes === 0, 'applied zero');
      await close(dialog); const after = await runtimeTrace(terminal);
      assert.equal(after.content_epoch, before.content_epoch); assert.equal(after.geometry_cols, before.geometry_cols); assert.equal(after.geometry_rows, before.geometry_rows);
      await poll(() => terminal.getByRole('scrollbar', { includeHidden: true }).getAttribute('aria-valuemax'), value => value === '0', 'zero history presentation');
      await sendTerminalCommand(page, 'test "$HISTORY_PRESERVED" = alive && echo alive > ' + stateDir + '/process-preserved', terminal);
      await poll(async () => { try { return await readFile(path.join(stateDir, 'process-preserved'), 'utf8'); } catch { return ''; } }, value => value.trim() === 'alive', 'shell state preservation');
    });
    await check('responsive dark/light settings and 200 percent layout', async () => {
      for (const [name, width, height, zoom, scheme] of [['desktop-dark',1280,900,1,'dark'], ['mobile-light',320,800,1,'light'], ['zoom-dark',1280,1000,2,'dark']]) {
        await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: scheme });
        await page.evaluate(value => { globalThis.document.documentElement.style.zoom = String(value); }, zoom);
        const dialog = await settings(panel); const section = dialog.locator('[data-terminal-history-settings]'); await section.scrollIntoViewIfNeeded();
        const dimensions = await section.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
        assert(dimensions.scroll <= dimensions.client + 1, name + ' overflow');
        await page.screenshot({ path: path.join(output, name + '.png') }); await close(dialog);
      }
      await page.evaluate(() => { globalThis.document.documentElement.style.zoom = ''; }); await page.setViewportSize({ width: 1280, height: 900 });
    });
    if (dockerContainer) await check('real container Exec inherits defaults and shares scrollbar and input-follow behavior', async () => {
      await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Containers', exact: true }).click();
      const row = page.locator('[data-container-resource-row]').filter({ hasText: path.basename(stateDir).toLowerCase() });
      await row.getByRole('button', { name: 'Exec', exact: true }).click();
      const exec = page.locator('.container-exec-terminal-surface [data-terminal-runtime-session]');
      await waitForTrace(exec, trace => trace.connected && trace.sequence > 0);
      const sessionId = await exec.getAttribute('data-terminal-runtime-session');
      assert.deepEqual((await api(sessionId)).configured, { max_lines: 600, max_bytes: 4194304 });
      await sendTerminalCommand(page, 'i=0; while [ $i -lt 900 ]; do echo CONTAINER_HISTORY_$i; i=$((i+1)); done', exec);
      await poll(() => exec.getByRole('scrollbar').getAttribute('aria-valuemax'), value => Number(value) > 0, 'container history');
      await browse(exec); await exec.locator(inputSelector).focus(); await page.keyboard.insertText(' ');
      await waitForTrace(exec, trace => !trace.history_projected);
      await page.screenshot({ path: path.join(output, 'container-exec.png') });
      await page.getByRole('button', { name: 'Close session', exact: true }).click();
      await poll(() => exec.count(), count => count === 0, 'container Exec closed');
      panel = await selectSurface(page, 'panel');
    });
    await closeClient();
    await check('Runtime cold restart restores saved defaults for new sessions', async () => {
      await restart(); await openClient(); panel = await selectSurface(page, 'workbench');
      assert.deepEqual((await api()).defaults, { max_lines: 600, max_bytes: 4194304 });
      const next = await createSession(page, panel); assert.deepEqual((await api(next.sessionID)).configured, { max_lines: 600, max_bytes: 4194304 });
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack ?? error);
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await writeFile(path.join(output, 'runtime-error.log'), runtime?.state.stderr ?? '');
    process.exitCode = 1;
  } finally {
    await closeClient(); await stopRuntime(runtime);
    if (dockerContainer) {
      execFileSync('docker', ['rm', '-f', dockerContainer]);
      assert(!execFileSync('docker', ['ps', '-aq', '--filter', 'id=' + dockerContainer], { encoding: 'utf8' }).trim());
      dockerContainer = null;
    }
    if (originalDockerConfig === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = originalDockerConfig;
    if (originalDockerContext === undefined) delete process.env.DOCKER_CONTEXT; else process.env.DOCKER_CONTEXT = originalDockerContext;
    for (const port of report.ports) await portReleased(port);
    report.cleanup = { processExited: runtime?.state.exited ?? true, portsReleased: true };
    if (report.status === 'passed') await Promise.all(['failure.png', 'runtime-error.log'].map(name => rm(path.join(output, name), { force: true })));
    await session.writeEvidence(path.join(output, 'report.json'), report);
    console.log(JSON.stringify(report));
  }

}
await session.run(run);
