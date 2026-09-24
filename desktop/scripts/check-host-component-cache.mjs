import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

const evidence = path.resolve(process.argv[2] ?? '../.artifacts/host-component-cache');
const runtime = path.join(evidence, 'redeven');
const hostRuntime = path.join(evidence, 'component-runtime.test');
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-component-cache-'));
const marker = randomUUID();
const containers = [];
const ownership = [];
const repository = path.resolve('..');
const command = (binary, args) => execFileSync(binary, args, { encoding: 'utf8' }).trim();
try {
  await mkdir(evidence, { recursive: true });
  command(path.join(repository, 'scripts/check_desktop_electron_test_runtime.sh'), [process.cwd()]);
  for (const [entry, name] of [['scripts/fixtures/host-component-cache-electron.ts', 'fixture.cjs'], ['src/preload/desktopShell.ts', 'preload.cjs']]) {
    await build({ entryPoints: [entry], outfile: path.join(directory, name), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], ...(name === 'preload.cjs' ? { footer: { js: 'bootstrapDesktopShellBridge();' } } : {}) });
  }
  const endpoints = [];
  for (let index = 0; index < 2; index++) {
    const name = `redeven-component-cache-${marker}-${index}`;
    command('docker', ['run', '-d', '--name', name, '--label', `redeven.acceptance=${marker}`, '--user', '65534:65534', '--read-only', '--tmpfs', '/tmp:rw,mode=1777,exec', '-p', '127.0.0.1::8080', '-v', `${hostRuntime}:/fixture:ro`, '-e', 'REDEVEN_COMPONENT_CACHE_ACCEPTANCE_LISTEN=0.0.0.0:8080', 'ubuntu:24.04', '/fixture', '-test.run=^TestHostApplicationCacheAcceptanceServer$', '-test.v', '-test.timeout=15m']);
    containers.push(name);
    const endpoint = `http://${command('docker', ['port', name, '8080/tcp'])}`;
    endpoints.push(endpoint);
    const deadline = Date.now() + 20_000;
    while (true) {
      try { if ((await fetch(`${endpoint}/ready`)).ok) break; } catch { /* The task-owned listener is starting. */ }
      if (Date.now() > deadline) throw new Error(`Runtime did not start: ${name}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    ownership.push({ kind: 'linux-runtime', name, endpoint, state: 'container private /tmp' });
  }
  for (const phase of ['devices', 'restart']) {
    const child = spawn(electron, [path.join(directory, 'fixture.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-component-cache-run=${marker}`], { cwd: directory, detached: process.platform !== 'win32', stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_COMPONENT_RUNTIME: runtime, REDEVEN_COMPONENT_EVIDENCE: evidence, REDEVEN_COMPONENT_PHASE: phase, REDEVEN_COMPONENT_ENDPOINTS: JSON.stringify(endpoints), REDEVEN_COMPONENT_PRELOAD: path.join(directory, 'preload.cjs') } });
    ownership.push({ kind: 'electron', phase, pid: child.pid, marker, state: `${directory}/profile`, commit: command('git', ['rev-parse', 'HEAD']) });
    await writeFile(path.join(evidence, 'ownership.json'), JSON.stringify(ownership, null, 2));
    console.log('Owned component acceptance:', JSON.stringify(ownership.at(-1)));
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      timedOut = true;
      if (process.platform === 'win32') command('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
    }, 12 * 60_000);
    try {
      const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      if (timedOut || result.code !== 0) throw new Error(`Component cache acceptance failed: ${JSON.stringify({ ...result, timedOut })}`);
    } finally { clearTimeout(timeout); }
  }
} finally {
  for (const name of containers) {
    await writeFile(path.join(evidence, `${name}.log`), command('docker', ['logs', name]));
    command('docker', ['rm', '-f', name]);
  }
  await rm(directory, { recursive: true, force: true });
}
