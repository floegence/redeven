import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { classifyTerminalCarrierConsoleMessage } from './terminalCarrierRunnerPolicy.mjs';

const carrierSource = await readFile(new URL('./checkTerminalRecoveryCarrier.mjs', import.meta.url), 'utf8');
const ciSource = await readFile(new URL('../../../../.github/workflows/ci-check.yml', import.meta.url), 'utf8');
const releaseSource = await readFile(new URL('../../../../.github/workflows/release.yml', import.meta.url), 'utf8');

test('keeps the supported terminal carriers explicit in CI and release gates', () => {
  assert.match(carrierSource, /chromium\.launch\(\{\s*headless: false,/u);

  const carrierCommands = ciSource.match(/^\s*run: .*test:terminal-carrier.*$/gmu) ?? [];
  assert.equal(carrierCommands.length, 2);
  for (const command of carrierCommands) {
    assert.match(command, /run: xvfb-run -a corepack pnpm run test:terminal-carrier/u);
  }
  assert.match(carrierCommands[0] ?? '', /--fixture-bytes 65536/u);
  assert.match(carrierCommands[1] ?? '', /--fixture-bytes 458752/u);

  const releaseCarrierCommands = releaseSource.match(/^\s*run: .*test:terminal-carrier.*$/gmu) ?? [];
  assert.equal(releaseCarrierCommands.length, 2);
  for (const command of releaseCarrierCommands) {
    assert.match(command, /run: xvfb-run -a corepack pnpm run test:terminal-carrier/u);
  }
  assert.match(releaseCarrierCommands[0] ?? '', /--fixture-bytes 65536/u);
  assert.match(releaseCarrierCommands[1] ?? '', /--fixture-bytes 458752/u);

  assert.doesNotMatch(ciSource, /--fixture-bytes 8388608/u);
  assert.doesNotMatch(releaseSource, /--fixture-bytes 8388608/u);
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
