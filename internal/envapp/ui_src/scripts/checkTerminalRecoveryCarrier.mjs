#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

import {
  assertTerminalCarrierHistoryVisualEvidence,
  assertTerminalCarrierInteractiveLimit,
  assertTerminalCarrierP95Limit,
  terminalCarrierExpectedRetainedBytes,
  terminalCarrierSampleMarkerName,
} from './terminalCarrierThreshold.mjs';
import { classifyTerminalCarrierConsoleMessage } from './terminalCarrierRunnerPolicy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const defaultFixtureBytes = 64 * 1024;
const terminalHistoryMaxBytes = 8 * 1024 * 1024;
const terminalHistoryChunkMaxBytes = 32 * 1024;
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

function pseudonymousTerminalSessionRef(sessionID) {
  let hash = 2166136261;
  for (const character of String(sessionID ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `session-${(hash >>> 0).toString(16)}`;
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

function analyzeTerminalTypography(imageBuffer) {
  const image = PNG.sync.read(imageBuffer);
  const colorCounts = new Map();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const key = `${image.data[offset] >> 2}:${image.data[offset + 1] >> 2}:${image.data[offset + 2] >> 2}`;
    colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
  }
  const backgroundKey = [...colorCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (!backgroundKey) throw new Error('terminal typography image has no pixels');
  const background = backgroundKey.split(':').map((value) => Number(value) * 4 + 2);
  const scanWidth = Math.min(image.width, 320);
  const occupiedRows = [];
  for (let y = 0; y < image.height; y += 1) {
    let inkPixels = 0;
    for (let x = 0; x < scanWidth; x += 1) {
      const offset = (y * image.width + x) * 4;
      const distance = Math.abs(image.data[offset] - background[0])
        + Math.abs(image.data[offset + 1] - background[1])
        + Math.abs(image.data[offset + 2] - background[2]);
      if (distance > 18) inkPixels += 1;
    }
    if (inkPixels >= 3) occupiedRows.push(y);
  }
  const rowRuns = [];
  for (const y of occupiedRows) {
    const previous = rowRuns.at(-1);
    if (!previous || y > previous.end + 1) rowRuns.push({ start: y, end: y });
    else previous.end = y;
  }
  return { width: image.width, height: image.height, rowRuns };
}

async function captureTerminalTypographyEvidence(page, runtime, surface) {
  await terminalInput(page, runtime);
  const canvas = runtime.locator('.redeven-terminal-surface .floeterm-beamterm-canvas:visible').last();
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const geometry = await runtime.evaluate((element) => {
    const target = element.querySelector('.floeterm-beamterm-canvas');
    const input = globalThis.document.querySelector('body > textarea[aria-label="Terminal input"]:focus');
    if (!(target instanceof globalThis.HTMLCanvasElement) || !(input instanceof globalThis.HTMLTextAreaElement)) {
      throw new Error('terminal renderer geometry is unavailable');
    }
    const dpr = globalThis.devicePixelRatio;
    const canvasRect = target.getBoundingClientRect();
    const visualScaleX = canvasRect.width / target.clientWidth;
    const visualScaleY = canvasRect.height / target.clientHeight;
    const metricsCanvas = new globalThis.OffscreenCanvas(128, 128);
    const context = metricsCanvas.getContext('2d');
    if (!context) throw new Error('terminal font metrics context is unavailable');
    context.font = `${12 * dpr}px Monaco, Menlo, "SF Mono", "JetBrains Mono", "Iosevka", monospace`;
    const metrics = context.measureText('M');
    const physicalCellWidth = Math.max(1, Math.round(metrics.width));
    const physicalCellHeight = Math.max(1, Math.round(
      metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
    ));
    return {
      dpr,
      canvas_backing_width: target.width,
      canvas_backing_height: target.height,
      canvas_css_width: target.clientWidth,
      canvas_css_height: target.clientHeight,
      visual_scale_x: visualScaleX,
      visual_scale_y: visualScaleY,
      expected_input_width: physicalCellWidth / dpr * visualScaleX,
      expected_input_height: physicalCellHeight / dpr * visualScaleY,
      actual_input_width: Number.parseFloat(input.style.width),
      actual_input_height: Number.parseFloat(input.style.height),
      actual_input_line_height: Number.parseFloat(input.style.lineHeight),
    };
  });
  const tolerance = 0.15;
  for (const [name, actual, expected] of [
    ['input_width', geometry.actual_input_width, geometry.expected_input_width],
    ['input_height', geometry.actual_input_height, geometry.expected_input_height],
    ['input_line_height', geometry.actual_input_line_height, geometry.expected_input_height],
  ]) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${surface} terminal ${name} does not match font metrics (${actual} vs ${expected})`);
    }
  }
  if (
    geometry.canvas_backing_width !== Math.round(geometry.canvas_css_width * geometry.dpr)
    || geometry.canvas_backing_height !== Math.round(geometry.canvas_css_height * geometry.dpr)
  ) {
    throw new Error(`${surface} terminal canvas backing size does not match CSS size and DPR`);
  }
  const pixels = analyzeTerminalTypography(await canvas.screenshot({ animations: 'disabled' }));
  if (pixels.rowRuns.length < 5) {
    throw new Error(`${surface} terminal glyph rows are not visually separated: ${JSON.stringify(pixels)}`);
  }
  return { geometry, pixel_row_runs: pixels.rowRuns.length };
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
  const problems = { console: [], browserDiagnostics: [], page: [], requests: [], responses: [] };
  page.on('console', (message) => {
    const entry = { type: message.type(), text: message.text(), location: message.location() };
    const classification = classifyTerminalCarrierConsoleMessage(entry);
    if (classification === 'browser_driver_diagnostic') {
      problems.browserDiagnostics.push(entry);
      if (carrierProgress.runner) carrierProgress.runner.browser_driver_diagnostic_count += 1;
    } else if (classification === 'renderer_problem') {
      problems.console.push(entry);
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

async function terminalInput(page, scope = page) {
  const focusHost = scope.locator(
    '.redeven-terminal-surface [contenteditable="true"][aria-label="Terminal input"]:visible',
  ).last();
  await focusHost.waitFor({ state: 'visible', timeout: 15_000 });
  await focusHost.evaluate((element) => element.focus({ preventScroll: true }));
  const input = page.locator('body > textarea[aria-label="Terminal input"]:focus');
  await input.waitFor({ state: 'attached', timeout: 15_000 });
  return input;
}

async function sendTerminalCommand(page, command, scope = page) {
  const input = await terminalInput(page, scope);
  await input.focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

async function waitForCanvasChange(canvas, before, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const afterHash = sha256(await canvas.screenshot());
    if (afterHash !== before.hash) return afterHash;
    await delay(75);
  }
  const finalImage = await canvas.screenshot();
  const finalVisual = analyzeCanvasImage(finalImage);
  throw new Error(`terminal canvas did not change after the input probe\n${JSON.stringify({
    before_hash: before.hash,
    final_hash: sha256(finalImage),
    before_dimensions: { width: before.visual.width, height: before.visual.height },
    final_dimensions: { width: finalVisual.width, height: finalVisual.height },
    before_ink_ratio: before.visual.inkRatio,
    final_ink_ratio: finalVisual.inkRatio,
  })}`);
}

async function captureCanvasEvidence(canvas) {
  const image = await canvas.screenshot();
  return { hash: sha256(image), visual: analyzeCanvasImage(image) };
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

async function waitForHistoryBytes(scope, expectedBytes, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let minimumObservedBytes = null;
  let lastObservedBytes = null;
  while (Date.now() < deadline) {
    const historyBytes = await readHistoryBytes(scope).catch(() => null);
    if (historyBytes !== null) {
      minimumObservedBytes = minimumObservedBytes === null
        ? historyBytes
        : Math.min(minimumObservedBytes, historyBytes);
      lastObservedBytes = historyBytes;
      if (historyBytes === expectedBytes) return historyBytes;
    }
    await delay(50);
  }
  throw new Error(
    'terminal history stats did not reach the exact retained-byte fixture '
      + `(expected_bytes=${expectedBytes}, minimum_observed_bytes=${minimumObservedBytes}, `
      + `last_observed_bytes=${lastObservedBytes})`,
  );
}

async function seedRetainedSession(page, tempDir, fixtureBytes) {
  const targetPanel = page.locator('[data-terminal-panel-variant]:visible').last();
  const workbenchWidget = targetPanel.locator('xpath=ancestor::*[@data-floe-workbench-widget-id][1]');
  const workbenchWidgetID = await workbenchWidget.getAttribute('data-floe-workbench-widget-id');
  if (!workbenchWidgetID) throw new Error('terminal fixture panel did not expose its workbench widget identity');
  const createButton = targetPanel.getByRole('button', { name: 'Create session', exact: true });
  if (await createButton.count()) {
    await createButton.click();
  } else {
    await targetPanel.locator('[data-testid="terminal-sidebar-add-session"]:visible').first().click();
  }
  await terminalInput(page, targetPanel);
  const anchorSession = targetPanel.locator('button[data-terminal-session-active="true"]:visible').first();
  const anchorSessionID = await anchorSession.getAttribute('data-terminal-session-id');
  if (!anchorSessionID) throw new Error('anchor terminal session did not expose its renderer identity');
  const targetVariant = await targetPanel.getAttribute('data-terminal-panel-variant');
  if (!targetVariant) throw new Error('terminal fixture panel did not expose its variant');

  await targetPanel.locator('[data-testid="terminal-sidebar-add-session"]:visible').first().click();
  await page.waitForFunction(({ previousSessionID, panelVariant }) => {
    const panel = globalThis.document.querySelector(`[data-terminal-panel-variant="${panelVariant}"]`);
    if (!panel) return false;
    return Array.from(panel.querySelectorAll('[data-terminal-runtime-session]')).some((runtime) => (
      runtime.getAttribute('data-terminal-runtime-session') !== previousSessionID
      && runtime.getClientRects().length > 0
      && runtime.querySelector('.redeven-terminal-surface [contenteditable="true"][aria-label="Terminal input"]')
    ));
  }, { previousSessionID: anchorSessionID, panelVariant: targetVariant }, { timeout: 15_000 });
  const targetInputHost = targetPanel.locator(
    '[data-terminal-runtime-session] .redeven-terminal-surface [contenteditable="true"][aria-label="Terminal input"]:visible',
  ).last();
  const targetRuntime = targetInputHost.locator('xpath=ancestor::*[@data-terminal-runtime-session][1]');
  const sessionID = await targetRuntime.getAttribute('data-terminal-runtime-session');
  if (!sessionID || sessionID === anchorSessionID) {
    throw new Error('new terminal session did not become the interactive runtime');
  }
  const targetSessionButton = targetPanel.locator(
    `button[data-terminal-session-id="${sessionID}"]:visible`,
  ).first();
  await targetSessionButton.waitFor({ state: 'visible', timeout: 15_000 });
  if (await targetSessionButton.getAttribute('data-terminal-session-active') !== 'true') {
    await targetSessionButton.click();
  }
  await page.waitForFunction(({ panelVariant, expectedSessionID }) => (
    globalThis.document.querySelector(
      `[data-terminal-panel-variant="${panelVariant}"] button[data-terminal-session-id="${expectedSessionID}"][data-terminal-session-active="true"]`,
    ) !== null
  ), { panelVariant: targetVariant, expectedSessionID: sessionID }, { timeout: 15_000 });
  await terminalInput(page, targetRuntime);

  const quietShellMarkerPath = path.join(tempDir, 'fixture-shell-quiet');
  await sendTerminalCommand(
    page,
    'stty -echo -onlcr; exec env PS1= PROMPT_COMMAND= bash --noprofile --norc -i',
    targetRuntime,
  );
  await sendTerminalCommand(page, `printf quiet > ${shellQuote(quietShellMarkerPath)}`, targetRuntime);
  await waitForFile(quietShellMarkerPath, 15_000);

  const clearButton = targetPanel.locator('[data-testid="terminal-clear-active-session"]:visible').last();
  try {
    await clearButton.waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      url: globalThis.location.href,
      visibility: globalThis.document.visibilityState,
      active_session_count: globalThis.document.querySelectorAll('button[data-terminal-session-active="true"]').length,
      terminal_panel_variants: Array.from(globalThis.document.querySelectorAll('[data-terminal-panel-variant]'))
        .map((element) => ({
          variant: element.getAttribute('data-terminal-panel-variant'),
          hidden: element.closest('[hidden]') !== null,
        })),
      clear_control_count: globalThis.document.querySelectorAll('[data-testid="terminal-clear-active-session"]').length,
    }));
    throw new Error(`terminal clear control did not become visible\n${JSON.stringify(diagnostics)}`, { cause: error });
  }
  await clearButton.click();
  await page.waitForFunction((panelVariant) => (
    globalThis.document.querySelector(
      `[data-terminal-panel-variant="${panelVariant}"] [data-testid="terminal-clear-active-session"][data-terminal-clear-state="pending"]`,
    ) !== null
  ), targetVariant, { timeout: 10_000 });
  await page.waitForFunction((panelVariant) => (
    globalThis.document.querySelector(
      `[data-terminal-panel-variant="${panelVariant}"] [data-testid="terminal-clear-active-session"][data-terminal-clear-state="idle"]:not([disabled])`,
    ) !== null
  ), targetVariant, { timeout: 10_000 });
  await terminalInput(page, targetRuntime);
  await waitForHistoryBytes(targetPanel, 0);

  if (fixtureBytes === 0) {
    const historyBytes = 0;
    const historyLabel = await targetPanel.locator('text=/^History:/').last().textContent().catch(() => '');
    return {
      anchorSessionID,
      sessionID,
      workbenchWidgetID,
      historyBytes,
      historyLabel: String(historyLabel ?? '').trim(),
      historyVisual: null,
    };
  }

  const markerPath = path.join(tempDir, 'fixture-seeded');
  const canvas = targetRuntime.locator('.redeven-terminal-surface .floeterm-beamterm-canvas:visible').last();
  await canvas.waitFor({ state: 'visible', timeout: 10_000 });
  const beforeFixture = await captureCanvasEvidence(canvas);
  const line = 'redeven-packaged-terminal-history-0123456789abcdefghijklmnopqrstuvwxyz';
  const command = `yes ${shellQuote(line)} | head -c ${fixtureBytes}; printf seeded > ${shellQuote(markerPath)}`;
  await sendTerminalCommand(page, command, targetRuntime);
  await waitForFile(markerPath, 30_000);
  const expectedHistoryBytes = terminalCarrierExpectedRetainedBytes({
    fixtureBytes,
    historyMaxBytes: terminalHistoryMaxBytes,
  });
  const historyBytes = await waitForHistoryBytes(targetPanel, expectedHistoryBytes);
  try {
    await waitForCanvasChange(canvas, beforeFixture, 15_000);
  } catch (error) {
    const diagnostics = await page.evaluate(({ expectedSessionID, panelVariant }) => ({
      panel_variant: panelVariant,
      active_sessions: Array.from(globalThis.document.querySelectorAll(
        `[data-terminal-panel-variant="${panelVariant}"] button[data-terminal-session-active="true"]`,
      )).map((element) => element.getAttribute('data-terminal-session-id')),
      runtimes: Array.from(globalThis.document.querySelectorAll(
        `[data-terminal-panel-variant="${panelVariant}"] [data-terminal-runtime-session]`,
      )).map((element) => {
        const canvasElement = element.querySelector('.floeterm-beamterm-canvas');
        const rect = element.getBoundingClientRect();
        return {
          session_id: element.getAttribute('data-terminal-runtime-session'),
          expected: element.getAttribute('data-terminal-runtime-session') === expectedSessionID,
          aria_busy: element.getAttribute('aria-busy'),
          client_rects: element.getClientRects().length,
          rect: [rect.width, rect.height],
          canvas: canvasElement instanceof globalThis.HTMLCanvasElement ? {
            backing: [canvasElement.width, canvasElement.height],
            client: [canvasElement.clientWidth, canvasElement.clientHeight],
            display: globalThis.getComputedStyle(canvasElement).display,
            visibility: globalThis.getComputedStyle(canvasElement).visibility,
          } : null,
        };
      }),
      recovery_marks: performance.getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('redeven:terminal:'))
        .slice(-24)
        .map((entry) => ({ name: entry.name, detail: entry.detail })),
    }), { expectedSessionID: sessionID, panelVariant: targetVariant });
    throw new Error(`terminal visual probe was not projected into its active runtime\n${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  }
  const historyVisual = await captureCanvasVisualEvidence(canvas);
  const historyLayout = await page.evaluate(({ panelVariant, sessionRef }) => {
    const attachStart = performance.getEntriesByType('mark').filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.detail?.variant === panelVariant
      && entry.detail?.session_ref === sessionRef
    )).at(-1);
    return {
      cols: Number(attachStart?.detail?.cols ?? 0),
      rows: Number(attachStart?.detail?.rows ?? 0),
    };
  }, { panelVariant: targetVariant, sessionRef: pseudonymousTerminalSessionRef(sessionID) });
  if (!Number.isSafeInteger(historyLayout.cols) || historyLayout.cols <= 0
    || !Number.isSafeInteger(historyLayout.rows) || historyLayout.rows <= 0) {
    throw new Error('terminal fixture did not expose its renderer layout');
  }
  const historyLabel = await targetPanel.locator('text=/^History:/').last().textContent().catch(() => '');
  return {
    anchorSessionID,
    sessionID,
    workbenchWidgetID,
    historyBytes,
    historyLabel: String(historyLabel ?? '').trim(),
    historyLayout,
    historyVisual,
  };
}

function workbenchTerminalPanel(page, widgetID) {
  return page.locator(
    `[data-floe-workbench-widget-id="${widgetID}"] [data-terminal-panel-variant="workbench"]:visible`,
  );
}

async function selectSurface(page, surface) {
  await page.locator('button[data-terminal-session-id]').first().waitFor({ state: 'attached', timeout: 20_000 });
  if (surface === 'workbench') {
    const workbenchPanel = page.locator('[data-terminal-panel-variant="workbench"]:visible');
    if (await workbenchPanel.count()) return 0;
    const notBefore = await page.evaluate(() => performance.now());
    await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await workbenchPanel.first().waitFor({ state: 'visible', timeout: 15_000 });
    return notBefore;
  } else {
    const notBefore = await page.evaluate(() => performance.now());
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    const terminalPanel = page.locator('[data-terminal-panel-variant="panel"]:visible');
    if (await terminalPanel.count()) return notBefore;
    const terminalActivity = page.locator('nav[data-floe-shell-slot="activity-bar"] button').first();
    await terminalActivity.waitFor({ state: 'visible', timeout: 10_000 });
    await terminalActivity.click();
    await terminalPanel.waitFor({ state: 'visible', timeout: 15_000 });
    return notBefore;
  }
}

async function waitForRecoveryMarks(page, surface, notBefore, fixtureBytes, expectedSessionRef = '') {
  await page.waitForFunction(({ expectedSurface, minimumStart, requireHistory, sessionRef }) => {
    const marks = performance.getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('redeven:terminal:'));
    const starts = marks.filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.startTime >= minimumStart
      && entry.detail?.variant === expectedSurface
      && (!sessionRef || entry.detail?.session_ref === sessionRef)
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
    sessionRef: expectedSessionRef,
  }, { timeout: 30_000 });

  return page.evaluate(({ expectedSurface, minimumStart, sessionRef }) => {
    const marks = performance.getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('redeven:terminal:'));
    const starts = marks.filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.startTime >= minimumStart
      && entry.detail?.variant === expectedSurface
      && (!sessionRef || entry.detail?.session_ref === sessionRef)
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
      attach_start_count: starts.length,
      runtime_attach_generation: Number(ack.detail?.runtime_attach_generation ?? 0),
      coordinator_attach_generation: Number(baseline.detail?.coordinator_attach_generation ?? 0),
      history_generation: Number(baseline.detail?.history_generation ?? 0),
      history_page_count: Number(baseline.detail?.history_page_count ?? 0),
      history_chunk_count: Number(baseline.detail?.history_chunk_count ?? 0),
      history_bytes_fetched: Number(baseline.detail?.history_bytes ?? 0),
      history_reset: Boolean(baseline.detail?.history_reset),
      history_truncated: Boolean(baseline.detail?.history_truncated),
      cols: Number(start.detail?.cols ?? 0),
      rows: Number(start.detail?.rows ?? 0),
      snapshot_end_sequence: Number(ack.detail?.snapshot_end_sequence ?? 0),
      covered_through_sequence: Number(baseline.detail?.covered_through_sequence ?? 0),
      attach_ack_ms: ack.startTime - start.startTime,
      baseline_parser_committed_ms: baseline.startTime - start.startTime,
      interactive_ms: interactive.startTime - start.startTime,
    };
  }, { expectedSurface: surface, minimumStart: notBefore, sessionRef: expectedSessionRef });
}

async function countTerminalAttachStarts(page, surface, sessionRef) {
  return page.evaluate(({ expectedSurface, expectedSessionRef }) => (
    performance.getEntriesByType('mark').filter((entry) => (
      entry.name.startsWith('redeven:terminal:attach-start:')
      && entry.detail?.variant === expectedSurface
      && entry.detail?.session_ref === expectedSessionRef
    )).length
  ), { expectedSurface: surface, expectedSessionRef: sessionRef });
}

async function waitForTerminalPerformanceMark(page, stage, notBefore, sessionRef, timeoutMs = 30_000) {
  await page.waitForFunction(({ expectedName, minimumStart, expectedSessionRef }) => (
    performance.getEntriesByName(expectedName, 'mark').some((entry) => (
      entry.startTime >= minimumStart
      && entry.detail?.session_ref === expectedSessionRef
    ))
  ), {
    expectedName: `redeven:terminal:${stage}`,
    minimumStart: notBefore,
    expectedSessionRef: sessionRef,
  }, { timeout: timeoutMs });

  return page.evaluate(({ expectedName, minimumStart, expectedSessionRef }) => {
    const entries = performance.getEntriesByName(expectedName, 'mark').filter((entry) => (
      entry.startTime >= minimumStart
      && entry.detail?.session_ref === expectedSessionRef
    ));
    const entry = entries.at(-1);
    return { start_time: entry.startTime, detail: entry.detail };
  }, {
    expectedName: `redeven:terminal:${stage}`,
    minimumStart: notBefore,
    expectedSessionRef: sessionRef,
  });
}

async function waitForTerminalHistoryPrefetchOutcome(page, sessionRef, timeoutMs = 45_000) {
  const outcomeNames = [
    'redeven:terminal:history-prefetch-ready',
    'redeven:terminal:history-prefetch-skipped',
  ];
  await page.waitForFunction(({ expectedNames, expectedSessionRef }) => (
    expectedNames.some((expectedName) => (
      performance.getEntriesByName(expectedName, 'mark').some((entry) => (
        entry.detail?.session_ref === expectedSessionRef
      ))
    ))
  ), {
    expectedNames: outcomeNames,
    expectedSessionRef: sessionRef,
  }, { timeout: timeoutMs }).catch(async (error) => {
    const diagnostics = await page.evaluate((expectedSessionRef) => (
      performance.getEntriesByType('mark')
        .filter((entry) => (
          entry.name.includes('history')
          && entry.detail?.session_ref === expectedSessionRef
        ))
        .map((entry) => ({ name: entry.name, start_time: entry.startTime, detail: entry.detail }))
    ), sessionRef);
    throw new Error(
      `terminal history prefetch did not finish: ${error instanceof Error ? error.message : error}`
        + `\n${JSON.stringify(diagnostics)}`,
    );
  });

  const trace = await page.evaluate(({ expectedNames, expectedSessionRef }) => (
    performance.getEntriesByType('mark')
      .filter((entry) => (
        (expectedNames.includes(entry.name) || entry.name === 'redeven:terminal:history-prefetch-start')
        && entry.detail?.session_ref === expectedSessionRef
      ))
      .map((entry) => ({ name: entry.name, start_time: entry.startTime, detail: entry.detail }))
      .sort((left, right) => left.start_time - right.start_time)
  ), {
    expectedNames: outcomeNames,
    expectedSessionRef: sessionRef,
  });
  const outcome = trace.find((entry) => outcomeNames.includes(entry.name));
  const started = trace.find((entry) => entry.name === 'redeven:terminal:history-prefetch-start');
  if (!outcome || !started || started.start_time > outcome.start_time) {
    throw new Error(`terminal history prefetch marks were not causally ordered: ${JSON.stringify(trace)}`);
  }
  if (outcome.name === 'redeven:terminal:history-prefetch-skipped') {
    throw new Error(`terminal history prefetch was skipped: ${JSON.stringify(trace)}`);
  }
  return {
    start_time: outcome.start_time,
    started_at: started.start_time,
    detail: outcome.detail,
  };
}

async function runSharedPreparedHistorySample({
  context,
  entryURL,
  fixtureBytes,
  seeded,
  tempDir,
  sampleIndex,
  maxInteractiveMs,
}) {
  const { page, problems } = await openEnvPage(context, entryURL);
  const sessionRef = pseudonymousTerminalSessionRef(seeded.sessionID);
  try {
    const panelStart = await selectSurface(page, 'panel');
    const panel = page.locator('[data-terminal-panel-variant="panel"]:visible');
    const panelSession = panel.locator(`button[data-terminal-session-id="${seeded.sessionID}"]`).first();
    await panelSession.waitFor({ state: 'visible', timeout: 15_000 });
    let panelTargetStart = panelStart;
    if (await panelSession.getAttribute('data-terminal-session-active') !== 'true') {
      panelTargetStart = await page.evaluate(() => performance.now());
      await panelSession.click();
    }
    const panelRuntime = panel.locator(`[data-terminal-runtime-session="${seeded.sessionID}"]`).first();
    await terminalInput(page, panelRuntime);
    const panelRecovery = await waitForRecoveryMarks(
      page,
      'panel',
      panelTargetStart,
      fixtureBytes,
      sessionRef,
    );
    const prefetch = await waitForTerminalHistoryPrefetchOutcome(
      page,
      sessionRef,
      45_000,
    );
    const panelCanvas = panelRuntime.locator('.redeven-terminal-surface .floeterm-beamterm-canvas:visible').last();
    await panelCanvas.waitFor({ state: 'visible', timeout: 10_000 });
    if (fixtureBytes === 0) {
      const typographyLines = [
        'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
        'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
        'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
        'terminal-typography-row-05-[]{}()<>/\\|_-=+;:,.',
        'terminal-typography-row-06-中文字符保持网格宽度',
        'terminal-typography-row-07-ASCII-spacing-remains-visible',
        'terminal-typography-row-08-0123456789-abcdefghij',
        'terminal-typography-row-09-XXXXXXXXXXXXXXXXXXXXXXXX',
        'terminal-typography-row-10-oooooooooooooooooooooooo',
        'terminal-typography-row-11-mixed-WiMWiMWiMWiMWiMWiM',
        'terminal-typography-END-12--------------------------',
      ];
      const beforeTypography = await captureCanvasEvidence(panelCanvas);
      await sendTerminalCommand(
        page,
        `printf '\\033[3J\\033[2J\\033[H'; printf '%s\\n' ${typographyLines.map(shellQuote).join(' ')}`,
        panelRuntime,
      );
      await waitForCanvasChange(panelCanvas, beforeTypography, 15_000);
    }
    const panelTypography = await captureTerminalTypographyEvidence(page, panelRuntime, 'panel');
    const panelBaselineVisual = fixtureBytes > 0
      ? await captureCanvasVisualEvidence(panelCanvas)
      : null;
    const panelBaselineRef = panelBaselineVisual
      ? terminalCarrierSampleMarkerName('panel-visual-baseline', sampleIndex)
      : null;

    await selectSurface(page, 'workbench');
    const workbench = workbenchTerminalPanel(page, seeded.workbenchWidgetID);
    await workbench.waitFor({ state: 'visible', timeout: 15_000 });
    const workbenchSession = workbench.locator(`button[data-terminal-session-id="${seeded.sessionID}"]`).first();
    await workbenchSession.waitFor({ state: 'visible', timeout: 15_000 });
    const targetStart = await page.evaluate(() => performance.now());
    await workbenchSession.click();
    await page.waitForFunction((targetSessionID) => (
      Array.from(globalThis.document.querySelectorAll(`button[data-terminal-session-id="${targetSessionID}"]`))
        .some((button) => button.getAttribute('data-terminal-session-active') === 'true')
    ), seeded.sessionID, { timeout: 15_000 });
    const workbenchRecovery = await waitForRecoveryMarks(
      page,
      'workbench',
      targetStart,
      fixtureBytes,
      sessionRef,
    );
    let prepared;
    try {
      prepared = await waitForTerminalPerformanceMark(
        page,
        'prepared-history-hit',
        targetStart,
        sessionRef,
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => performance.getEntriesByType('mark')
        .filter((entry) => entry.name.includes('history'))
        .map((entry) => ({ name: entry.name, start_time: entry.startTime, detail: entry.detail })));
      throw new Error(`shared prepared history hit was not observed: ${error instanceof Error ? error.message : error}\n${JSON.stringify(diagnostics)}`);
    }
    const rebased = await page.evaluate(({ minimumStart, expectedSessionRef }) => (
      performance.getEntriesByName('redeven:terminal:prepared-history-rebased', 'mark').some((entry) => (
        entry.startTime >= minimumStart
        && entry.detail?.session_ref === expectedSessionRef
      ))
    ), { minimumStart: targetStart, expectedSessionRef: sessionRef });

    if (Number(prepared.detail?.byte_length ?? 0) !== seeded.historyBytes) {
      throw new Error(
        'shared prepared history did not exactly cover the retained fixture '
          + `(prepared_bytes=${Number(prepared.detail?.byte_length ?? 0)}, `
          + `retained_bytes=${seeded.historyBytes})`,
      );
    }
    if (workbenchRecovery.attach_start_count !== 1) {
      throw new Error(`shared prepared history started attach ${workbenchRecovery.attach_start_count} times`);
    }
    if (workbenchRecovery.covered_through_sequence !== workbenchRecovery.snapshot_end_sequence) {
      throw new Error('shared prepared history recovery did not reach the attach snapshot boundary');
    }
    for (const [field, value] of Object.entries({
      panel_history_generation: panelRecovery.history_generation,
      workbench_history_generation: workbenchRecovery.history_generation,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${field} was not recorded in the shared prepared-history trace`);
      }
    }
    if (workbenchRecovery.history_page_count > 1) {
      throw new Error('shared prepared history required more than one attach-delta history page');
    }
    const maximumDeltaBytes = Math.max(
      terminalHistoryChunkMaxBytes * 4,
      Math.floor(seeded.historyBytes / 4),
    );
    if (workbenchRecovery.history_bytes_fetched > maximumDeltaBytes) {
      throw new Error(`shared prepared history fetched too much attach delta (${workbenchRecovery.history_bytes_fetched} > ${maximumDeltaBytes})`);
    }
    const workbenchRuntime = workbench.locator(`[data-terminal-runtime-session="${seeded.sessionID}"]`).first();
    const targetCanvas = workbenchRuntime.locator('.redeven-terminal-surface .floeterm-beamterm-canvas:visible').last();
    await targetCanvas.waitFor({ state: 'visible', timeout: 10_000 });
    const workbenchTypography = await captureTerminalTypographyEvidence(page, workbenchRuntime, 'workbench');
    const historyVisualMatch = panelBaselineVisual
      ? assertTerminalCarrierHistoryVisualEvidence({
        baselineVisual: panelBaselineVisual,
        recoveredVisual: await captureCanvasVisualEvidence(targetCanvas),
        baselineLayout: { cols: panelRecovery.cols, rows: panelRecovery.rows },
        recoveredLayout: { cols: workbenchRecovery.cols, rows: workbenchRecovery.rows },
      })
      : null;
    const markerName = terminalCarrierSampleMarkerName('input-shared-prepared-history', sampleIndex);
    const markerPath = path.join(tempDir, markerName);
    const markerValue = `shared-prepared-input-ok-${sampleIndex}`;
    const inputProbeStarted = performance.now();
    await sendTerminalCommand(
      page,
      `printf ${shellQuote(markerValue)} > ${shellQuote(markerPath)}`,
      workbenchRuntime,
    );
    await waitForFile(markerPath, 15_000);
    const inputProbeMs = performance.now() - inputProbeStarted;
    const panelAttachStartsBeforeReturn = await countTerminalAttachStarts(page, 'panel', sessionRef);
    await selectSurface(page, 'panel');
    const returnedPanel = page.locator('[data-terminal-panel-variant="panel"]:visible');
    const returnedPanelSession = returnedPanel.locator(`button[data-terminal-session-id="${seeded.sessionID}"]`).first();
    await returnedPanelSession.waitFor({ state: 'visible', timeout: 15_000 });
    if (await returnedPanelSession.getAttribute('data-terminal-session-active') !== 'true') {
      await returnedPanelSession.click();
    }
    const returnedPanelRuntime = returnedPanel.locator(`[data-terminal-runtime-session="${seeded.sessionID}"]`).first();
    const returnedPanelTypography = await captureTerminalTypographyEvidence(
      page,
      returnedPanelRuntime,
      'panel_returned',
    );
    const panelAttachStartsAfterReturn = await countTerminalAttachStarts(page, 'panel', sessionRef);
    if (panelAttachStartsAfterReturn !== panelAttachStartsBeforeReturn) {
      throw new Error(
        'returning to the retained panel terminal unexpectedly started another attach '
          + `(before=${panelAttachStartsBeforeReturn} after=${panelAttachStartsAfterReturn})`,
      );
    }
    assertTerminalCarrierInteractiveLimit({
      stage: 'shared_prepared_history',
      interactiveMs: workbenchRecovery.interactive_ms,
      maxInteractiveMs,
    });
    assertPageHealthy(problems);
    return {
      status: 'passed',
      session_ref: sessionRef,
      prepared_bytes: Number(prepared.detail?.byte_length ?? 0),
      prepared_pages: Number(prepared.detail?.page_count ?? 0),
      prepared_rebased: rebased,
      prefetch_ready_ms: prefetch.start_time,
      prefetch_started_ms: prefetch.started_at,
      prefetch_duration_ms: Number(prefetch.detail?.duration_ms ?? 0),
      attach_start_count: workbenchRecovery.attach_start_count,
      attach_delta_page_count: workbenchRecovery.history_page_count,
      attach_delta_bytes: workbenchRecovery.history_bytes_fetched,
      snapshot_end_sequence: workbenchRecovery.snapshot_end_sequence,
      covered_through_sequence: workbenchRecovery.covered_through_sequence,
      history_visual_evidence_passed: historyVisualMatch !== null,
      history_visual_match: historyVisualMatch?.layouts_match ? true : null,
      history_visual_baseline: panelBaselineRef,
      history_visual_comparison: historyVisualMatch?.mode ?? null,
      history_visual_layouts_match: historyVisualMatch?.layouts_match ?? null,
      panel_terminal_geometry: { cols: panelRecovery.cols, rows: panelRecovery.rows },
      workbench_terminal_geometry: { cols: workbenchRecovery.cols, rows: workbenchRecovery.rows },
      renderer_typography: {
        panel: panelTypography,
        workbench: workbenchTypography,
        panel_returned: returnedPanelTypography,
      },
      history_visual_mean_grid_delta: historyVisualMatch?.meanGridDelta ?? null,
      history_visual_ink_ratio: historyVisualMatch?.recoveredInkRatio ?? null,
      history_visual_baseline_active_grid_ratio: historyVisualMatch?.baselineActiveGridRatio ?? null,
      history_visual_recovered_active_grid_ratio: historyVisualMatch?.recoveredActiveGridRatio ?? null,
      history_visual_ink_ratio_scale: historyVisualMatch?.inkRatioScale ?? null,
      input_probe_ms: inputProbeMs,
      input_probe_marker: markerName,
      interactive_ms: workbenchRecovery.interactive_ms,
    };
  } finally {
    await page.close();
  }
}

async function runRecoverySample({ context, entryURL, fixtureBytes, seeded, surface, temperature, tempDir, sampleIndex, maxInteractiveMs }) {
  const { page, problems } = await openEnvPage(context, entryURL);
  try {
    const notBefore = await selectSurface(page, surface);
    const targetPanel = surface === 'workbench'
      ? workbenchTerminalPanel(page, seeded.workbenchWidgetID)
      : page.locator(`[data-terminal-panel-variant="${surface}"]:visible`);
    await targetPanel.waitFor({ state: 'visible', timeout: 15_000 });
    const sessionButton = targetPanel.locator(`button[data-terminal-session-id="${seeded.sessionID}"]`).first();
    await sessionButton.waitFor({ state: 'visible', timeout: 15_000 });
    await sessionButton.click();
    const targetRuntime = targetPanel.locator(`[data-terminal-runtime-session="${seeded.sessionID}"]`).first();
    const targetCanvas = targetRuntime.locator('.redeven-terminal-surface .floeterm-beamterm-canvas:visible').last();
    await terminalInput(page, targetRuntime);
    await targetCanvas.waitFor({ state: 'visible', timeout: 15_000 });
    let marks;
    try {
      marks = await waitForRecoveryMarks(
        page,
        surface,
        notBefore,
        fixtureBytes,
        pseudonymousTerminalSessionRef(seeded.sessionID),
      );
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
    const preparedHistoryHit = await page.evaluate(({ minimumStart, expectedSessionRef }) => (
      performance.getEntriesByName('redeven:terminal:prepared-history-hit', 'mark').some((entry) => (
        entry.startTime >= minimumStart
        && entry.detail?.session_ref === expectedSessionRef
      ))
    ), {
      minimumStart: notBefore,
      expectedSessionRef: pseudonymousTerminalSessionRef(seeded.sessionID),
    });
    assertTerminalCarrierInteractiveLimit({
      stage: `${temperature}_${surface}`,
      interactiveMs: marks.interactive_ms,
      maxInteractiveMs,
    });
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
    if (fixtureBytes > 0 && !preparedHistoryHit && marks.history_bytes_fetched < seeded.historyBytes) {
      throw new Error(
        'terminal recovery fetched fewer history bytes than the fixture requires '
          + `(fetched=${marks.history_bytes_fetched} required=${seeded.historyBytes})`,
      );
    }
    if (preparedHistoryHit) {
      const maximumDeltaBytes = Math.max(
        terminalHistoryChunkMaxBytes * 4,
        Math.floor(seeded.historyBytes / 4),
      );
      if (marks.history_page_count > 1 || marks.history_bytes_fetched > maximumDeltaBytes) {
        throw new Error(`prepared terminal recovery exceeded the attach-delta budget (pages=${marks.history_page_count} bytes=${marks.history_bytes_fetched} max_bytes=${maximumDeltaBytes})`);
      }
    }
    if (fixtureBytes === 0) {
      await page.waitForFunction(() => Array.from(globalThis.document.querySelectorAll('*')).some((element) => (
        (element.textContent ?? '').trim() === 'History: 0 B'
      )), undefined, { timeout: 10_000 });
    }

    const historyBytes = await waitForHistoryBytes(targetPanel, seeded.historyBytes);
    let historyVisualMatch = null;
    if (seeded.historyVisual) {
      historyVisualMatch = assertTerminalCarrierHistoryVisualEvidence({
        baselineVisual: seeded.historyVisual,
        recoveredVisual: await captureCanvasVisualEvidence(targetCanvas),
        baselineLayout: seeded.historyLayout,
        recoveredLayout: { cols: marks.cols, rows: marks.rows },
      });
    }
    const markerPath = path.join(tempDir, `input-${temperature}-${surface}-${sampleIndex}`);
    const probeStarted = performance.now();
    await sendTerminalCommand(
      page,
      `printf packaged-input-ok > ${shellQuote(markerPath)}`,
      targetRuntime,
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
      prepared_history_hit: preparedHistoryHit,
      input_probe_ms: inputProbeMs,
      history_visual_evidence_passed: historyVisualMatch !== null,
      history_visual_match: historyVisualMatch?.layouts_match ? true : null,
      history_visual_comparison: historyVisualMatch?.mode ?? null,
      history_visual_layouts_match: historyVisualMatch?.layouts_match ?? null,
      history_visual_mean_grid_delta: historyVisualMatch?.meanGridDelta ?? null,
      history_visual_ink_ratio: historyVisualMatch?.recoveredInkRatio ?? null,
      history_visual_baseline_active_grid_ratio: historyVisualMatch?.baselineActiveGridRatio ?? null,
      history_visual_recovered_active_grid_ratio: historyVisualMatch?.recoveredActiveGridRatio ?? null,
      history_visual_ink_ratio_scale: historyVisualMatch?.inkRatioScale ?? null,
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

const carrierProgress = {
  runner: null,
  sharedPreparedHistorySamples: [],
};

async function main(options) {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const tempDir = await mkdtemp(path.join(tempRoot, 'redeven-terminal-carrier-'));
  let runtime = null;
  let browser = null;
  try {
    runtime = await runStage('runtime_start', () => startRuntime(tempDir));
    const entryURL = new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).toString();
    browser = await runStage('browser_launch', () => chromium.launch({
      headless: false,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    }));
    carrierProgress.runner = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      chromium: browser.version(),
      cpu_count: os.cpus().length,
      browser_driver_diagnostic_count: 0,
    };
    const reusedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const seed = await openEnvPage(reusedContext, entryURL);
    await seed.page.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await seed.page.locator('[data-terminal-panel-variant="workbench"]:visible').first()
      .waitFor({ state: 'visible', timeout: 15_000 });
    const seeded = await runStage('fixture_seed', () => seedRetainedSession(seed.page, tempDir, options.fixtureBytes));
    assertPageHealthy(seed.problems);
    await seed.page.close();

    const sharedPreparedHistorySamples = [];
    for (let sampleIndex = 1; sampleIndex <= options.sharedPreparedSamples; sampleIndex += 1) {
      const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const sample = await runStage(
          `shared_prepared_history_${sampleIndex}`,
          () => runSharedPreparedHistorySample({
            context: sharedContext,
            entryURL,
            fixtureBytes: options.fixtureBytes,
            seeded,
            tempDir,
            sampleIndex,
            maxInteractiveMs: options.maxInteractiveMs,
          }),
        );
        const completedSample = { ...sample, sample_index: sampleIndex };
        sharedPreparedHistorySamples.push(completedSample);
        carrierProgress.sharedPreparedHistorySamples.push(completedSample);
      } finally {
        await sharedContext.close();
      }
    }
    const sharedPreparedHistory = sharedPreparedHistorySamples[0];
    const sharedPreparedHistoryP95Ms = assertTerminalCarrierP95Limit({
      stage: 'shared_prepared_history',
      values: sharedPreparedHistorySamples.map((sample) => sample.interactive_ms),
      maxP95Ms: options.maxSharedPreparedP95Ms,
    });

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
      runner: carrierProgress.runner,
      fixture: {
        id: fixtureID(options.fixtureBytes),
        requested_bytes: options.fixtureBytes,
        retained_bytes_after_seed: seeded.historyBytes,
        rendered_history_label: seeded.historyLabel,
      },
      sample_plan: {
        shared_prepared_history: options.sharedPreparedSamples,
        reused_context_per_surface: options.reusedContextSamples,
        fresh_context_per_surface: options.freshContextSamples,
      },
      threshold: {
        max_interactive_ms: options.maxInteractiveMs > 0 ? options.maxInteractiveMs : null,
        enforced: options.maxInteractiveMs > 0,
        max_shared_prepared_history_p95_ms: options.maxSharedPreparedP95Ms > 0
          ? options.maxSharedPreparedP95Ms
          : null,
        shared_prepared_history_p95_enforced: options.maxSharedPreparedP95Ms > 0,
      },
      shared_prepared_history: sharedPreparedHistory,
      shared_prepared_history_summary: {
        sample_count: sharedPreparedHistorySamples.length,
        interactive_p95_ms: sharedPreparedHistoryP95Ms,
      },
      shared_prepared_history_samples: sharedPreparedHistorySamples,
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
const maxSharedPreparedP95Ms = parsePositiveInteger(
  readOption(args, '--max-shared-prepared-p95-ms', '0'),
  '--max-shared-prepared-p95-ms',
  { allowZero: true },
);
const reusedContextSamples = parsePositiveInteger(
  readOption(args, '--reused-context-samples', '1'),
  '--reused-context-samples',
  { allowZero: true },
);
const sharedPreparedSamples = parsePositiveInteger(
  readOption(args, '--shared-prepared-samples', '1'),
  '--shared-prepared-samples',
);
const freshContextSamples = parsePositiveInteger(
  readOption(args, '--fresh-context-samples', '1'),
  '--fresh-context-samples',
  { allowZero: true },
);

main({
  fixtureBytes,
  maxInteractiveMs,
  maxSharedPreparedP95Ms,
  sharedPreparedSamples,
  reusedContextSamples,
  freshContextSamples,
})
  .then(async (report) => {
    await writeReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  })
  .catch(async (error) => {
    const formattedError = error instanceof Error ? formatErrorWithCauses(error) : String(error);
    const failure = {
      schema_version: 1,
      status: 'failed',
      error_code: 'terminal_carrier_e2e_failed',
      error_stage: error instanceof TerminalCarrierStageError ? error.stage : 'unknown',
      error: formattedError,
      fixture: { id: fixtureID(fixtureBytes), requested_bytes: fixtureBytes },
      threshold: {
        max_interactive_ms: maxInteractiveMs > 0 ? maxInteractiveMs : null,
        max_shared_prepared_history_p95_ms: maxSharedPreparedP95Ms > 0
          ? maxSharedPreparedP95Ms
          : null,
      },
      runner: carrierProgress.runner,
      shared_prepared_history_summary: {
        sample_count: carrierProgress.sharedPreparedHistorySamples.length,
        interactive_p95_ms: assertTerminalCarrierP95Limit({
          stage: 'shared_prepared_history_partial',
          values: carrierProgress.sharedPreparedHistorySamples.map((sample) => sample.interactive_ms),
          maxP95Ms: 0,
        }),
      },
      shared_prepared_history_samples: carrierProgress.sharedPreparedHistorySamples,
    };
    await writeReport(reportPath, failure).catch(() => undefined);
    console.error(formattedError);
    process.exitCode = 1;
  });
