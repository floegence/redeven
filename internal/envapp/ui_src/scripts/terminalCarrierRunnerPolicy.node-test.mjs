import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyTerminalCarrierConsoleMessage,
  resolveTerminalCarrierBrowserMode,
} from './terminalCarrierRunnerPolicy.mjs';

const carrierSource = await readFile(new URL('./checkTerminalRecoveryCarrier.mjs', import.meta.url), 'utf8');
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
  assert.match(
    carrierSource,
    /commandTitles\.every[\s\S]*?querySelector\('\[data-terminal-tab-status="spinner"\]'\) === null/u,
  );
  assert.match(carrierSource, /running_title_without_spinner: true/u);
  assert.doesNotMatch(carrierSource, /running_title_and_spinner/u);
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
  assert.match(performanceSource, /checkTerminalRecoveryCarrier\.mjs'\),\s*'--headless'/u);
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

test('disables Readline bracketed paste before seeding byte-exact terminal fixtures', () => {
  assert.match(carrierSource, /set enable-bracketed-paste off/u);
  assert.match(carrierSource, /INPUTRC=/u);
});

test('waits for the trace-scoped baseline render before visual sampling', () => {
  assert.match(carrierSource, /startsWith\('redeven:terminal:baseline-rendered:'\)/u);
  assert.match(carrierSource, /find\('baseline-rendered'\)/u);
  assert.match(carrierSource, /baseline\.startTime <= rendered\.startTime/u);
  assert.match(carrierSource, /baseline_rendered_ms: rendered\.startTime - start\.startTime/u);
});

test('rebuilds the real renderer on refresh and verifies focus does not corrupt replay', () => {
  assert.match(carrierSource, /\[data-testid="terminal-sidebar-refresh"\]:visible/u);
  assert.match(carrierSource, /refresh_attach_start_delta/u);
  assert.match(carrierSource, /refresh_history_visual_match/u);
  assert.match(carrierSource, /focus_history_visual_match/u);
  assert.match(carrierSource, /await terminalInput\(page, refreshedRuntime\)/u);
});
