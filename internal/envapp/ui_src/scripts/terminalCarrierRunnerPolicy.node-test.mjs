import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { classifyTerminalCarrierConsoleMessage } from './terminalCarrierRunnerPolicy.mjs';
import {
  historyFixtureDriftIsValid,
  minimumRetainedBytesForFixture,
  terminalHistoryChunkMaxBytes,
  terminalHistoryMaxBytes,
} from './terminalCarrierFixturePolicy.mjs';

const carrierSource = await readFile(new URL('./checkTerminalRecoveryCarrier.mjs', import.meta.url), 'utf8');
const ciSource = await readFile(new URL('../../../../.github/workflows/ci-check.yml', import.meta.url), 'utf8');

test('runs headed terminal carriers under an explicit CI display server', () => {
  assert.match(carrierSource, /chromium\.launch\(\{\s*headless: false,/u);

  const carrierCommands = ciSource.match(/^\s*run: .*test:terminal-carrier.*$/gmu) ?? [];
  assert.equal(carrierCommands.length, 3);
  for (const command of carrierCommands) {
    assert.match(command, /run: xvfb-run -a corepack pnpm run test:terminal-carrier/u);
  }
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

test('models the terminal history boundary using whole 32 KiB PTY chunks', () => {
  assert.equal(terminalHistoryChunkMaxBytes, 32 * 1024);
  assert.equal(minimumRetainedBytesForFixture(64 * 1024), 64 * 1024);
  assert.equal(
    minimumRetainedBytesForFixture(terminalHistoryMaxBytes),
    terminalHistoryMaxBytes - terminalHistoryChunkMaxBytes,
  );
  assert.equal(
    minimumRetainedBytesForFixture(terminalHistoryMaxBytes + 1),
    terminalHistoryMaxBytes - terminalHistoryChunkMaxBytes,
  );
});

test('accepts at most one whole PTY chunk of fixture drift', () => {
  const seededBoundaryBytes = terminalHistoryMaxBytes - 8 * 1024;
  assert.equal(historyFixtureDriftIsValid(
    terminalHistoryMaxBytes,
    seededBoundaryBytes,
    seededBoundaryBytes - terminalHistoryChunkMaxBytes,
  ), true);
  assert.equal(historyFixtureDriftIsValid(
    terminalHistoryMaxBytes,
    seededBoundaryBytes,
    seededBoundaryBytes - terminalHistoryChunkMaxBytes - 1,
  ), false);
  assert.equal(historyFixtureDriftIsValid(
    64 * 1024,
    64 * 1024,
    64 * 1024 + terminalHistoryChunkMaxBytes,
  ), true);
  assert.equal(historyFixtureDriftIsValid(
    64 * 1024,
    64 * 1024,
    64 * 1024 - 1,
  ), false);
});
