#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const defaultFixtureBytes = 64 * 1024;
const terminalHistoryMaxBytes = 8 * 1024 * 1024;
const terminalReadChunkBytes = 4 * 1024;
const visualGridColumns = 32;
const visualGridRows = 18;

function fixtureID(fixtureBytes) {
  if (fixtureBytes === 0) return '0B';
  if (fixtureBytes === 64 * 1024) return '64KiB';
  if (fixtureBytes === 448 * 1024) return '448KiB';
  if (fixtureBytes === 7 * 1024 * 1024) return '7MiB';
  if (fixtureBytes === 8 * 1024 * 1024) return '8MiB-boundary';
  return `${fixtureBytes}B`;
}

function minimumRetainedBytesForFixture(fixtureBytes) {
  if (fixtureBytes >= terminalHistoryMaxBytes) return terminalHistoryMaxBytes - terminalReadChunkBytes;
  return fixtureBytes;
}

function readOption(args, name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = String(args[index + 1] ?? '').trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function parsePositiveInteger(value, name, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function analyzeCanvasImage(imageBuffer) {
  const image = PNG.sync.read(imageBuffer);
  const pixelCount = image.width * image.height;
  const colorKeys = new Uint16Array(pixelCount);
  const colorCounts = new Map();
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const key = ((image.data[offset] >> 4) << 8)
      | ((image.data[offset + 1] >> 4) << 4)
      | (image.data[offset + 2] >> 4);
    colorKeys[pixel] = key;
    colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
  }
  let backgroundKey = 0;
  let backgroundPixels = 0;
  for (const [key, count] of colorCounts) {
    if (count > backgroundPixels) {
      backgroundKey = key;
      backgroundPixels = count;
    }
  }

  const cellInk = new Uint32Array(visualGridColumns * visualGridRows);
  const cellPixels = new Uint32Array(cellInk.length);
  for (let y = 0; y < image.height; y += 1) {
    const cellY = Math.min(visualGridRows - 1, Math.floor(y * visualGridRows / image.height));
    for (let x = 0; x < image.width; x += 1) {
      const cellX = Math.min(visualGridColumns - 1, Math.floor(x * visualGridColumns / image.width));
      const cell = cellY * visualGridColumns + cellX;
      const pixel = y * image.width + x;
      cellPixels[cell] += 1;
      if (colorKeys[pixel] !== backgroundKey) cellInk[cell] += 1;
    }
  }

  return {
    width: image.width,
    height: image.height,
    inkRatio: pixelCount === 0 ? 0 : (pixelCount - backgroundPixels) / pixelCount,
    grid: Array.from(cellInk, (count, index) => cellPixels[index] === 0 ? 0 : count / cellPixels[index]),
  };
}

function assertRecoveredHistoryVisual(seedVisual, recoveredVisual) {
  const meanGridDelta = recoveredVisual.grid.reduce((total, value, index) => (
    total + Math.abs(value - seedVisual.grid[index])
  ), 0) / recoveredVisual.grid.length;
  if (seedVisual.inkRatio < 0.005) throw new Error('seeded terminal history did not produce meaningful canvas content');
  // Whole-canvas ink ratios vary with surface geometry; the normalized grid is
  // the cross-surface content comparison, while ink still proves nonblank output.
  if (recoveredVisual.inkRatio < 0.005 || meanGridDelta > 0.15) {
    throw new Error(`recovered terminal canvas does not match the seeded history (seed_ink=${seedVisual.inkRatio.toFixed(4)} recovered_ink=${recoveredVisual.inkRatio.toFixed(4)} grid_delta=${meanGridDelta.toFixed(4)})`);
  }
  return { meanGridDelta, recoveredInkRatio: recoveredVisual.inkRatio };
}

class TerminalCarrierStageError extends Error {
  constructor(stage, cause) {
    super(`terminal carrier stage failed: ${stage}`, { cause });
    this.name = 'TerminalCarrierStageError';
    this.stage = stage;
  }
}

async function runStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TerminalCarrierStageError) throw error;
    throw new TerminalCarrierStageError(stage, error);
  }
}

function formatErrorWithCauses(error) {
  const parts = [];
  let current = error;
  while (current instanceof Error) {
    parts.push(current.stack ?? current.message);
    current = current.cause;
  }
  return parts.join('\nCaused by:\n');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) return;
    } catch {
      // Keep polling until the terminal command creates the marker.
    }
    await delay(50);
  }
  throw new Error('terminal input probe did not create its completion marker');
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) {
    throw new Error(`${command} failed with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'none'}\n${stdout}\n${stderr}`);
  }
  return { stdout, stderr };
}

async function waitForStartupReport(reportPath, childState, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childState.exited) {
      throw new Error([
        `Runtime exited before readiness with code ${childState.code ?? 'null'} signal ${childState.signal ?? 'none'}`,
        childState.stdout,
        childState.stderr,
      ].filter(Boolean).join('\n'));
    }
    try {
      const parsed = JSON.parse(await readFile(reportPath, 'utf8'));
      if (parsed?.status === 'ready' && typeof parsed.local_ui_url === 'string') return parsed;
      if (parsed?.status === 'blocked' || parsed?.status === 'failed') {
        throw new Error(`Runtime startup report status is ${parsed.status}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError || error?.code === 'ENOENT') {
        await delay(50);
        continue;
      }
      throw error;
    }
    await delay(50);
  }
  throw new Error('Runtime startup report timed out');
}

async function stopRuntime(runtime) {
  if (!runtime || runtime.state.exited) return;
  runtime.child.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (!runtime.state.exited && Date.now() < deadline) await delay(50);
  if (!runtime.state.exited) {
    runtime.child.kill('SIGKILL');
    while (!runtime.state.exited && Date.now() < deadline + 5_000) await delay(50);
  }
}

async function startRuntime(tempDir) {
  const binaryPath = path.join(tempDir, 'redeven');
  await runCommand('go', ['build', '-o', binaryPath, './cmd/redeven'], {
    env: { ...process.env, GOWORK: 'off' },
  });
  const homeDir = path.join(tempDir, 'home');
  const stateRoot = path.join(tempDir, 'state');
  const startupReportPath = path.join(tempDir, 'startup.json');
  await mkdir(homeDir, { recursive: true });

  const child = spawn(binaryPath, [
    'run',
    '--mode', 'local',
    '--state-root', stateRoot,
    '--local-ui-bind', '127.0.0.1:0',
    '--presentation', 'machine',
    '--startup-report-file', startupReportPath,
  ], {
    cwd: repoRoot,
    env: { ...process.env, HOME: homeDir, GOWORK: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { exited: false, code: null, signal: null, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { state.stdout += String(chunk).slice(-32_768); });
  child.stderr.on('data', (chunk) => { state.stderr += String(chunk).slice(-32_768); });
  child.once('exit', (code, signal) => {
    state.exited = true;
    state.code = code;
    state.signal = signal;
  });
  child.once('error', (error) => {
    state.stderr += error.message;
  });

  const runtime = { child, state, startup: null };
  try {
    runtime.startup = await waitForStartupReport(startupReportPath, state);
    return runtime;
  } catch (error) {
    await stopRuntime(runtime);
    throw error;
  }
}

function observePage(page) {
  const problems = { console: [], page: [], requests: [], responses: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.console.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => problems.page.push(error.message));
  page.on('requestfailed', (request) => {
    const requestURL = new URL(request.url());
    problems.requests.push({ path: requestURL.pathname, error: request.failure()?.errorText ?? 'request failed' });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const responseURL = new URL(response.url());
    problems.responses.push({ path: responseURL.pathname, status: response.status() });
  });
  return problems;
}

function assertPageHealthy(problems) {
  if (problems.console.length > 0) throw new Error(`renderer console problems: ${JSON.stringify(problems.console)}`);
  if (problems.page.length > 0) throw new Error(`renderer page errors: ${JSON.stringify(problems.page)}`);
  if (problems.requests.length > 0) throw new Error(`renderer request failures: ${JSON.stringify(problems.requests)}`);
  if (problems.responses.length > 0) throw new Error(`renderer HTTP failures: ${JSON.stringify(problems.responses)}`);
}

async function openEnvPage(context, entryURL) {
  const page = await context.newPage();
  const problems = observePage(page);
  await page.goto(entryURL, { waitUntil: 'load', timeout: 30_000 });
  await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 15_000 });
  if (await page.title() !== 'Redeven Env App') throw new Error('unexpected Env App title');
  return { page, problems };
}

async function terminalInput(scope) {
  const input = scope.locator('.redeven-terminal-surface textarea[aria-label="Terminal input"]:visible').last();
  await input.waitFor({ state: 'attached', timeout: 15_000 });
  return input;
}

async function sendTerminalCommand(page, command, scope = page) {
  const input = await terminalInput(scope);
  await input.focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

async function waitForCanvasChange(canvas, beforeHash, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const afterHash = sha256(await canvas.screenshot());
      if (afterHash !== beforeHash) return afterHash;
    } catch {
      // Clear/recovery can atomically replace the current canvas; retry the live locator.
    }
    await delay(75);
  }
  throw new Error('terminal canvas did not change after the input probe');
}

async function captureCanvasHash(canvas, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return sha256(await canvas.screenshot());
    } catch {
      await delay(75);
    }
  }
  throw new Error('terminal canvas did not become stable for screenshot evidence');
}

async function captureCanvasVisualEvidence(canvas) {
  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    samples.push(analyzeCanvasImage(await canvas.screenshot()));
    if (index < 2) await delay(75);
  }
  return samples.sort((left, right) => left.inkRatio - right.inkRatio)[1];
}

async function readHistoryBytes(scope) {
  const value = await scope.locator('[data-terminal-history-bytes]').last().getAttribute('data-terminal-history-bytes');
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function waitForHistoryBytes(scope, minimumBytes, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const historyBytes = await readHistoryBytes(scope).catch(() => null);
    if (historyBytes !== null && historyBytes >= minimumBytes && historyBytes <= terminalHistoryMaxBytes) {
      return historyBytes;
    }
    await delay(50);
  }
  throw new Error('terminal history stats did not reach the requested retained-byte fixture');
}

async function seedRetainedSession(page, tempDir, fixtureBytes) {
  const createButton = page.getByRole('button', { name: 'Create session', exact: true });
  if (await createButton.count()) {
    await createButton.click();
  } else {
    await page.locator('[data-testid="terminal-sidebar-add-session"]:visible').first().click();
  }
  await terminalInput(page);
  const clearButton = page.locator('button[title="Clear"]:visible').last();
  await clearButton.waitFor({ state: 'visible', timeout: 10_000 });
  await clearButton.click();
  await terminalInput(page);
  await delay(300);

  const activeSession = page.locator('button[data-terminal-session-active="true"]:visible').first();
  const sessionID = await activeSession.getAttribute('data-terminal-session-id');
  if (!sessionID) throw new Error('active terminal session did not expose its renderer identity');
  const targetPanel = page.locator('[data-terminal-panel-variant]:visible').last();

  if (fixtureBytes === 0) {
    const historyBytes = await waitForHistoryBytes(targetPanel, 0);
    const historyLabel = await targetPanel.locator('text=/^History:/').last().textContent().catch(() => '');
    return { sessionID, historyBytes, historyLabel: String(historyLabel ?? '').trim(), historyVisual: null };
  }

  const markerPath = path.join(tempDir, 'fixture-seeded');
  const canvas = targetPanel.locator('.redeven-terminal-surface canvas:visible').last();
  await canvas.waitFor({ state: 'visible', timeout: 10_000 });
  const beforeHash = await captureCanvasHash(canvas);
  const line = 'redeven-packaged-terminal-history-0123456789abcdefghijklmnopqrstuvwxyz';
  const command = fixtureBytes > 0
    ? `yes ${shellQuote(line)} | head -c ${fixtureBytes}; printf '\\n'; export PS1=''; stty -echo; printf seeded > ${shellQuote(markerPath)}`
    : `printf seeded > ${shellQuote(markerPath)}`;
  await sendTerminalCommand(page, command, targetPanel);
  await waitForFile(markerPath, 30_000);
  await waitForCanvasChange(canvas, beforeHash, 30_000);
  const historyBytes = await waitForHistoryBytes(targetPanel, minimumRetainedBytesForFixture(fixtureBytes));
  const historyVisual = await captureCanvasVisualEvidence(canvas);
  const historyLabel = await targetPanel.locator('text=/^History:/').last().textContent().catch(() => '');
  return { sessionID, historyBytes, historyLabel: String(historyLabel ?? '').trim(), historyVisual };
}

async function selectSurface(page, surface) {
  await page.locator('button[data-terminal-session-id]').first().waitFor({ state: 'attached', timeout: 20_000 });
  if (surface === 'workbench') {
    const workbenchPanel = page.locator('[data-terminal-panel-variant="workbench"]:visible');
    if (await workbenchPanel.count()) return 0;
    const notBefore = await page.evaluate(() => performance.now());
    await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await workbenchPanel.waitFor({ state: 'visible', timeout: 15_000 });
    return notBefore;
  } else {
    const notBefore = await page.evaluate(() => performance.now());
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    const terminalActivity = page.locator('nav[data-floe-shell-slot="activity-bar"] button[aria-label="Terminal"]');
    await terminalActivity.waitFor({ state: 'visible', timeout: 10_000 });
    await terminalActivity.click();
    await page.locator('[data-terminal-panel-variant="panel"]:visible').waitFor({ state: 'visible', timeout: 15_000 });
    return notBefore;
  }
}

async function waitForRecoveryMarks(page, surface, notBefore, fixtureBytes) {
  await page.waitForFunction(({ expectedSurface, minimumStart, requireHistory }) => {
    const marks = performance.getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('redeven:terminal:'));
    const starts = marks.filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.startTime >= minimumStart
      && entry.detail?.variant === expectedSurface
    ));
    const start = starts.at(-1);
    if (!start) return false;
    const sameTrace = (entry) => (
      entry.detail?.session_ref === start.detail?.session_ref
      && entry.detail?.surface_generation === start.detail?.surface_generation
      && entry.startTime >= start.startTime
    );
    const ack = marks.find((entry) => entry.name.startsWith('redeven:terminal:attach-ack:') && sameTrace(entry));
    const baseline = marks.find((entry) => entry.name.startsWith('redeven:terminal:baseline-parser-committed:') && sameTrace(entry));
    const interactive = marks.find((entry) => entry.name.startsWith('redeven:terminal:interactive:') && sameTrace(entry));
    return Boolean(
      ack
      && baseline
      && interactive
      && ack.startTime <= baseline.startTime
      && baseline.startTime <= interactive.startTime
      && (!requireHistory || Number(ack.detail?.snapshot_end_sequence ?? 0) > 0)
    );
  }, {
    expectedSurface: surface,
    minimumStart: notBefore,
    requireHistory: fixtureBytes > 0,
  }, { timeout: 30_000 });

  return page.evaluate(({ expectedSurface, minimumStart }) => {
    const marks = performance.getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('redeven:terminal:'));
    const starts = marks.filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.startTime >= minimumStart
      && entry.detail?.variant === expectedSurface
    ));
    const start = starts.at(-1);
    const sameTrace = (entry) => (
      entry.detail?.session_ref === start.detail?.session_ref
      && entry.detail?.surface_generation === start.detail?.surface_generation
      && entry.startTime >= start.startTime
    );
    const find = (milestone) => marks.find((entry) => entry.name.startsWith(`redeven:terminal:${milestone}:`) && sameTrace(entry));
    const ack = find('attach-ack');
    const baseline = find('baseline-parser-committed');
    const interactive = find('interactive');
    return {
      session_ref: String(start.detail?.session_ref ?? ''),
      surface_generation: Number(start.detail?.surface_generation ?? 0),
      runtime_attach_generation: Number(ack.detail?.runtime_attach_generation ?? 0),
      coordinator_attach_generation: Number(baseline.detail?.coordinator_attach_generation ?? 0),
      history_generation: Number(baseline.detail?.history_generation ?? 0),
      history_page_count: Number(baseline.detail?.history_page_count ?? 0),
      history_chunk_count: Number(baseline.detail?.history_chunk_count ?? 0),
      history_bytes_fetched: Number(baseline.detail?.history_bytes ?? 0),
      history_reset: Boolean(baseline.detail?.history_reset),
      history_truncated: Boolean(baseline.detail?.history_truncated),
      snapshot_end_sequence: Number(ack.detail?.snapshot_end_sequence ?? 0),
      covered_through_sequence: Number(baseline.detail?.covered_through_sequence ?? 0),
      attach_ack_ms: ack.startTime - start.startTime,
      baseline_parser_committed_ms: baseline.startTime - start.startTime,
      interactive_ms: interactive.startTime - start.startTime,
    };
  }, { expectedSurface: surface, minimumStart: notBefore });
}

async function runRecoverySample({ context, entryURL, fixtureBytes, seeded, surface, temperature, tempDir, sampleIndex, maxInteractiveMs }) {
  const { page, problems } = await openEnvPage(context, entryURL);
  try {
    const notBefore = await selectSurface(page, surface);
    const targetPanel = page.locator(`[data-terminal-panel-variant="${surface}"]:visible`);
    const sessionButton = targetPanel.locator(`button[data-terminal-session-id="${seeded.sessionID}"]`).first();
    await sessionButton.waitFor({ state: 'visible', timeout: 15_000 });
    await sessionButton.click();
    const targetInput = targetPanel.locator('.redeven-terminal-surface textarea[aria-label="Terminal input"]:visible').last();
    const targetCanvas = targetPanel.locator('.redeven-terminal-surface canvas:visible').last();
    await targetInput.waitFor({ state: 'attached', timeout: 15_000 });
    await targetCanvas.waitFor({ state: 'visible', timeout: 15_000 });
    let marks;
    try {
      marks = await waitForRecoveryMarks(page, surface, notBefore, fixtureBytes);
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        marks: performance.getEntriesByType('mark')
          .filter((entry) => entry.name.startsWith('redeven:terminal:'))
          .map((entry) => ({ name: entry.name, start_time: entry.startTime, detail: entry.detail })),
        status_text: Array.from(globalThis.document.querySelectorAll('[data-testid="terminal-recovery-status-message"]'))
          .map((element) => (element.textContent ?? '').trim())
          .filter(Boolean),
        deferred_surfaces: globalThis.document.querySelectorAll('[data-terminal-deferred-surface="true"]').length,
      }));
      throw new Error(`${surface}/${temperature} recovery marks failed: ${error instanceof Error ? error.message : error}\n${JSON.stringify(diagnostics)}`);
    }
    for (const [field, value] of Object.entries({
      surface_generation: marks.surface_generation,
      runtime_attach_generation: marks.runtime_attach_generation,
      coordinator_attach_generation: marks.coordinator_attach_generation,
      history_generation: marks.history_generation,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} was not recorded in the recovery trace`);
    }
    if (maxInteractiveMs > 0 && marks.interactive_ms > maxInteractiveMs) {
      throw new Error(`interactive recovery exceeded the configured fixed-runner limit`);
    }
    if (
      marks.attach_ack_ms < 0
      || marks.attach_ack_ms > marks.baseline_parser_committed_ms
      || marks.baseline_parser_committed_ms > marks.interactive_ms
    ) {
      throw new Error('terminal recovery milestones violated the attach/parser/interactive fence');
    }
    if (marks.covered_through_sequence !== marks.snapshot_end_sequence) {
      throw new Error('terminal recovery coverage did not reach the fixed snapshot end');
    }
    if (fixtureBytes > 0 && marks.history_bytes_fetched < minimumRetainedBytesForFixture(fixtureBytes)) {
      throw new Error(`terminal recovery fetched fewer history bytes than the fixture requires (fetched=${marks.history_bytes_fetched} required=${minimumRetainedBytesForFixture(fixtureBytes)})`);
    }
    if (fixtureBytes === 0) {
      await page.waitForFunction(() => Array.from(globalThis.document.querySelectorAll('*')).some((element) => (
        (element.textContent ?? '').trim() === 'History: 0 B'
      )), undefined, { timeout: 10_000 });
    }

    const historyBytes = await waitForHistoryBytes(targetPanel, Math.min(
      seeded.historyBytes,
      minimumRetainedBytesForFixture(fixtureBytes),
    ));
    const fixtureDrift = historyBytes - seeded.historyBytes;
    const fixtureDriftInvalid = fixtureBytes >= terminalHistoryMaxBytes
      ? Math.abs(fixtureDrift) > terminalReadChunkBytes
      : fixtureDrift < 0 || fixtureDrift > terminalReadChunkBytes;
    if (fixtureDriftInvalid) {
      throw new Error(`terminal history fixture drifted outside one PTY read (seeded=${seeded.historyBytes} recovered=${historyBytes} drift=${fixtureDrift})`);
    }
    let historyVisualMatch = null;
    if (seeded.historyVisual) {
      historyVisualMatch = assertRecoveredHistoryVisual(
        seeded.historyVisual,
        await captureCanvasVisualEvidence(targetCanvas),
      );
    }
    const markerPath = path.join(tempDir, `input-${temperature}-${surface}-${sampleIndex}`);
    const probeStarted = performance.now();
    await sendTerminalCommand(
      page,
      `printf packaged-input-ok > ${shellQuote(markerPath)}`,
      targetPanel,
    );
    await waitForFile(markerPath, 15_000);
    const inputProbeMs = performance.now() - probeStarted;

    const pageText = await page.locator('body').innerText();
    if (pageText.includes('This terminal could not be restored.')) throw new Error('blocking terminal recovery error was rendered');
    if (await page.locator('button[aria-label="Retry"]:visible').count()) throw new Error('unexpected terminal recovery Retry action was rendered');
    if (fixtureBytes === 0) {
      await page.locator('button[title="Clear"]:visible').last().click();
      await delay(300);
    }
    assertPageHealthy(problems);
    return {
      fixture_id: fixtureID(fixtureBytes),
      fixture_bytes_requested: fixtureBytes,
      fixture_bytes_retained: historyBytes,
      surface,
      temperature,
      sample_index: sampleIndex,
      ...marks,
      input_probe_ms: inputProbeMs,
      history_visual_match: historyVisualMatch !== null,
      history_visual_mean_grid_delta: historyVisualMatch?.meanGridDelta ?? null,
      history_visual_ink_ratio: historyVisualMatch?.recoveredInkRatio ?? null,
      status: 'passed',
    };
  } finally {
    await page.close();
  }
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(options) {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const tempDir = await mkdtemp(path.join(tempRoot, 'redeven-terminal-carrier-'));
  let runtime = null;
  let browser = null;
  try {
    runtime = await runStage('runtime_start', () => startRuntime(tempDir));
    const entryURL = new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).toString();
    browser = await runStage('browser_launch', () => chromium.launch({ headless: true }));
    const reusedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const seed = await openEnvPage(reusedContext, entryURL);
    const seeded = await runStage('fixture_seed', () => seedRetainedSession(seed.page, tempDir, options.fixtureBytes));
    assertPageHealthy(seed.problems);
    await seed.page.close();

    const samples = [];
    for (const surface of ['workbench', 'panel']) {
      for (let sampleIndex = 1; sampleIndex <= options.reusedContextSamples; sampleIndex += 1) {
        samples.push(await runStage(`reused_context_${surface}`, () => runRecoverySample({
          context: reusedContext,
          entryURL,
          fixtureBytes: options.fixtureBytes,
          seeded,
          surface,
          temperature: 'reused_context',
          tempDir,
          sampleIndex,
          maxInteractiveMs: options.maxInteractiveMs,
        })));
      }
    }
    await reusedContext.close();

    for (const surface of ['workbench', 'panel']) {
      for (let sampleIndex = 1; sampleIndex <= options.freshContextSamples; sampleIndex += 1) {
        const freshContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        try {
          samples.push(await runStage(`fresh_context_${surface}`, () => runRecoverySample({
            context: freshContext,
            entryURL,
            fixtureBytes: options.fixtureBytes,
            seeded,
            surface,
            temperature: 'fresh_context',
            tempDir,
            sampleIndex,
            maxInteractiveMs: options.maxInteractiveMs,
          })));
        } finally {
          await freshContext.close();
        }
      }
    }

    return {
      schema_version: 1,
      status: 'passed',
      commit: String(process.env.GITHUB_SHA ?? 'local').slice(0, 40),
      runtime: {
        compatibility_epoch: runtime.startup.runtime_service?.compatibility_epoch ?? null,
        effective_run_mode: runtime.startup.effective_run_mode ?? null,
      },
      runner: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        chromium: browser.version(),
        cpu_count: os.cpus().length,
      },
      fixture: {
        id: fixtureID(options.fixtureBytes),
        requested_bytes: options.fixtureBytes,
        retained_bytes_after_seed: seeded.historyBytes,
        rendered_history_label: seeded.historyLabel,
      },
      sample_plan: {
        reused_context_per_surface: options.reusedContextSamples,
        fresh_context_per_surface: options.freshContextSamples,
      },
      threshold: {
        max_interactive_ms: options.maxInteractiveMs > 0 ? options.maxInteractiveMs : null,
        enforced: options.maxInteractiveMs > 0,
      },
      samples,
    };
  } finally {
    if (browser) await browser.close();
    await stopRuntime(runtime);
    await rm(tempDir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2).filter((value) => value !== '--');
const reportPath = readOption(args, '--report');
const fixtureBytes = parsePositiveInteger(
  readOption(args, '--fixture-bytes', String(defaultFixtureBytes)),
  '--fixture-bytes',
  { allowZero: true },
);
const maxInteractiveMs = parsePositiveInteger(
  readOption(args, '--max-interactive-ms', '0'),
  '--max-interactive-ms',
  { allowZero: true },
);
const reusedContextSamples = parsePositiveInteger(
  readOption(args, '--reused-context-samples', '1'),
  '--reused-context-samples',
);
const freshContextSamples = parsePositiveInteger(
  readOption(args, '--fresh-context-samples', '1'),
  '--fresh-context-samples',
);

main({ fixtureBytes, maxInteractiveMs, reusedContextSamples, freshContextSamples })
  .then(async (report) => {
    await writeReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  })
  .catch(async (error) => {
    const failure = {
      schema_version: 1,
      status: 'failed',
      error_code: 'terminal_carrier_e2e_failed',
      error_stage: error instanceof TerminalCarrierStageError ? error.stage : 'unknown',
      fixture: { id: fixtureID(fixtureBytes), requested_bytes: fixtureBytes },
    };
    await writeReport(reportPath, failure).catch(() => undefined);
    console.error(error instanceof Error ? formatErrorWithCauses(error) : error);
    process.exitCode = 1;
  });
