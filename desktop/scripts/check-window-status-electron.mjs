import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [], { stdio: 'inherit' });
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-window-status-'));
const output = path.resolve('dist/window-status-acceptance');
const marker = randomUUID();
await mkdir(output, { recursive: true });
await rm(path.join(output, 'report.json'), { force: true });
try {
  const runner = path.join(output, 'runner.cjs');
  await build({ entryPoints: ['scripts/fixtures/window-status-electron.ts'], outfile: runner, bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@floegence/floe-webapp-core/*'] });
  const child = spawn(electron, [runner, `--user-data-dir=${directory}/profile`, `--redeven-smoke-run=${marker}`], {
    stdio: 'inherit', cwd: directory, detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_WINDOW_STATUS_OUTPUT: output },
  });
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pid: child.pid, port: null, state: directory, marker }, null, 2));
  let timedOut = false;
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    timedOut = true;
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  }, 90_000);
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }).finally(() => clearTimeout(timer));
  if (timedOut || result.code !== 0 || result.signal) throw new Error(`Window status Electron verification failed: ${JSON.stringify(result)}`);
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  if (report.status !== 'passed' || report.cases.length !== 120 || report.serviceRequests !== 60) {
    throw new Error('Window status Electron acceptance report is incomplete');
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
