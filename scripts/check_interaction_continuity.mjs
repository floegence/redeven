import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { continuityAffected, continuityTests } from './interaction_continuity_contract.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));

export function runContinuity({ suites = continuityTests, execute = spawnSync, exists = existsSync } = {}) {
  if (Object.keys(suites).join(',') !== 'state,client') throw new Error('Missing continuity suites');
  for (const [kind, tests] of Object.entries(suites)) {
    if (tests.length === 0 || new Set(tests).size !== tests.length) throw new Error('Continuity test list must be nonempty and unique');
    for (const test of tests) if (!exists(new URL('../desktop/' + test, import.meta.url))) throw new Error('Missing continuity test: ' + test);
    const result = execute(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...(kind === 'client' ? ['--config', 'vitest.client.config.mts'] : []), ...tests], { cwd: desktop, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}
export function continuityScope(args, execute = spawnSync) {
  const base = args.indexOf('--base');
  const tip = args.indexOf('--tip');
  if (base >= 0 && !args[base + 1] || tip >= 0 && !args[tip + 1] || (base >= 0) !== (tip >= 0)) throw new Error('Both continuity base and tip are required');
  if (!args.includes('--staged') && base < 0) return true;
  const diff = execute('git', ['diff', ...(base >= 0 ? [args[base + 1] + '...' + args[tip + 1]] : ['--cached']), '--name-only', '-z'], { cwd: root, encoding: 'utf8' });
  if (diff.error) throw diff.error;
  if (diff.status !== 0) throw new Error('Cannot determine continuity scope');
  return diff.stdout.split('\0').some(continuityAffected);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (continuityScope(process.argv.slice(2))) process.exitCode = runContinuity();
}
