import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyTerminalCarrierConsoleMessage,
  resolveTerminalCarrierBrowserMode,
} from './terminalCarrierRunnerPolicy.mjs';

const carrierSource = await readFile(new URL('./checkSemanticTerminalCarrier.mjs', import.meta.url), 'utf8');
const ciSource = await readFile(new URL('../../../../.github/workflows/ci-check.yml', import.meta.url), 'utf8');
const prePushSource = await readFile(new URL('../../../../scripts/check_renderer_e2e.sh', import.meta.url), 'utf8');
const uiGateSource = await readFile(new URL('../../../../scripts/check_ui_tests.sh', import.meta.url), 'utf8');
const performanceSource = await readFile(new URL('./checkTerminalInteractionPerformance.mjs', import.meta.url), 'utf8');
const browserConfigSource = await readFile(new URL('../vitest.browser.config.ts', import.meta.url), 'utf8');
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const releaseSource = await readFile(new URL('../../../../.github/workflows/release.yml', import.meta.url), 'utf8');

test('keeps the supported terminal carriers explicit in the exact-main pre-push gate', () => {
  assert.match(carrierSource, /chromium\.launch\(\{\s*headless: options\.headless,/u);
  assert.match(carrierSource, /--enable-gpu/u);
  assert.match(carrierSource, /installReDevPluginRuntimeFixture\(tempDir\)/u);

  assert.doesNotMatch(ciSource, /test:terminal-carrier/u);

  assert.match(prePushSource, /corepack pnpm run test:terminal-carrier -- --headless --fixture-bytes "\$fixture_bytes"/u);
  assert.doesNotMatch(prePushSource, /DISPLAY|xvfb-run/u);
  assert.doesNotMatch(uiGateSource, /DISPLAY|xvfb-run/u);
  assert.match(prePushSource, /ui_pkg_need_install "\$UI_DIR"/u);
  assert.match(prePushSource, /pnpm install --frozen-lockfile/u);
  assert.match(prePushSource, /pnpm exec playwright install chromium/u);
  assert.match(prePushSource, /^run_terminal_carrier 65536$/mu);
  assert.match(prePushSource, /^run_terminal_carrier 458752$/mu);

  assert.doesNotMatch(releaseSource, /test:terminal-carrier/u);

  assert.doesNotMatch(prePushSource, /--fixture-bytes 8388608/u);
  assert.doesNotMatch(releaseSource, /--fixture-bytes 8388608/u);
  assert.match(carrierSource, /const semanticCanvasSelector = '\[data-terminal-semantic-canvas="true"\]'/u);
  assert.match(carrierSource, /terminal must own one semantic canvas/u);
  assert.match(carrierSource, /verifyAtomicClear/u);
  assert.match(carrierSource, /verifyTopResize/u);
  assert.doesNotMatch(carrierSource, /TerminalCore|GhosttyCheckpoint/u);
  assert.match(carrierSource, /legacy_canvas_count/u);
});

test('defaults browser gates to headless while preserving explicit headed diagnostics', () => {
  assert.deepEqual(resolveTerminalCarrierBrowserMode([]), {
    browserMode: 'headless',
    headless: true,
  });
  assert.deepEqual(resolveTerminalCarrierBrowserMode(['--headless']), {
    browserMode: 'headless',
    headless: true,
  });
  assert.deepEqual(resolveTerminalCarrierBrowserMode(['--headed']), {
    browserMode: 'headed',
    headless: false,
  });
  assert.throws(
    () => resolveTerminalCarrierBrowserMode(['--headless', '--headed']),
    /cannot be used together/,
  );

  assert.match(browserConfigSource, /^\s*headless: true,$/mu);
  assert.match(browserConfigSource, /^\s*fileParallelism: false,$/mu);
  assert.match(browserConfigSource, /--enable-gpu/u);
  assert.match(browserConfigSource, /--disable-background-timer-throttling/u);
  assert.match(browserConfigSource, /--disable-renderer-backgrounding/u);
  assert.match(packageSource, /"test:browser:headed": "node scripts\/runVitestBrowser\.mjs --browser\.headless=false"/u);
  assert.match(performanceSource, /checkSemanticTerminalCarrier\.mjs'\),\s*'--headless'/u);
  assert.match(performanceSource, /browser_mode: fixedTerminalPerformanceBrowserMode/u);
  assert.doesNotMatch(prePushSource, /--headed|test:browser:headed/u);
  assert.doesNotMatch(uiGateSource, /--headed|test:browser:headed/u);
});

test('reports Chromium readback diagnostics without weakening renderer failures', () => {
  assert.equal(classifyTerminalCarrierConsoleMessage({
    type: 'warning',
    text: '[.WebGL-0x4b40406e800]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
  }), 'browser_driver_diagnostic');
  assert.equal(classifyTerminalCarrierConsoleMessage({
    type: 'warning',
    text: '[.WebGL-0x4b40406e800]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels (this message will no longer repeat)',
  }), 'browser_driver_diagnostic');
  assert.equal(classifyTerminalCarrierConsoleMessage({
    type: 'warning',
    text: '[.WebGL-0x4b40406e800]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, Medium): unrelated warning',
  }), 'renderer_problem');
  assert.equal(classifyTerminalCarrierConsoleMessage({
    type: 'error',
    text: '[.WebGL-0x4b40406e800]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
  }), 'renderer_problem');
  assert.equal(classifyTerminalCarrierConsoleMessage({ type: 'log', text: 'ordinary output' }), 'ignore');
});

test('checks every semantic frame boundary before visual sampling', () => {
  assert.match(carrierSource, /frame_cols !== trace\.geometry_cols/u);
  assert.match(carrierSource, /canvas_backing\[0\] !== Math\.round\(trace\.canvas_layout\[0\] \* trace\.dpr\)/u);
  assert.match(carrierSource, /transparent_pixels !== 0/u);
  assert.match(carrierSource, /waitForViewsToConverge/u);
});

test('collects every semantic multi-view sample before enforcing the aggregate p95 limit', () => {
  assert.match(carrierSource, /const multiViewSamples = \[\];/u);
  assert.match(carrierSource, /carrierProgress\.multiViewSamples\.push\(sample\)/u);
  assert.match(
    carrierSource,
    /const activityRuntime = await activateSession\(activity, sessionID\);[\s\S]*?const started = performance\.now\(\);[\s\S]*?const workbenchRuntime = await activateSession\(workbench, sessionID\);/u,
  );
  assert.match(
    carrierSource,
    /sendTerminalCommand\(page, `printf ok > \$\{shellQuote\(markerPath\)\}`, workbenchRuntime\)/u,
  );
  assert.match(
    carrierSource,
    /const multiViewP95Ms = assertTerminalCarrierP95Limit\(\{[\s\S]*?values: multiViewSamples\.map/u,
  );
});

test('keeps one real semantic renderer across refresh', () => {
  assert.match(carrierSource, /\[data-testid="terminal-sidebar-refresh"\]:visible/u);
  assert.match(carrierSource, /if \(!preservedCanvas\) throw new Error\('refresh replaced the semantic canvas'\)/u);
  assert.match(carrierSource, /presentation_sequence/u);
});
