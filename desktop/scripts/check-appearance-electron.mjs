import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [], { stdio: 'inherit' });
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-appearance-electron-'));
const output = path.resolve('dist/appearance-acceptance');
const marker = randomUUID();
const server = await createSSHSettingsPreviewServer(0);
await mkdir(output, { recursive: true });
try {
  for (const [entry, target] of [['appearance-electron', 'runtime'], ['appearance-preload', 'preload']]) {
    await build({ entryPoints: [`scripts/fixtures/${entry}.ts`], outfile: path.join(directory, `${target}.cjs`), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  }
  const child = spawn(electron, [path.join(directory, 'runtime.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-smoke-run=${marker}`], {
    stdio: 'inherit', cwd: directory, detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_APPEARANCE_URL: new URL('appearance.html', server.resolvedUrls.local[0]).href, REDEVEN_APPEARANCE_OUTPUT: output, REDEVEN_APPEARANCE_PRELOAD: path.join(directory, 'preload.cjs') },
  });
  const runtime = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pid: child.pid, port: new URL(server.resolvedUrls.local[0]).port, state: directory, marker };
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify(runtime, null, 2));
  console.log('Owned appearance acceptance runtime:', JSON.stringify(runtime));
  let timedOut = false;
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    timedOut = true;
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  }, 60000);
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }).finally(() => clearTimeout(timer));
  if (timedOut || result.code !== 0) throw new Error(`Appearance Electron verification failed: ${JSON.stringify({ timedOut, ...result })}`);
} finally {
  await server.close(); await rm(directory, { recursive: true, force: true });
}
