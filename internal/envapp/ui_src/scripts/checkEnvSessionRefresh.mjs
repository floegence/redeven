#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { installReDevPluginRuntimeFixture } from './redevpluginRuntimeFixture.mjs';
import { selectSurface, createSession, sendTerminalCommand, runtimeTrace } from './checkSemanticTerminalCarrier.mjs';

const root = path.resolve(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const binary = option('--binary');
const reportPath = option('--report');
if (!binary || !reportPath) throw new Error('Required: --binary <runtime> --report <output.json>');
const temp = await mkdtemp(path.join(os.homedir(), '.redeven-session-refresh-'));
const marker = randomUUID();
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  marker, state: temp, tabs: 8, refreshes: [], nativeEvents: [], sessionConnections: 0,
};
let runtime;
let browser;
let output = '';
let expectedExit = false;
const netlog = `${reportPath}.netlog.json`;
async function until(read, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (runtime && (runtime.exitCode !== null || runtime.signalCode !== null)) throw new Error(`Owned runtime exited: ${output}`);
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error('Owned runtime readiness timed out');
}
async function openNotes(page) {
  await page.getByRole('button', { name: 'Notes overlay', exact: true }).click();
  await page.getByRole('button', { name: 'Close notes overlay', exact: true }).waitFor();
}
async function createTopic(page, name) {
  const status = await page.evaluate(async (name) => (await fetch('/_redeven_proxy/api/notes/topics', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })).status, name);
  assert.equal(status, 200);
}
try {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  const executable = path.join(temp, 'redeven');
  await copyFile(path.resolve(binary), executable);
  await installReDevPluginRuntimeFixture(temp);
  const startupPath = path.join(temp, 'startup.json');
  runtime = spawn(executable, ['run', '--mode', 'desktop', '--state-root', path.join(temp, 'state'), '--local-ui-bind', '127.0.0.1:0', '--local-ui-protocol', 'http', '--presentation', 'machine', '--startup-report-file', startupPath], {
    cwd: temp, detached: true, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runtime.stdout.on('data', (bytes) => { output += bytes; });
  runtime.stderr.on('data', (bytes) => { output += bytes; });
  const startup = await until(async () => {
    try { const value = JSON.parse(await readFile(startupPath, 'utf8')); return value.status === 'ready' ? value : null; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  });
  report.runtime = { pid: runtime.pid, url: startup.local_ui_url };
  browser = await chromium.launch({ channel: 'chromium', headless: true, args: [`--log-net-log=${netlog}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' });
  const pages = [];
  for (let index = 0; index < report.tabs; index += 1) {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('request', (request) => {
      if (/\/(events|stream)(?:\?|$)/u.test(request.url())) report.nativeEvents.push(request.url());
    });
    page.on('websocket', () => { report.sessionConnections += 1; });
    await page.goto(startup.local_ui_url);
    await openNotes(page);
    pages.push(page);
  }
  await createTopic(pages[0], 'Initial shared event');
  await Promise.all(pages.map((page) => page.getByText('Initial shared event', { exact: true }).waitFor()));
  report.initialSharedObservation = 'received by all eight documents';
  assert.equal(report.sessionConnections, 8);
  for (let index = 0; index < 20; index += 1) {
    const page = pages[index % pages.length];
    const started = performance.now();
    const response = await page.reload({ waitUntil: 'commit', timeout: 2000 });
    const responseMs = performance.now() - started;
    assert.equal(response?.status(), 200);
    await openNotes(page);
    const name = `Refresh event ${index + 1}`;
    await createTopic(pages[(index + 1) % pages.length], name);
    await Promise.all(pages.map((observer) => observer.getByText(name, { exact: true }).waitFor()));
    const interactiveMs = performance.now() - started;
    report.refreshes.push({ index: index + 1, responseMs, interactiveMs });
    assert.ok(responseMs < 2000, `homepage response took ${responseMs}ms`);
    assert.ok(interactiveMs < 5000, `application recovery took ${interactiveMs}ms`);
  }
  const terminalPage = pages[0];
  await terminalPage.getByRole('button', { name: 'Close notes overlay', exact: true }).click();
  const terminalPanel = await selectSurface(terminalPage, 'activity');
  const { runtime: terminalRuntime } = await createSession(terminalPage, terminalPanel);
  const beforeOutput = await runtimeTrace(terminalRuntime);
  const terminalMarker = path.join(temp, 'terminal-io.txt');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  await sendTerminalCommand(terminalPage, `printf '%s\\n' ${quote(marker)}; printf '%s' ${quote(marker)} > ${quote(terminalMarker)}`, terminalRuntime);
  await until(async () => { try { return await readFile(terminalMarker, 'utf8') === marker; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } });
  const afterOutput = await until(async () => { const value = await runtimeTrace(terminalRuntime); return value.sequence > beforeOutput.sequence && value.content_epoch > beforeOutput.content_epoch ? value : null; });
  report.terminal = { input: 'executed by real shell', output: 'new presentation received', sequence: afterOutput.sequence };
  assert.equal(report.sessionConnections, 28, 'each document generation uses one session');
  assert.deepEqual(report.nativeEvents, [], 'all built-in observations use the session');
  await browser.close(); browser = undefined;
  const log = JSON.parse(await readFile(netlog, 'utf8'));
  const stall = log.constants.logEventTypes.SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP;
  report.socketPoolStalls = log.events.filter((event) => event.type === stall).length;
  assert.equal(report.socketPoolStalls, 0);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  throw error;
} finally {
  await browser?.close();
  if (runtime) {
    if (runtime.exitCode !== null || runtime.signalCode !== null) {
      report.runtimeExit = { code: runtime.exitCode, signal: runtime.signalCode };
      if (!expectedExit) { report.status = 'failed'; process.exitCode = 1; }
    } else {
      expectedExit = true;
      const exited = new Promise((resolve) => runtime.once('exit', resolve));
      process.kill(-runtime.pid, 'SIGTERM');
      const timeout = new AbortController();
      try { await Promise.race([exited, delay(10000, undefined, { signal: timeout.signal }).then(() => { throw new Error('Owned runtime did not stop'); })]); }
      finally { timeout.abort(); }
    }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'passed') await rm(temp, { recursive: true, force: true });
}
