import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fastTests, browserTests, longThreadAffected } from './flower_long_thread_contract.mjs';
const root = path.resolve(import.meta.dirname, '..');
export function affected(args, execute = spawnSync) {
  if (args.some(value => !['--staged', '--fast', '--integration'].includes(value))) throw new Error('Unknown long-thread gate argument');
  if (!args.includes('--staged') && !args.includes('--integration')) return true;
  const revisions = args.includes('--staged') ? ['--cached'] : [process.env.LOCAL_GATE_BASE, process.env.LOCAL_GATE_TIP];
  if (revisions.some(value => !value)) throw new Error('Integration requires exact LOCAL_GATE_BASE and LOCAL_GATE_TIP');
  const diff = execute('git', ['diff', ...revisions, '--name-only', '--no-renames', '-z'], { cwd: root, encoding: 'utf8' });
  if (diff.error || diff.status !== 0) throw new Error('Cannot determine long-thread gate scope', { cause: diff.error });
  return diff.stdout.split('\0').some(longThreadAffected);
}
export function runGate({ fast = false, execute = spawnSync, exists = existsSync } = {}) {
  const ui = path.join(root, 'internal/envapp/ui_src');
  const run = (args, cwd = root) => {
    const result = execute(process.execPath, args, { cwd, stdio: 'inherit', env: process.env, timeout: args.includes('scripts/qualify_flower_long_thread.mjs') ? 1900000 : 300000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Long-thread gate failed: ' + args.join(' '));
  };
  for (const file of fastTests) if (!exists(path.join(root, 'internal/flower_ui/src', file))) throw new Error('Missing long-thread regression: ' + file);
  run(['--test', 'scripts/flower_long_thread_contract.test.mjs']);
  run([path.join(ui, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root, '--config', path.join(ui, 'vite.config.ts'), '--environment=node', '--maxWorkers=2', ...fastTests.map(file => 'internal/flower_ui/src/' + file)]);
  if (fast) return;
  for (const file of browserTests) if (!exists(path.join(ui, 'src/ui', file))) throw new Error('Missing browser regression: ' + file);
  run([path.join(ui, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.browser.config.ts', ...browserTests.map(file => 'src/ui/' + file)], ui);
  run(['scripts/qualify_flower_long_thread.mjs']);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (affected(process.argv.slice(2))) runGate({ fast: process.argv.includes('--fast') });
  else console.log('Flower long-thread gate: no affected source or dependency changes');
}
