#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const passthroughArgs = process.argv.slice(2);
const vitestArgs = [
  'run',
  '--config',
  'vitest.browser.config.ts',
  ...passthroughArgs.filter((arg, index) => !(index === 0 && arg === '--')),
];

const result = spawnSync('vitest', vitestArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? (result.signal ? 1 : 0));
