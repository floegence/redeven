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
  assertTerminalCarrierInteractiveLimit,
  assertTerminalCarrierP95Limit,
  terminalCarrierSampleMarkerName,
} from './terminalCarrierThreshold.mjs';
import { installReDevPluginRuntimeFixture } from './redevpluginRuntimeFixture.mjs';
import {
  classifyTerminalCarrierConsoleMessage,
  resolveTerminalCarrierBrowserMode,
} from './terminalCarrierRunnerPolicy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const defaultFixtureBytes = 64 * 1024;
const semanticCanvasSelector = '[data-terminal-semantic-canvas="true"]';
const semanticInputSelector = 'textarea[data-terminal-input-bridge="semantic"]';

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchTerminalWheel(canvas, deltaY) {
  const handled = await canvas.evaluate((element, delta) => {
    const event = new globalThis.WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, deltaY);
  if (!handled) throw new Error(`terminal wheel event was not handled: deltaY=${deltaY}`);
}

async function showLatestHistory(runtime) {
  const scrollbar = runtime.locator('[data-floeterm-scrollbar][data-visible="true"]');
  await scrollbar.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(new globalThis.PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.right - 1,
      clientY: bounds.bottom - 1,
    }));
  });
  await runtime.evaluate(async (element) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (element.getAttribute('data-terminal-history-projected') === 'false'
        && element.getAttribute('data-terminal-history-busy') === 'false') return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('semantic history did not return to the live Presentation');
  });
}

async function waitForFile(filePath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await stat(filePath)).isFile()) return;
    } catch {
      // The command has not written its marker yet.
    }
    await delay(50);
  }
  throw new Error(`terminal command marker was not created: ${path.basename(filePath)}`);
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
      throw new Error(`runtime exited before readiness\n${childState.stdout}\n${childState.stderr}`);
    }
    try {
      const parsed = JSON.parse(await readFile(reportPath, 'utf8'));
      if (parsed?.status === 'ready' && typeof parsed.local_ui_url === 'string') return parsed;
      if (parsed?.status === 'blocked' || parsed?.status === 'failed') {
        throw new Error(`runtime startup report status is ${parsed.status}`);
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
  throw new Error('runtime startup report timed out');
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
  await runCommand('go', ['build', '-tags', 'floeterm_native', '-o', binaryPath, './cmd/redeven'], {
    env: { ...process.env, GOWORK: 'off', CGO_ENABLED: '1' },
  });
  await installReDevPluginRuntimeFixture(tempDir);
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
  child.once('error', (error) => { state.stderr += error.message; });
  const runtime = { child, state, startup: null, stateRoot };
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

async function selectSurface(page, surface) {
  if (surface === 'workbench') {
    const tab = page.getByRole('tab', { name: 'Workbench', exact: true });
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    const panel = page.locator('[data-terminal-panel-variant="workbench"]:visible');
    await panel.last().waitFor({ state: 'visible', timeout: 15_000 });
    return panel.last();
  }
  const tab = page.getByRole('tab', { name: 'Activity', exact: true });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  const panel = page.locator('[data-terminal-panel-variant="panel"]:visible');
  if (!(await panel.count())) {
    const terminalActivity = page.locator('nav[data-floe-shell-slot="activity-bar"] button').first();
    await terminalActivity.waitFor({ state: 'visible', timeout: 10_000 });
    await terminalActivity.click();
  }
  await panel.last().waitFor({ state: 'visible', timeout: 15_000 });
  return panel.last();
}

async function terminalInput(scope, waitForInteractive = true) {
  const canvas = scope.locator(`${semanticCanvasSelector}:visible`).last();
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const runtime = canvas.locator('xpath=ancestor::*[@data-terminal-runtime-session][1]');
  if (waitForInteractive) {
    await runtime.waitFor({ state: 'attached', timeout: 15_000 });
    await runtime.evaluate(async (element) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (element.getAttribute('aria-busy') === 'false'
          && Number(element.getAttribute('data-terminal-presentation-sequence')) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`semantic terminal did not become interactive: ${JSON.stringify({
        aria_busy: element.getAttribute('aria-busy'),
        sequence: element.getAttribute('data-terminal-presentation-sequence'),
        geometry_sequence: element.getAttribute('data-terminal-geometry-sequence'),
        renderer: element.getAttribute('data-terminal-renderer'),
        error: element.querySelector('[data-terminal-semantic-error="true"]')?.textContent ?? '',
      })}`);
    });
  }
  const input = runtime.locator(semanticInputSelector);
  await input.waitFor({ state: 'attached', timeout: 15_000 });
  await input.evaluate((element) => element.focus({ preventScroll: true }));
  return { input, runtime, canvas };
}

async function sendTerminalCommand(page, command, scope) {
  const { input } = await terminalInput(scope, true);
  await input.focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

async function runtimeTrace(runtime) {
  return runtime.evaluate((element) => {
    const canvas = element.querySelector('[data-terminal-semantic-canvas="true"]');
    const input = element.querySelector('textarea[data-terminal-input-bridge="semantic"]');
    const numeric = (name) => Number(element.getAttribute(name));
    if (canvas?.tagName !== 'CANVAS' || input?.tagName !== 'TEXTAREA') {
      throw new Error('semantic terminal surface is incomplete');
    }
    const bounds = canvas.getBoundingClientRect();
    const host = canvas.parentElement;
    const hostBounds = host?.getBoundingClientRect() ?? bounds;
    const hostLayoutWidth = host?.clientWidth ?? canvas.clientWidth;
    const hostLayoutHeight = host?.clientHeight ?? canvas.clientHeight;
    const inputBounds = input.getBoundingClientRect();
    const layoutWidth = canvas.clientWidth;
    const layoutHeight = canvas.clientHeight;
    const visualScaleX = layoutWidth > 0 ? bounds.width / layoutWidth : 1;
    const visualScaleY = layoutHeight > 0 ? bounds.height / layoutHeight : 1;
    const trace = {
      sequence: numeric('data-terminal-presentation-sequence'),
      content_epoch: numeric('data-terminal-content-epoch'),
      frame_cols: numeric('data-terminal-frame-cols'),
      frame_rows: numeric('data-terminal-frame-rows'),
      buffer_kind: element.getAttribute('data-terminal-buffer-kind'),
      geometry_generation: numeric('data-terminal-geometry-generation'),
      geometry_sequence: numeric('data-terminal-geometry-sequence'),
      geometry_cols: numeric('data-terminal-geometry-cols'),
      geometry_rows: numeric('data-terminal-geometry-rows'),
      controller_epoch: numeric('data-terminal-controller-epoch'),
      is_controller: element.getAttribute('data-terminal-is-controller') === 'true',
      connected: element.getAttribute('data-terminal-connected') === 'true',
      session_active: element.getAttribute('data-terminal-session-active') === 'true',
      view_active: element.getAttribute('data-terminal-view-active') === 'true',
      visibility_commit: canvas.dataset.terminalVisibilityCommit ?? '',
      semantic_error: element.querySelector('[data-terminal-semantic-error="true"]')?.textContent ?? '',
      history_error: element.querySelector('[data-terminal-semantic-history-error="true"]')?.textContent ?? '',
      history_error_detail: element.querySelector('[data-terminal-semantic-history-error="true"]')
        ?.getAttribute('data-terminal-semantic-history-error-detail') ?? '',
      history_projected: element.getAttribute('data-terminal-history-projected') === 'true',
      history_busy: element.getAttribute('data-terminal-history-busy') === 'true',
      history_offset: numeric('data-terminal-history-offset'),
      history_request_count: numeric('data-terminal-history-request-count'),
      history_request_direction: element.getAttribute('data-terminal-history-request-direction') ?? '',
      history_request_state: element.getAttribute('data-terminal-history-request-state') ?? '',
      history_request_revision: numeric('data-terminal-history-request-revision'),
      history_request_offset: numeric('data-terminal-history-request-offset'),
      workbench_selected: element.closest('[data-terminal-panel-variant]')
        ?.getAttribute('data-terminal-workbench-selected') === 'true',
      cell_width: Number(canvas.dataset.terminalCellWidth),
      cell_height: Number(canvas.dataset.terminalCellHeight),
      canvas_count: element.querySelectorAll('canvas').length,
      semantic_canvas_count: element.querySelectorAll('[data-terminal-semantic-canvas="true"]').length,
      legacy_canvas_count: element.querySelectorAll('.floeterm-beamterm-canvas').length,
      renderer: element.getAttribute('data-terminal-renderer'),
      canvas_css: [bounds.width, bounds.height],
      canvas_layout: [layoutWidth, layoutHeight],
      canvas_backing: [canvas.width, canvas.height],
      host_css: [hostBounds.width, hostBounds.height],
      visual_scale: [visualScaleX, visualScaleY],
      input_size: [inputBounds.width, inputBounds.height],
      dpr: globalThis.devicePixelRatio,
    };
    trace.measured_cols = Math.max(2, Math.min(500, Math.floor(hostLayoutWidth / trace.cell_width)));
    trace.measured_rows = Math.max(1, Math.min(200, Math.floor(hostLayoutHeight / trace.cell_height)));
    const sessionID = element.getAttribute('data-terminal-runtime-session');
    trace.peer_controllers = [...globalThis.document.querySelectorAll('[data-terminal-runtime-session]')]
      .filter((peer) => peer.getAttribute('data-terminal-runtime-session') === sessionID)
      .map((peer) => ({
        variant: peer.closest('[data-terminal-panel-variant]')?.getAttribute('data-terminal-panel-variant') ?? '',
        selected: peer.closest('[data-terminal-panel-variant]')
          ?.getAttribute('data-terminal-workbench-selected') === 'true',
        session_active: peer.getAttribute('data-terminal-session-active') === 'true',
        view_active: peer.getAttribute('data-terminal-view-active') === 'true',
        controller_epoch: Number(peer.getAttribute('data-terminal-controller-epoch')),
        is_controller: peer.getAttribute('data-terminal-is-controller') === 'true',
      }));
    if (trace.canvas_count !== 1 || trace.semantic_canvas_count !== 1 || trace.legacy_canvas_count !== 0) {
      throw new Error(`terminal must own one semantic canvas: ${JSON.stringify(trace)}`);
    }
    if (trace.renderer !== 'semantic') throw new Error('terminal renderer identity is not semantic');
    if (!Number.isSafeInteger(trace.sequence) || trace.sequence <= 0) throw new Error('terminal sequence is invalid');
    if (trace.frame_cols !== trace.geometry_cols || trace.frame_rows !== trace.geometry_rows) {
      throw new Error(`Presentation/frame geometry is not canonical: ${JSON.stringify(trace)}`);
    }
    if (trace.sequence < trace.geometry_sequence) {
      throw new Error(`Presentation has not settled the latest geometry: ${JSON.stringify(trace)}`);
    }
    if (trace.canvas_backing[0] !== Math.round(trace.canvas_layout[0] * trace.dpr)
      || trace.canvas_backing[1] !== Math.round(trace.canvas_layout[1] * trace.dpr)) {
      throw new Error(`canvas backing does not match its layout box and DPR: ${JSON.stringify(trace)}`);
    }
    if (Math.abs(trace.canvas_css[0] - trace.host_css[0]) > 1
      || Math.abs(trace.canvas_css[1] - trace.host_css[1]) > 1) {
      throw new Error(`semantic canvas does not fill its transformed host: ${JSON.stringify(trace)}`);
    }
    if (Math.abs(trace.input_size[0] - trace.cell_width * trace.visual_scale[0]) > 1
      || Math.abs(trace.input_size[1] - trace.cell_height * trace.visual_scale[1]) > 1) {
      throw new Error(`IME anchor does not match semantic cell metrics: ${JSON.stringify(trace)}`);
    }
    return trace;
  });
}

async function waitForTrace(runtime, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  const transitions = [];
  let previousTransition = '';
  while (Date.now() < deadline) {
    try {
      last = await runtimeTrace(runtime);
      const transition = JSON.stringify({
        sequence: last.sequence,
        geometry: [last.geometry_cols, last.geometry_rows],
        controller: [last.controller_epoch, last.is_controller],
        active: [last.session_active, last.view_active, last.workbench_selected],
        error: last.semantic_error,
      });
      if (transition !== previousTransition) {
        transitions.push(JSON.parse(transition));
        previousTransition = transition;
      }
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }
    await delay(25);
  }
  throw new Error(`semantic terminal trace did not converge: ${JSON.stringify({ last, transitions })}`);
}

async function waitForViewsToConverge(page, sessionID, minimumSequence = 1, timeoutMs = 15_000) {
  const runtimes = page.locator(`[data-terminal-runtime-session="${sessionID}"]`);
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const count = await runtimes.count();
    last = [];
    for (let index = 0; index < count; index += 1) {
      const runtime = runtimes.nth(index);
      const sequence = Number(await runtime.getAttribute('data-terminal-presentation-sequence'));
      const epoch = Number(await runtime.getAttribute('data-terminal-content-epoch'));
      const cols = Number(await runtime.getAttribute('data-terminal-frame-cols'));
      const rows = Number(await runtime.getAttribute('data-terminal-frame-rows'));
      last.push({ sequence, epoch, cols, rows });
    }
    if (last.length >= 2
      && last.every((trace) => trace.sequence >= minimumSequence)
      && last.every((trace) => trace.sequence === last[0].sequence)
      && last.every((trace) => trace.epoch === last[0].epoch)
      && last.every((trace) => trace.cols === last[0].cols && trace.rows === last[0].rows)) {
      return last;
    }
    await delay(25);
  }
  throw new Error(`Activity and Workbench did not converge on one Presentation: ${JSON.stringify(last)}`);
}

async function waitForRuntimePairToConverge(first, second, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let stableKey = '';
  let stableSamples = 0;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const firstTrace = await runtimeTrace(first);
      const secondTrace = await runtimeTrace(second);
      last = { first: firstTrace, second: secondTrace };
      const key = JSON.stringify({
        sequence: firstTrace.sequence,
        geometry: [firstTrace.frame_cols, firstTrace.frame_rows],
        controller_epoch: firstTrace.controller_epoch,
      });
      const matches = firstTrace.sequence === secondTrace.sequence
        && firstTrace.frame_cols === secondTrace.frame_cols
        && firstTrace.frame_rows === secondTrace.frame_rows
        && firstTrace.controller_epoch === secondTrace.controller_epoch;
      if (matches) {
        stableSamples = key === stableKey ? stableSamples + 1 : 1;
        stableKey = key;
        if (stableSamples >= 3) return [firstTrace, secondTrace];
      } else {
        stableKey = '';
        stableSamples = 0;
      }
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
      stableKey = '';
      stableSamples = 0;
    }
    await delay(50);
  }
  throw new Error(`semantic terminal views did not converge: ${JSON.stringify(last)}`);
}

function analyzeCanvas(imageBuffer) {
  const image = PNG.sync.read(imageBuffer);
  let transparent = 0;
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] !== 255) transparent += 1;
    colors.add(`${image.data[offset] >> 3}:${image.data[offset + 1] >> 3}:${image.data[offset + 2] >> 3}`);
  }
  return {
    width: image.width,
    height: image.height,
    transparent_pixels: transparent,
    color_count: colors.size,
    hash: sha256(imageBuffer),
  };
}

async function canvasEvidence(canvas) {
  const evidence = analyzeCanvas(await canvas.screenshot({ animations: 'disabled' }));
  if (evidence.transparent_pixels !== 0 || evidence.color_count < 2) {
    throw new Error(`semantic canvas is blank or transparent: ${JSON.stringify(evidence)}`);
  }
  return evidence;
}

async function activateSession(panel, sessionID) {
  const button = panel.locator(`button[data-terminal-session-id="${sessionID}"]`).first();
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  if (await button.getAttribute('data-terminal-session-active') !== 'true') await button.click();
  const runtime = panel.locator(`[data-terminal-runtime-session="${sessionID}"]`).first();
  const { canvas } = await terminalInput(runtime, true);
  await canvas.click({ position: { x: 2, y: 2 } });
  await waitForTrace(runtime, (trace) => (
    trace.is_controller
    && trace.controller_epoch > 0
    && trace.geometry_cols === trace.measured_cols
    && trace.geometry_rows === trace.measured_rows
  ));
  return runtime;
}

async function createSession(page, panel) {
  const createButton = panel.getByRole('button', { name: 'Create session', exact: true });
  if (await createButton.count()) await createButton.click();
  else await panel.locator('[data-testid="terminal-sidebar-add-session"]:visible').first().click();
  const { runtime } = await terminalInput(panel, true);
  const sessionID = await runtime.getAttribute('data-terminal-runtime-session');
  if (!sessionID) throw new Error('created terminal has no session identity');
  return { sessionID, runtime };
}

async function verifyAtomicClear(page, panel, sessionID, tempDir) {
  const activeRuntime = panel.locator(`[data-terminal-runtime-session="${sessionID}"]`).first();
  const before = await waitForViewsToConverge(page, sessionID);
  const beforeCanvas = await canvasEvidence(activeRuntime.locator(semanticCanvasSelector));
  const clearButton = panel.locator('[data-testid="terminal-clear-active-session"]:visible').last();
  await clearButton.click();
  await clearButton.evaluate(async (element) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (element.getAttribute('data-terminal-clear-state') === 'idle' && !element.hasAttribute('disabled')) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('semantic clear did not settle');
  });
  const after = await waitForViewsToConverge(page, sessionID, before[0].sequence + 1);
  if (after[0].epoch <= before[0].epoch) throw new Error('semantic clear did not advance content epoch');
  const afterCanvas = await canvasEvidence(activeRuntime.locator(semanticCanvasSelector));
  if (afterCanvas.hash === beforeCanvas.hash) throw new Error('semantic clear did not repaint the visible Presentation');
  const marker = path.join(tempDir, 'clear-input-ok');
  await sendTerminalCommand(page, `printf ok > ${shellQuote(marker)}`, activeRuntime);
  await waitForFile(marker);
  return { before: before[0], after: after[0] };
}

async function seedHistory(page, panel, runtime, fixtureBytes, tempDir) {
  const lineCount = Math.max(64, Math.ceil(fixtureBytes / 64));
  const searchLineIndex = Math.min(512, lineCount - 1);
  const searchMarker = `semantic-history-${String(searchLineIndex).padStart(6, '0')}`;
  const marker = path.join(tempDir, 'semantic-history-seeded');
  const before = await waitForTrace(runtime, () => true);
  const command = `i=0; while [ $i -lt ${lineCount} ]; do printf 'semantic-history-%06d abcdefghijklmnopqrstuvwxyz\\n' "$i"; i=$((i+1)); done; printf ok > ${shellQuote(marker)}`;
  await sendTerminalCommand(page, command, runtime);
  await waitForFile(marker, 30_000);
  const after = await waitForTrace(runtime, (trace) => trace.sequence > before.sequence, 30_000);
  const historyRows = panel.locator('[data-terminal-history-rows]').last();
  await historyRows.evaluate(async (element, minimumRows) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (Number(element.getAttribute('data-terminal-history-rows')) > minimumRows) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('semantic history rows did not exceed the visible frame');
  }, after.frame_rows);
  const canvas = runtime.locator(semanticCanvasSelector);
  const beforeHistoryTrace = await runtimeTrace(runtime);
  if (!beforeHistoryTrace.connected) {
    throw new Error(`protocol disconnected before semantic history browse: ${JSON.stringify(beforeHistoryTrace)}`);
  }
  const beforeScroll = await canvasEvidence(canvas);
  await dispatchTerminalWheel(canvas, -720);
  await panel.locator('[data-floeterm-scrollbar][data-visible="true"]').waitFor({ state: 'attached', timeout: 10_000 });
  let afterScroll = beforeScroll;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && afterScroll.hash === beforeScroll.hash) {
    await delay(50);
    afterScroll = await canvasEvidence(canvas);
  }
  if (afterScroll.hash === beforeScroll.hash) throw new Error('semantic history projection did not repaint the viewport');
  const afterScrollTrace = await runtimeTrace(runtime);
  if (!afterScrollTrace.connected || !afterScrollTrace.history_projected) {
    throw new Error(`semantic history projection did not settle: ${JSON.stringify(afterScrollTrace)}`);
  }
  const projectedTrace = await waitForTrace(runtime, () => true);
  if (projectedTrace.sequence !== after.sequence) {
    throw new Error('view-local history projection changed the authoritative Presentation sequence');
  }

  const projectedHashes = [afterScroll.hash];
  for (const deltaY of [720]) {
    const previousHash = projectedHashes.at(-1);
    await dispatchTerminalWheel(canvas, deltaY);
    const scrollDeadline = Date.now() + 10_000;
    let nextEvidence = await canvasEvidence(canvas);
    while (Date.now() < scrollDeadline && nextEvidence.hash === previousHash) {
      await delay(50);
      nextEvidence = await canvasEvidence(canvas);
    }
    if (nextEvidence.hash === previousHash) {
      const historyTrace = await panel.evaluate((root) => {
        const scrollbar = root.querySelector('[data-floeterm-scrollbar]');
        return {
          value: scrollbar?.getAttribute('aria-valuenow') ?? '',
          maximum: scrollbar?.getAttribute('aria-valuemax') ?? '',
          localError: root.querySelector('[data-terminal-semantic-history-error="true"]')?.textContent ?? '',
          localErrorDetail: root.querySelector('[data-terminal-semantic-history-error="true"]')
            ?.getAttribute('data-terminal-semantic-history-error-detail') ?? '',
          blockingError: root.querySelector('[data-terminal-semantic-error="true"]')?.textContent ?? '',
        };
      });
      throw new Error(`semantic history wheel ${deltaY < 0 ? 'backward' : 'forward'} did not repaint: ${JSON.stringify(historyTrace)}`);
    }
    projectedHashes.push(nextEvidence.hash);
  }

  const beforeBurst = await runtimeTrace(runtime);
  for (const deltaY of [-80, -160, 120, -240, 300, -120]) {
    await dispatchTerminalWheel(canvas, deltaY);
  }
  const afterBurst = await waitForTrace(runtime, (trace) => (
    !trace.history_busy
    && trace.history_projected
    && trace.history_request_state === 'settled'
    && trace.history_request_direction === 'backward'
    && trace.history_request_count >= beforeBurst.history_request_count + 2
  ));
  if (afterBurst.history_error || afterBurst.semantic_error) {
    throw new Error(`continuous semantic history wheel failed: ${JSON.stringify(afterBurst)}`);
  }

  const liveDuringHistoryMarker = path.join(tempDir, 'history-live-output-ok');
  const liveSequenceBefore = afterBurst.sequence;
  await sendTerminalCommand(
    page,
    `printf 'semantic-live-during-history\\n'; printf ok > ${shellQuote(liveDuringHistoryMarker)}`,
    runtime,
  );
  await waitForFile(liveDuringHistoryMarker);
  const liveDuringHistory = await waitForTrace(runtime, (trace) => (
    trace.sequence > liveSequenceBefore
    && trace.history_projected
    && !trace.history_busy
  ));
  if (liveDuringHistory.history_error || liveDuringHistory.semantic_error) {
    throw new Error(`live output broke semantic history projection: ${JSON.stringify(liveDuringHistory)}`);
  }
  await showLatestHistory(runtime);
  const returnedLive = await waitForTrace(runtime, (trace) => (
    !trace.history_projected
    && trace.sequence === liveDuringHistory.sequence
  ));

  const { input } = await terminalInput(runtime, true);
  await input.focus();
  await page.keyboard.press('Meta+f');
  const searchState = panel.locator('[data-terminal-search-state]:visible').last();
  await searchState.waitFor({ state: 'visible', timeout: 10_000 });
  const searchInput = searchState.locator('..').locator('input').first();
  await searchInput.fill(searchMarker);
  await searchState.evaluate(async (element) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const state = element.getAttribute('data-terminal-search-state');
      if (state === 'ready') return;
      if (state === 'error') throw new Error(`semantic history search failed: ${element.textContent ?? ''}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('semantic history search did not settle');
  });
  if (!/^1\s*\/\s*1$/u.test((await searchState.textContent())?.trim() ?? '')) {
    throw new Error(`semantic history search returned an unexpected result count: ${await searchState.textContent()}`);
  }
  await page.keyboard.press('Escape');
  await searchState.waitFor({ state: 'detached', timeout: 10_000 });
  const finalTrace = await waitForTrace(runtime, (trace) => trace.semantic_error === '');
  if (finalTrace.sequence !== returnedLive.sequence) {
    throw new Error('semantic history browse/search changed the authoritative Presentation sequence');
  }
  return {
    requested_bytes: fixtureBytes,
    generated_rows: lineCount,
    total_rows: Number(await historyRows.getAttribute('data-terminal-history-rows')),
    presentation_sequence: finalTrace.sequence,
    projected_page_count: projectedHashes.length,
    continuous_wheel: {
      delta_count: 6,
      request_count_before: beforeBurst.history_request_count,
      request_count_after: afterBurst.history_request_count,
      final_direction: afterBurst.history_request_direction,
      final_offset: afterBurst.history_offset,
    },
    live_during_projection: {
      sequence_before: liveSequenceBefore,
      sequence_after: liveDuringHistory.sequence,
      returned_live_sequence: returnedLive.sequence,
    },
    search_marker: searchMarker,
    search_result_count: 1,
  };
}

async function verifyIndependentHistoryProjection(context, entryURL, page, sessionID) {
  const workbench = await selectSurface(page, 'workbench');
  const workbenchRuntime = await activateSession(workbench, sessionID);
  const peer = await openEnvPage(context, entryURL);
  try {
    const activity = await selectSurface(peer.page, 'panel');
    const activityRuntime = await activateSession(activity, sessionID);
    const [workbenchLive, activityLive] = await waitForRuntimePairToConverge(
      workbenchRuntime,
      activityRuntime,
    );
    await showLatestHistory(workbenchRuntime);
    await showLatestHistory(activityRuntime);

    await dispatchTerminalWheel(workbenchRuntime.locator(semanticCanvasSelector), -720);
    const workbenchProjected = await waitForTrace(workbenchRuntime, (trace) => (
      trace.history_projected && !trace.history_busy
    ));
    if (await activityRuntime.getAttribute('data-terminal-history-projected') !== 'false') {
      throw new Error('Workbench history projection leaked into the Activity view');
    }

    await dispatchTerminalWheel(activityRuntime.locator(semanticCanvasSelector), -720);
    const activityProjected = await waitForTrace(activityRuntime, (trace) => (
      trace.history_projected && !trace.history_busy
    ));
    await dispatchTerminalWheel(activityRuntime.locator(semanticCanvasSelector), -720);
    const activityAdvanced = await waitForTrace(activityRuntime, (trace) => (
      trace.history_projected
      && !trace.history_busy
      && trace.history_request_count > activityProjected.history_request_count
    ));
    const unchangedWorkbench = await runtimeTrace(workbenchRuntime);
    if (!unchangedWorkbench.history_projected
      || unchangedWorkbench.history_offset !== workbenchProjected.history_offset) {
      throw new Error('Activity history projection overwrote the Workbench projection');
    }
    if (activityAdvanced.sequence !== workbenchProjected.sequence
      || activityAdvanced.sequence !== workbenchLive.sequence
      || activityAdvanced.sequence !== activityLive.sequence) {
      throw new Error('view-local history projection changed the shared live Presentation');
    }

    await showLatestHistory(activityRuntime);
    await showLatestHistory(workbenchRuntime);
    assertPageHealthy(peer.problems);
    return {
      presentation_sequence: workbenchLive.sequence,
      workbench_offset: workbenchProjected.history_offset,
      activity_offset: activityAdvanced.history_offset,
      retained_workbench_offset: unchangedWorkbench.history_offset,
      independent: true,
    };
  } finally {
    await peer.page.close();
  }
}

async function verifyTopResize(page, runtime, maxResizeMs) {
  await sendTerminalCommand(page, 'top', runtime);
  const alternate = await waitForTrace(runtime, (trace) => trace.buffer_kind === 'alternate', 15_000);
  const durations = [];
  let previousSequence = alternate.sequence;
  for (let index = 0; index < 20; index += 1) {
    const width = index % 2 === 0 ? 1180 + index * 3 : 1430 - index * 2;
    const height = index % 3 === 0 ? 760 + index : 900 - index;
    const started = performance.now();
    await page.setViewportSize({ width, height });
    const trace = await waitForTrace(runtime, (value) => (
      value.sequence >= previousSequence
      && value.frame_cols === value.geometry_cols
      && value.frame_rows === value.geometry_rows
      && value.sequence >= value.geometry_sequence
    ));
    const duration = performance.now() - started;
    assertTerminalCarrierInteractiveLimit({
      stage: `top_resize_${index + 1}`,
      interactiveMs: duration,
      maxInteractiveMs: maxResizeMs,
    });
    durations.push(duration);
    previousSequence = trace.sequence;
  }
  const { input } = await terminalInput(runtime, true);
  await input.focus();
  await page.keyboard.press('Control+C');
  await waitForTrace(runtime, (trace) => trace.buffer_kind === 'normal' && trace.sequence >= previousSequence);
  return durations;
}

async function verifyRefresh(page, panel, sessionID) {
  const runtime = panel.locator(`[data-terminal-runtime-session="${sessionID}"]`).first();
  const canvas = runtime.locator(semanticCanvasSelector);
  const beforeCanvas = await canvas.elementHandle();
  const before = await runtimeTrace(runtime);
  const refresh = panel.locator('[data-testid="terminal-sidebar-refresh"]:visible').last();
  await refresh.click();
  await refresh.evaluate(async (element) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!element.hasAttribute('disabled')) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('terminal refresh did not settle');
  });
  const after = await waitForTrace(runtime, (trace) => trace.sequence >= before.sequence);
  const preservedCanvas = await beforeCanvas.evaluate((element) => {
    const owner = element.closest('[data-terminal-runtime-session]');
    return element.isConnected
      && owner?.querySelectorAll('[data-terminal-semantic-canvas="true"]').length === 1
      && owner.querySelector('[data-terminal-semantic-canvas="true"]') === element;
  });
  if (!preservedCanvas) throw new Error('refresh replaced the semantic canvas');
  return { before_sequence: before.sequence, after_sequence: after.sequence };
}

async function verifyTabSwitchPaintSafety(page, panel, primarySessionID) {
  const created = [primarySessionID];
  for (let index = 0; index < 2; index += 1) {
    created.push((await createSession(page, panel)).sessionID);
  }
  await activateSession(panel, primarySessionID);
  const identities = await panel.evaluate((root, sessionIDs) => {
    const result = {};
    sessionIDs.forEach((sessionID, index) => {
      const runtime = root.querySelector(`[data-terminal-runtime-session="${sessionID}"]`);
      const canvas = runtime?.querySelector('[data-terminal-semantic-canvas="true"]');
      if (!(canvas instanceof globalThis.HTMLCanvasElement)) throw new Error(`missing semantic canvas for ${sessionID}`);
      const identity = `carrier-tab-canvas-${index + 1}`;
      canvas.dataset.terminalCarrierCanvasIdentity = identity;
      result[sessionID] = {
        identity,
        cellWidth: canvas.dataset.terminalCellWidth,
        cellHeight: canvas.dataset.terminalCellHeight,
      };
    });
    return result;
  }, created);

  const samples = [];
  for (let switchIndex = 0; switchIndex < 50; switchIndex += 1) {
    const sessionID = created[switchIndex % created.length];
    const button = panel.locator(`button[data-terminal-session-id="${sessionID}"]`).first();
    await button.click();
    const sample = await panel.evaluate(async (root, args) => {
      const stages = [];
      const collect = (stage) => {
        const runtimes = [...root.querySelectorAll('[data-terminal-runtime-session]')];
        const target = runtimes.find((runtime) => runtime.getAttribute('data-terminal-runtime-session') === args.sessionID);
        if (!target) throw new Error(`missing switched terminal runtime ${args.sessionID}`);
        const traces = runtimes.map((runtime) => {
          const runtimeSessionID = runtime.getAttribute('data-terminal-runtime-session') ?? '';
          const canvas = runtime.querySelector('[data-terminal-semantic-canvas="true"]');
          if (!(canvas instanceof globalThis.HTMLCanvasElement)) throw new Error(`missing semantic canvas for ${runtimeSessionID}`);
          const expected = args.identities[runtimeSessionID];
          const visible = globalThis.getComputedStyle(canvas).visibility === 'visible'
            && canvas.getBoundingClientRect().width > 0
            && canvas.getBoundingClientRect().height > 0;
          if (expected && (canvas.dataset.terminalCarrierCanvasIdentity !== expected.identity
            || canvas.dataset.terminalCellWidth !== expected.cellWidth
            || canvas.dataset.terminalCellHeight !== expected.cellHeight)) {
            throw new Error(`terminal switch replaced its canvas or cell metrics: ${runtimeSessionID}`);
          }
          if (visible && (canvas.width !== Math.round(canvas.clientWidth * globalThis.devicePixelRatio)
            || canvas.height !== Math.round(canvas.clientHeight * globalThis.devicePixelRatio))) {
            throw new Error(`terminal switch exposed a stretched backing: ${runtimeSessionID}`);
          }
          return {
            sessionID: runtimeSessionID,
            active: runtime.getAttribute('data-terminal-session-active') === 'true',
            visible,
            backing: [canvas.width, canvas.height],
            layout: [canvas.clientWidth, canvas.clientHeight],
          };
        });
        stages.push({ stage, traces });
      };
      collect('immediate');
      await Promise.resolve();
      collect('microtask');
      await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      collect('raf_1');
      await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      collect('raf_2');
      const settled = stages.at(-1)?.traces.find((trace) => trace.sessionID === args.sessionID);
      if (!settled?.active || !settled.visible) {
        throw new Error(`switched terminal did not commit visibly: ${JSON.stringify({ args, stages })}`);
      }
      return stages;
    }, { sessionID, identities });
    await activateSession(panel, sessionID);
    samples.push({ switch_index: switchIndex + 1, session_id: sessionID, stages: sample });
  }
  await activateSession(panel, primarySessionID);
  return { session_ids: created, switch_count: samples.length, identities, samples };
}

async function seedProductScenario({ context, entryURL, fixtureBytes, tempDir, maxResizeMs }) {
  const { page, problems } = await openEnvPage(context, entryURL);
  try {
    const workbench = await selectSurface(page, 'workbench');
    const created = await createSession(page, workbench);
    const sessionID = created.sessionID;
    const activity = await selectSurface(page, 'panel');
    const activityRuntime = await activateSession(activity, sessionID);
    const activeWorkbench = await selectSurface(page, 'workbench');
    const workbenchRuntime = await activateSession(activeWorkbench, sessionID);
    const initialViews = await waitForViewsToConverge(page, sessionID);
    const initialInputMarker = path.join(tempDir, 'initial-input-ok');
    await sendTerminalCommand(page, `printf ok > ${shellQuote(initialInputMarker)}`, workbenchRuntime);
    await waitForFile(initialInputMarker);
    const clear = await verifyAtomicClear(page, activeWorkbench, sessionID, tempDir);
    const history = await seedHistory(page, activeWorkbench, workbenchRuntime, fixtureBytes, tempDir);
    const viewsAfterHistory = await waitForViewsToConverge(page, sessionID, history.presentation_sequence);
    const independentHistoryViews = await verifyIndependentHistoryProjection(
      context,
      entryURL,
      page,
      sessionID,
    );

    const activityForInput = await selectSurface(page, 'panel');
    const controllerRuntime = await activateSession(activityForInput, sessionID);
    const controllerMarker = path.join(tempDir, 'activity-controller-input-ok');
    await sendTerminalCommand(page, `printf ok > ${shellQuote(controllerMarker)}`, controllerRuntime);
    await waitForFile(controllerMarker);
    const viewsAfterTakeover = await waitForViewsToConverge(page, sessionID, viewsAfterHistory[0].sequence + 1);

    const workbenchForResize = await selectSurface(page, 'workbench');
    const resizeRuntime = await activateSession(workbenchForResize, sessionID);
    const resizeDurationsMs = await verifyTopResize(page, resizeRuntime, maxResizeMs);
    const refresh = await verifyRefresh(page, workbenchForResize, sessionID);
    const tabSwitches = await verifyTabSwitchPaintSafety(page, workbenchForResize, sessionID);
    const trace = await runtimeTrace(resizeRuntime);
    const canvas = await canvasEvidence(resizeRuntime.locator(semanticCanvasSelector));
    assertPageHealthy(problems);
    return {
      sessionID,
      initial_views: initialViews,
      initial_input: path.basename(initialInputMarker),
      clear,
      history,
      independent_history_views: independentHistoryViews,
      controller_takeover_views: viewsAfterTakeover,
      top_resize_durations_ms: resizeDurationsMs,
      refresh,
      tab_switches: tabSwitches,
      final_trace: trace,
      canvas,
      activity_runtime_present: await activityRuntime.count() === 1,
    };
  } finally {
    await page.close();
  }
}

async function runMultiViewSample({ context, entryURL, sessionID, tempDir, sampleIndex }) {
  const { page, problems } = await openEnvPage(context, entryURL);
  try {
    const activity = await selectSurface(page, 'panel');
    const activityRuntime = await activateSession(activity, sessionID);
    const sourceTrace = await runtimeTrace(activityRuntime);
    const started = performance.now();
    const workbench = await selectSurface(page, 'workbench');
    const workbenchRuntime = await activateSession(workbench, sessionID);
    const converged = await waitForViewsToConverge(page, sessionID);
    const interactiveMs = performance.now() - started;
    const markerName = terminalCarrierSampleMarkerName('semantic-multi-view-input', sampleIndex);
    const markerPath = path.join(tempDir, markerName);
    const beforeSequence = converged[0].sequence;
    await sendTerminalCommand(page, `printf ok > ${shellQuote(markerPath)}`, workbenchRuntime);
    await waitForFile(markerPath);
    const after = await waitForViewsToConverge(page, sessionID, beforeSequence + 1);
    assertPageHealthy(problems);
    return {
      status: 'passed',
      sample_index: sampleIndex,
      interactive_ms: interactiveMs,
      source_sequence: sourceTrace.sequence,
      input_marker: markerName,
      before_sequence: beforeSequence,
      after_sequence: after[0].sequence,
      view_count: after.length,
    };
  } finally {
    await page.close();
  }
}

async function runSurfaceSample({ context, entryURL, sessionID, surface, temperature, tempDir, sampleIndex, maxInteractiveMs }) {
  const { page, problems } = await openEnvPage(context, entryURL);
  try {
    const started = performance.now();
    const panel = await selectSurface(page, surface);
    const runtime = await activateSession(panel, sessionID);
    const trace = await runtimeTrace(runtime);
    const interactiveMs = performance.now() - started;
    assertTerminalCarrierInteractiveLimit({
      stage: `${temperature}_${surface}`,
      interactiveMs,
      maxInteractiveMs,
    });
    const markerName = terminalCarrierSampleMarkerName(`semantic-${temperature}-${surface}`, sampleIndex);
    const markerPath = path.join(tempDir, markerName);
    await sendTerminalCommand(page, `printf ok > ${shellQuote(markerPath)}`, runtime);
    await waitForFile(markerPath);
    const after = await waitForTrace(runtime, (value) => value.sequence > trace.sequence);
    const canvas = await canvasEvidence(runtime.locator(semanticCanvasSelector));
    assertPageHealthy(problems);
    return {
      status: 'passed',
      surface,
      temperature,
      sample_index: sampleIndex,
      interactive_ms: interactiveMs,
      before_sequence: trace.sequence,
      after_sequence: after.sequence,
      canvas,
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

const carrierProgress = { runner: null, multiViewSamples: [] };

async function main(options) {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const tempDir = await mkdtemp(path.join(tempRoot, 'redeven-semantic-terminal-carrier-'));
  let runtime = null;
  let browser = null;
  carrierProgress.runner = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    chromium: null,
    browser_mode: options.browserMode,
  };
  try {
    runtime = await startRuntime(tempDir);
    const entryURL = new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).toString();
    browser = await chromium.launch({
      headless: options.headless,
      args: ['--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    carrierProgress.runner.chromium = browser.version();
    const reusedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const product = await seedProductScenario({
      context: reusedContext,
      entryURL,
      fixtureBytes: options.fixtureBytes,
      tempDir,
      maxResizeMs: options.maxResizeMs,
    });

    const multiViewSamples = [];
    for (let sampleIndex = 1; sampleIndex <= options.multiViewSamples; sampleIndex += 1) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const sample = await runMultiViewSample({
          context,
          entryURL,
          sessionID: product.sessionID,
          tempDir,
          sampleIndex,
        });
        multiViewSamples.push(sample);
        carrierProgress.multiViewSamples.push(sample);
      } finally {
        await context.close();
      }
    }
    const multiViewP95Ms = assertTerminalCarrierP95Limit({
      stage: 'semantic_multi_view',
      values: multiViewSamples.map((sample) => sample.interactive_ms),
      maxP95Ms: options.maxMultiViewP95Ms,
    });

    const samples = [];
    for (const surface of ['workbench', 'panel']) {
      for (let sampleIndex = 1; sampleIndex <= options.reusedContextSamples; sampleIndex += 1) {
        samples.push(await runSurfaceSample({
          context: reusedContext,
          entryURL,
          sessionID: product.sessionID,
          surface,
          temperature: 'reused_context',
          tempDir,
          sampleIndex,
          maxInteractiveMs: options.maxInteractiveMs,
        }));
      }
    }
    await reusedContext.close();

    for (const surface of ['workbench', 'panel']) {
      for (let sampleIndex = 1; sampleIndex <= options.freshContextSamples; sampleIndex += 1) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        try {
          samples.push(await runSurfaceSample({
            context,
            entryURL,
            sessionID: product.sessionID,
            surface,
            temperature: 'fresh_context',
            tempDir,
            sampleIndex,
            maxInteractiveMs: options.maxInteractiveMs,
          }));
        } finally {
          await context.close();
        }
      }
    }

    return {
      schema_version: 2,
      status: 'passed',
      commit: String(process.env.GITHUB_SHA ?? 'local').slice(0, 40),
      runtime: {
        compatibility_epoch: runtime.startup.runtime_service?.compatibility_epoch ?? null,
        effective_run_mode: runtime.startup.effective_run_mode ?? null,
      },
      runner: carrierProgress.runner,
      fixture: { requested_bytes: options.fixtureBytes },
      product,
      threshold: {
        max_interactive_ms: options.maxInteractiveMs > 0 ? options.maxInteractiveMs : null,
        max_multi_view_p95_ms: options.maxMultiViewP95Ms > 0 ? options.maxMultiViewP95Ms : null,
        max_resize_ms: options.maxResizeMs > 0 ? options.maxResizeMs : null,
      },
      multi_view_summary: { sample_count: multiViewSamples.length, interactive_p95_ms: multiViewP95Ms },
      multi_view_samples: multiViewSamples,
      samples,
    };
  } catch (error) {
    throw new Error([
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      runtime?.state.stderr ? `Runtime stderr:\n${runtime.state.stderr}` : '',
      runtime?.state.stdout ? `Runtime stdout:\n${runtime.state.stdout}` : '',
    ].filter(Boolean).join('\n'));
  } finally {
    if (browser) await browser.close();
    await stopRuntime(runtime);
    await rm(tempDir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2).filter((value) => value !== '--');
const browserMode = resolveTerminalCarrierBrowserMode(args);
const reportPath = readOption(args, '--report');
const fixtureBytes = parsePositiveInteger(readOption(args, '--fixture-bytes', String(defaultFixtureBytes)), '--fixture-bytes');
const maxInteractiveMs = parsePositiveInteger(readOption(args, '--max-interactive-ms', '0'), '--max-interactive-ms', { allowZero: true });
const maxMultiViewP95Ms = parsePositiveInteger(readOption(args, '--max-multi-view-p95-ms', '0'), '--max-multi-view-p95-ms', { allowZero: true });
const maxResizeMs = parsePositiveInteger(readOption(args, '--max-resize-ms', '150'), '--max-resize-ms', { allowZero: true });
const reusedContextSamples = parsePositiveInteger(readOption(args, '--reused-context-samples', '1'), '--reused-context-samples', { allowZero: true });
const multiViewSamples = parsePositiveInteger(readOption(args, '--multi-view-samples', '1'), '--multi-view-samples');
const freshContextSamples = parsePositiveInteger(readOption(args, '--fresh-context-samples', '1'), '--fresh-context-samples', { allowZero: true });

main({
  ...browserMode,
  fixtureBytes,
  maxInteractiveMs,
  maxMultiViewP95Ms,
  maxResizeMs,
  multiViewSamples,
  reusedContextSamples,
  freshContextSamples,
}).then(async (report) => {
  await writeReport(reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}).catch(async (error) => {
  const formatted = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const failure = {
    schema_version: 2,
    status: 'failed',
    error_code: 'semantic_terminal_carrier_failed',
    error: formatted,
    fixture: { requested_bytes: fixtureBytes },
    runner: carrierProgress.runner,
    multi_view_summary: {
      sample_count: carrierProgress.multiViewSamples.length,
      interactive_p95_ms: assertTerminalCarrierP95Limit({
        stage: 'semantic_multi_view_partial',
        values: carrierProgress.multiViewSamples.map((sample) => sample.interactive_ms),
        maxP95Ms: 0,
      }),
    },
    multi_view_samples: carrierProgress.multiViewSamples,
  };
  await writeReport(reportPath, failure).catch(() => undefined);
  console.error(formatted);
  process.exitCode = 1;
});
