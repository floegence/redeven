#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startRuntime, stopRuntime, readTLSServerSPKIHash, openEnvPage, selectSurface,
  activateSession, createSession, sendTerminalCommand, runtimeTrace, waitForTrace, verifyTopResize,
} from './checkSemanticTerminalCarrier.mjs';

const args = process.argv.slice(2);
const option = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output', '/tmp/redeven-terminal-font-carrier'));
await mkdir(output, { recursive: true });
const canvasSelector = '[data-terminal-semantic-canvas="true"]';
const candidates = ['JetBrains Mono', 'Iosevka', 'Source Code Pro', 'IBM Plex Mono', 'Cascadia Mono', 'Consolas', 'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'SF Mono', 'Menlo', 'Monaco', 'Cascadia Code', 'Fira Code', 'Fira Mono', 'Hack', 'Inconsolata', 'Roboto Mono', 'Noto Sans Mono', 'Ubuntu Sans Mono'];
const sharedFont = async (page) => page.locator('[data-terminal-panel-variant="workbench"]').last().evaluate((element) => ({
  requested: element.dataset.terminalFontRequested,
  effective: element.dataset.terminalFontEffective,
}));

async function freePort(host) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, host, resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function openClient(browser, config, dpr = 1, blockBundledFont = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: dpr, locale: 'en-US' });
  await context.addInitScript(() => {
    globalThis.__terminalFontLoads = [];
    const load = globalThis.FontFace.prototype.load;
    globalThis.FontFace.prototype.load = function () {
      const entry = { family: this.family, started: performance.now(), status: 'loading' };
      globalThis.__terminalFontLoads.push(entry);
      return load.call(this).then((face) => { entry.status = face.status; entry.duration = performance.now() - entry.started; return face; }, (error) => { entry.status = 'failed'; entry.error = String(error); throw error; });
    };
  });
  if (blockBundledFont) await context.route('**/jetbrains-mono-*.woff2', (route) => route.abort());
  const { page, problems } = await openEnvPage(context, config.url);
  const password = page.locator('input[type="password"]');
  await password.waitFor({ state: 'visible', timeout: 15000 });
  await password.fill(config.password);
  await password.press('Enter');
  let panel;
  try {
    panel = await selectSurface(page, 'panel');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'open-failure.png') });
    await writeFile(path.join(output, 'open-failure.txt'), await page.locator('body').innerText());
    await writeFile(path.join(output, 'open-failure.json'), JSON.stringify({ requests: problems.requests, responses: problems.responses, errors: problems.page, console: problems.console.map((entry) => entry.text.replace(/([?&](?:token|ticket|secret|password)=)[^&\s]+/gi, '$1[redacted]')) }, null, 2));
    throw error;
  }
  return { context, page, panel, problems };
}

async function settings(page, panel) {
  await panel.getByTitle('More options', { exact: true }).click();
  await page.getByText('Terminal settings', { exact: true }).last().click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('button', { name: /^JetBrains Mono/ }).waitFor();
  await page.waitForFunction(() => [...globalThis.document.fonts].some((face) => face.status === 'loaded' && face.family.includes('Redeven Terminal jetbrains')));
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-terminal-font-group][aria-busy="true"]'));
  return dialog;
}

async function chooseFont(page, panel, label) {
  const dialog = await settings(page, panel);
  const button = dialog.getByRole('button', { name: new RegExp(`^${label}`) });
  await button.click();
  await dialog.getByRole('button', { name: new RegExp(`^${label}`), pressed: true }).waitFor();
  const family = await dialog.locator('pre[aria-label]').evaluate((element) => globalThis.getComputedStyle(element).fontFamily);
  await page.keyboard.press('Escape');
  return family;
}

async function verifyFontInteraction(page, panel, config) {
  const snapshot = async () => {
    const response = await fetch(`${config.coordinator}/snapshot`, { headers: { Authorization: `Bearer ${config.password}` } });
    if (!response.ok) throw new Error('Shared-session snapshot failed');
    return response.json();
  };
  const shared = await activateSession(panel, config.sessionID);
  const sharedTrace = await runtimeTrace(shared);
  const restored = await fetch(`${config.coordinator}/activate?epoch=${sharedTrace.controller_epoch}`, { headers: { Authorization: `Bearer ${config.password}` } });
  if (!restored.ok) throw new Error('Shared-session controller handoff failed');
  await waitForTrace(shared, (trace) => !trace.is_controller);
  const before = await snapshot();
  const independent = await createSession(page, panel);
  if (independent.sessionID === config.sessionID) throw new Error('New session reused the shared session');
  await chooseFont(page, panel, 'Iosevka');
  await waitForTrace(independent.runtime, (trace) => trace.is_controller && trace.geometry_cols === trace.measured_cols && trace.geometry_rows === trace.measured_rows);
  const topResizeMs = await verifyTopResize(page, independent.runtime, 2000);
  const after = await snapshot();
  if (after.controller_epoch !== before.controller_epoch || after.geometry_cols !== before.geometry_cols || after.geometry_rows !== before.geometry_rows) {
    throw new Error(`Independent session changed the existing shared session: ${JSON.stringify({ before, after })}`);
  }
  return { before, after, independent: await runtimeTrace(independent.runtime), topResizeMs };
}

const configPath = option('--config', path.join(output, 'client-config.json'));
const directEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directEntry && args.includes('--serve')) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'redeven-font-runtime-'));
  const password = randomBytes(24).toString('hex');
  process.env.REDEVEN_LOCAL_UI_PASSWORD = password;
  let runtime;
  let browser;
  try {
    const address = option('--host', '127.0.0.1');
    const port = await freePort(address);
    runtime = await startRuntime(stateDir, { bind: `${address}:${port}` });
    const spki = await readTLSServerSPKIHash(`https://${address}:${port}`);
    const config = { url: `https://${address}:${port}/_redeven_proxy/env/`, password, spki, coordinator: '', sharedFontLabel: option('--shared-font', 'JetBrains Mono') };
    browser = await chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    const host = await openClient(browser, config);
    const workbench = await selectSurface(host.page, 'workbench');
    const { sessionID } = await createSession(host.page, workbench);
    await selectSurface(host.page, 'panel');
    const terminal = await activateSession(host.panel, sessionID);
    config.sessionID = sessionID;
    await chooseFont(host.page, host.panel, 'JetBrains Mono');
    await sendTerminalCommand(host.page, "printf '0O 1lI [] {} | wide: 中文 | combining: é | emoji: 😀\\n'; printf '%120s\\n' long-line", terminal);
    await waitForTrace(terminal, (trace) => trace.is_controller && trace.sequence > 1);
    await selectSurface(host.page, 'workbench');
    await activateSession(workbench, sessionID);
    await chooseFont(host.page, workbench, config.sharedFontLabel);
    config.sharedFontID = (await sharedFont(host.page)).requested;
    await selectSurface(host.page, 'panel');
    await activateSession(host.panel, sessionID);
    let controllerTerminal = terminal;
    const server = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${password}`) { res.writeHead(403).end(); return; }
      try {
        const request = new URL(req.url, config.coordinator);
        if (request.pathname === '/activate' || request.pathname === '/activate-shared') {
          await waitForTrace(controllerTerminal, (trace) => trace.controller_epoch >= Number(request.searchParams.get('epoch') ?? 0));
          const panel = await selectSurface(host.page, request.pathname === '/activate-shared' ? 'workbench' : 'panel');
          controllerTerminal = await activateSession(panel, sessionID);
          if (request.pathname === '/activate-shared' && request.searchParams.has('restore')) {
            await chooseFont(host.page, panel, config.sharedFontLabel);
            await waitForTrace(controllerTerminal, (trace) => trace.is_controller && trace.geometry_cols === trace.measured_cols && trace.geometry_rows === trace.measured_rows);
          }
        } else if (request.pathname === '/change-shared-font') {
          const label = request.searchParams.get('label');
          if (!candidates.includes(label)) throw new Error('Unknown test font');
          await chooseFont(host.page, host.page.locator('[data-terminal-panel-variant="workbench"]:visible').last(), label);
        } else if (request.pathname !== '/snapshot') { res.writeHead(404).end(); return; }
        if (request.searchParams.has('font')) {
          await host.page.waitForFunction((id) => globalThis.document.querySelector('[data-terminal-panel-variant="workbench"]')?.getAttribute('data-terminal-font-requested') === id, request.searchParams.get('font'));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...await runtimeTrace(controllerTerminal), sharedFont: await sharedFont(host.page) }));
      } catch (error) { res.writeHead(500).end(String(error)); }
    });
    await new Promise((resolve) => server.listen(0, address, resolve));
    config.coordinator = `http://${address}:${server.address().port}`;
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    await writeFile(path.join(output, 'runtime.json'), JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), pid: runtime.child.pid, stateDir, port, sessionID, platform: process.platform, browser: browser.version() }, null, 2));
    await host.page.screenshot({ path: path.join(output, 'mac-controller.png') });
    console.log('Task font Runtime ready; private client configuration written.');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    server.close();
  } finally {
    await browser?.close();
    await stopRuntime(runtime);
    delete process.env.REDEVEN_LOCAL_UI_PASSWORD;
  }
} else if (directEntry) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const browser = await chromium.launch({ headless: true, ...(option('--executable') ? { executablePath: option('--executable') } : {}), args: [`--ignore-certificate-errors-spki-list=${config.spki}`, '--no-sandbox'] });
  const report = { platform: process.platform, arch: process.arch, os: os.release(), node: process.version, browser: browser.version(), sessionID: config.sessionID, cases: [], shared: [], fontLoads: [] };
  const coordinator = async (action) => {
    const result = await fetch(`${config.coordinator}/${action}`, { headers: { Authorization: `Bearer ${config.password}` } });
    if (!result.ok) throw new Error(`Coordinator failed: ${result.status}`);
    return result.json();
  };
  try {
    if (args.includes('--observe')) {
      const observer = await openClient(browser, config);
      const terminal = await activateSession(observer.panel, config.sessionID);
      const initial = await runtimeTrace(terminal);
      await coordinator(`activate?epoch=${initial.controller_epoch}`);
      await waitForTrace(terminal, (trace) => !trace.is_controller);
      report.observer = { ready: true, samples: [] };
      await writeFile(path.join(output, 'observer-ready.json'), JSON.stringify({ platform: process.platform, sessionID: config.sessionID }));
      const deadline = Date.now() + Number(option('--duration', '90000'));
      while (Date.now() < deadline) {
        const trace = await runtimeTrace(terminal);
        if (trace.is_controller || trace.semantic_error) throw new Error('Passive observer acquired control or failed');
        report.observer.samples.push({ sequence: trace.sequence, epoch: trace.controller_epoch, cols: trace.geometry_cols, rows: trace.geometry_rows });
        await observer.page.waitForTimeout(1000);
      }
      await observer.page.screenshot({ path: path.join(output, `${process.platform}-three-client-observer.png`) });
      await observer.context.close();
    } else if (args.includes('--interaction-only')) {
      const client = await openClient(browser, config);
      report.interaction = await verifyFontInteraction(client.page, client.panel, config);
      await client.page.screenshot({ path: path.join(output, `${process.platform}-independent-session.png`) });
      await client.context.close();
    } else {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        const client = await openClient(browser, config, dpr);
        const terminal = await activateSession(client.panel, config.sessionID);
        const dialog = await settings(client.page, client.panel);
        const available = [];
        for (const label of candidates) {
          const button = dialog.getByRole('button', { name: new RegExp(`^${label}`) });
          if (await button.count() && await button.isEnabled()) available.push(label);
        }
        report.fontLoads.push({ dpr, available, problems: client.problems, faces: await client.page.evaluate(() => globalThis.__terminalFontLoads), resources: await client.page.evaluate(() => globalThis.performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.woff2')).map((entry) => ({ path: new URL(entry.name).pathname, duration: entry.duration, bytes: entry.decodedBodySize }))) });
        if (!['JetBrains Mono', 'Iosevka', 'Source Code Pro', 'IBM Plex Mono'].every((label) => available.includes(label))) throw new Error(`Bundled font load failed at DPR ${dpr}`);
        const search = dialog.getByRole('searchbox', { name: 'Search available fonts...' });
        if (available.length > 8) {
          await search.fill('  pLeX  ');
          const matches = dialog.locator('[data-terminal-font-group] button[aria-pressed]');
          if (await matches.count() !== 1 || !(await matches.innerText()).includes('IBM Plex Mono')) throw new Error('Font search did not filter available families');
          await search.fill('no-such-font');
          await dialog.getByText('No available fonts match your search.', { exact: true }).waitFor();
          await search.fill('');
        } else if (await search.count()) throw new Error('Small font catalog unexpectedly requires search');
        if (dpr === 1) {
          await dialog.locator('[data-terminal-font-group="bundled"]').scrollIntoViewIfNeeded();
          await client.page.screenshot({ path: path.join(output, `${process.platform}-font-menu.png`) });
        }
        await client.page.keyboard.press('Escape');
        for (const label of available) {
          const epoch = (await runtimeTrace(terminal)).controller_epoch;
          const before = await coordinator(`activate?epoch=${epoch}`);
          await waitForTrace(terminal, (trace) => !trace.is_controller && trace.controller_epoch === before.controller_epoch);
          const family = await chooseFont(client.page, client.panel, label);
          await client.page.setViewportSize({ width: 1000, height: 760 });
          await client.page.waitForTimeout(150);
          const after = await coordinator('snapshot');
          const local = await runtimeTrace(terminal);
          if (after.controller_epoch !== before.controller_epoch || after.geometry_cols !== before.geometry_cols || after.geometry_rows !== before.geometry_rows || local.is_controller) {
            throw new Error(`Observer changed shared geometry or ownership: ${JSON.stringify({ label, dpr, before, after, local })}`);
          }
          const metrics = await terminal.locator(canvasSelector).evaluate((canvas) => ({ width: canvas.dataset.terminalCellWidth, height: canvas.dataset.terminalCellHeight, backing: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight], dpr: globalThis.devicePixelRatio }));
          report.cases.push({ dpr, label, family, available, before, after, local, metrics });
          await client.page.screenshot({ path: path.join(output, `${process.platform}-${dpr}-${label.replaceAll(' ', '-')}.png`) });
        }
        await activateSession(client.panel, config.sessionID);
        const active = await runtimeTrace(terminal);
        if (!active.is_controller) throw new Error('Explicit activation failed');
        await coordinator(`activate?epoch=${active.controller_epoch}`);
        const workbench = await selectSurface(client.page, 'workbench');
        const sharedTerminal = await activateSession(workbench, config.sessionID);
        const initialShared = await sharedFont(client.page);
        const expectedEffective = available.includes(config.sharedFontLabel) ? config.sharedFontID : 'jetbrains';
        if (initialShared.requested !== config.sharedFontID || initialShared.effective !== expectedEffective) {
          throw new Error(`Shared font resolution mismatch: ${JSON.stringify({ initialShared, expectedEffective })}`);
        }
        const sharedEpoch = (await runtimeTrace(sharedTerminal)).controller_epoch;
        await coordinator(`activate-shared?epoch=${sharedEpoch}`);
        await activateSession(workbench, config.sessionID);
        const activeFontChanges = [];
        for (const label of ['Iosevka', 'Source Code Pro', 'IBM Plex Mono', 'JetBrains Mono']) {
          await chooseFont(client.page, workbench, label);
          const trace = await waitForTrace(sharedTerminal, (value) => value.is_controller && value.geometry_cols === value.measured_cols && value.geometry_rows === value.measured_rows);
          activeFontChanges.push({ label, trace });
        }
        const beforeRemoteChoice = await runtimeTrace(sharedTerminal);
        await coordinator('change-shared-font?label=Iosevka');
        await client.page.waitForFunction(() => globalThis.document.querySelector('[data-terminal-panel-variant="workbench"]')?.getAttribute('data-terminal-font-requested') === 'iosevka');
        await client.page.waitForTimeout(150);
        const afterRemoteChoice = await runtimeTrace(sharedTerminal);
        if (afterRemoteChoice.controller_epoch !== beforeRemoteChoice.controller_epoch || afterRemoteChoice.geometry_cols !== beforeRemoteChoice.geometry_cols || afterRemoteChoice.geometry_rows !== beforeRemoteChoice.geometry_rows) {
          throw new Error(`Remote shared font changed local controller geometry: ${JSON.stringify({ beforeRemoteChoice, afterRemoteChoice })}`);
        }
        const beforeShared = await coordinator(`activate-shared?epoch=${afterRemoteChoice.controller_epoch}&restore=1`);
        await waitForTrace(sharedTerminal, (trace) => !trace.is_controller && trace.controller_epoch === beforeShared.controller_epoch);
        await chooseFont(client.page, workbench, 'Iosevka');
        const afterShared = await coordinator('snapshot?font=iosevka');
        if (afterShared.controller_epoch !== beforeShared.controller_epoch || afterShared.geometry_cols !== beforeShared.geometry_cols || afterShared.geometry_rows !== beforeShared.geometry_rows) {
          throw new Error(`Shared observer font changed controller geometry: ${JSON.stringify({ beforeShared, afterShared })}`);
        }
        report.shared.push({ dpr, initialShared, activeFontChanges, beforeRemoteChoice, afterRemoteChoice, before: beforeShared, after: afterShared });
        await client.page.screenshot({ path: path.join(output, `${process.platform}-${dpr}-shared-font.png`) });
        // Restore through the controller because the requested system font may be unavailable on this client.
        await coordinator(`activate-shared?epoch=${afterShared.controller_epoch}&restore=1`);
        await coordinator(`activate?epoch=${afterShared.controller_epoch}`);
        await client.context.close();
      }
      const departing = await openClient(browser, config);
      const departingTerminal = await activateSession(departing.panel, config.sessionID);
      const departingTrace = await runtimeTrace(departingTerminal);
      await departing.context.close();
      const replacement = await openClient(browser, config);
      const replacementTerminal = await activateSession(replacement.panel, config.sessionID);
      const replacementTrace = await runtimeTrace(replacementTerminal);
      const recovered = await coordinator(`activate?epoch=${replacementTrace.controller_epoch}`);
      if (replacementTrace.controller_epoch <= departingTrace.controller_epoch || recovered.controller_epoch <= replacementTrace.controller_epoch) {
        throw new Error('Controller replacement did not preserve monotonic epochs and observer activation');
      }
      report.replacement = { departing: departingTrace, replacement: replacementTrace, recovered };
      await replacement.context.close();
      const failure = await openClient(browser, config, 1, true);
      const failureTerminal = await activateSession(failure.panel, config.sessionID);
      await failure.panel.locator('[data-terminal-font-status="failed"]').waitFor();
      const failedFont = await failure.panel.getAttribute('data-terminal-font-effective');
      if (failedFont !== 'monospace') throw new Error('Blocked font did not use emergency monospace');
      const failureEpoch = (await runtimeTrace(failureTerminal)).controller_epoch;
      const beforeRetry = await coordinator(`activate?epoch=${failureEpoch}`);
      await failure.context.unroute('**/jetbrains-mono-*.woff2');
      await failure.panel.locator('[data-terminal-font-status="failed"]').getByRole('button').click();
      await failure.page.waitForFunction(() => globalThis.document.querySelector('[data-terminal-panel-variant="panel"]')?.getAttribute('data-terminal-font-effective') === 'jetbrains');
      const afterRetry = await coordinator('snapshot');
      if (afterRetry.controller_epoch !== beforeRetry.controller_epoch || afterRetry.geometry_cols !== beforeRetry.geometry_cols || afterRetry.geometry_rows !== beforeRetry.geometry_rows) {
        throw new Error('Observer font retry changed shared geometry');
      }
      report.failureRecovery = { failedFont, before: beforeRetry, after: afterRetry, local: await runtimeTrace(failureTerminal) };
      await failure.page.screenshot({ path: path.join(output, `${process.platform}-font-retry.png`) });
      await failure.context.close();
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack ?? String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, 'font-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}

export { chooseFont, settings, verifyFontInteraction };
