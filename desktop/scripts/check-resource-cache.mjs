import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

const directory = await mkdtemp(path.join(tmpdir(), 'redeven-resource-cache-electron-'));
const marker = randomUUID();
const repository = path.resolve('..');
const compiled = path.resolve(`.resource-cache-build-${marker}`);
try {
  execFileSync(path.join(repository, 'scripts/check_desktop_electron_test_runtime.sh'), [process.cwd()], { stdio: 'inherit' });
  // Exercise the actual CommonJS compiler output, with its normal package resolution.
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--outDir', compiled, '--noEmitOnError'], { stdio: 'inherit' });
  for (const [entry, name] of [
    ['scripts/fixtures/resource-cache-electron.ts', 'fixture.cjs'],
    ['src/preload/desktopResourceCache.ts', 'bridge.cjs'],
  ]) {
    await build({ entryPoints: [entry], outfile: path.join(directory, name), bundle: true,
      platform: 'node', format: 'cjs', external: ['electron'],
      ...(name === 'bridge.cjs' ? { footer: { js: 'bootstrapDesktopResourceCacheBridge();' } } : {}),
    });
  }
  for (const phase of ['write', 'read']) {
    const child = spawn(electron, [path.join(directory, 'fixture.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-resource-cache-run=${marker}`], {
      cwd: directory, detached: process.platform !== 'win32', stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_CACHE_PHASE: phase, REDEVEN_CACHE_PRELOAD: path.join(directory, 'bridge.cjs'), REDEVEN_CACHE_MAIN: path.join(compiled, 'main/desktopResourceCache.js') },
    });
    console.log('Owned resource cache runtime:', JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), phase, pid: child.pid, state: directory, marker }));
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      timedOut = true;
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
    }, 30000);
    try {
      const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      if (timedOut || result.code !== 0) throw new Error(`Resource cache fixture failed: ${JSON.stringify({ ...result, timedOut })}`);
    } finally { clearTimeout(timeout); }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
  await rm(compiled, { recursive: true, force: true });
}
