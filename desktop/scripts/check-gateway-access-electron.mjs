import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(path.join(root, '../scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
const configPath = process.argv[2];
const fixture = JSON.parse(await readFile(configPath, 'utf8'));
const output = path.join(root, 'dist/gateway-access-acceptance');
await mkdir(output, { recursive: true });
await rm(path.join(output, 'report.json'), { force: true });
const runner = path.join(output, 'runner.cjs');
await build({ entryPoints: [path.join(root, 'scripts/fixtures/gateway-runtime-browser.ts')], outfile: path.join(output, 'runtime-browser.js'),
  bundle: true, platform: 'browser', format: 'iife', globalName: 'GatewayAcceptance' });
await build({ entryPoints: [path.join(root, 'scripts/fixtures/gateway-access-electron.ts')], outfile: runner,
  bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@floegence/floe-webapp-core/*', '@floegence/flowersec-core/*'] });
const child = spawn(electron, [runner, `--user-data-dir=${fixture.state}/electron`, `--redeven-smoke-run=${randomUUID()}`], {
  stdio: 'inherit', cwd: fixture.state, detached: process.platform !== 'win32',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_GATEWAY_FIXTURE: configPath, REDEVEN_GATEWAY_OUTPUT: output },
});
await writeFile(path.join(output, 'runtime.json'), JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  pid: child.pid, goPID: fixture.goPID, gatewayPort: Number(new URL(fixture.gateway).port), state: fixture.state }, null, 2));
const stop = () => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const timer = setTimeout(stop, 90_000);
const result = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
}).finally(() => { clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); });
if (result.code !== 0 || result.signal) throw new Error(`Gateway Electron qualification failed: ${JSON.stringify(result)}`);
const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
if (report.status !== 'passed' || report.cases.length < 8) throw new Error('Gateway qualification report is incomplete');
console.log(`PASS Gateway Electron qualification (${report.cases.length} cases)`);
