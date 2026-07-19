import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
