import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createBuiltDistTLS } from '../../internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs';
import { createContinuityServer, cachePages, navigationPages } from '../../internal/envapp/ui_src/scripts/fixtures/startupContinuity.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'redeven-startup-electron-'));
const marker = randomUUID();
const compiled = path.resolve(`.startup-continuity-build-${marker}`);
const tls = await createBuiltDistTLS();
try {
  execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [process.cwd()], { stdio: 'inherit' });
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--outDir', compiled, '--noEmitOnError'], { stdio: 'inherit' });
  for (const entry of ['startup-continuity-electron', 'startup-continuity-preload']) await build({ entryPoints: [`scripts/fixtures/${entry}.ts`], outfile: path.join(directory, `${entry}.cjs`), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const ports = [];
  for (const phase of ['write', 'read']) {
    const server = await createContinuityServer(tls);
    ports.push(new URL(server.baseURL).port);
    if (phase === 'read') server.hold('data');
    const child = spawn(electron, [path.join(directory, 'startup-continuity-electron.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-startup-continuity-run=${marker}`, `--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`], {
      cwd: directory, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
        REDEVEN_CONTINUITY_PHASE: phase, REDEVEN_CONTINUITY_URL: new URL('_redeven_proxy/env/', server.baseURL).href,
        REDEVEN_CONTINUITY_CERTIFICATE: tls.certificateHash,
        REDEVEN_CONTINUITY_CACHE_MAIN: path.join(compiled, 'main/desktopResourceCache.js'),
        REDEVEN_CONTINUITY_STATE_MAIN: path.join(compiled, 'main/desktopStateStore.js'),
        REDEVEN_CONTINUITY_PRELOAD: path.join(directory, 'startup-continuity-preload.cjs'),
        REDEVEN_CONTINUITY_PAGES: JSON.stringify(Object.fromEntries(navigationPages.map(page => [page, cachePages[page] ?? null]))),
      },
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    console.log('Owned startup Electron runtime:', JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), phase, pid: child.pid, port: ports.at(-1), state: directory, marker }));
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      timedOut = true;
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
    }, 180000);
    try {
      const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      if (timedOut || result.code !== 0 || !output.includes(`PASS Electron completion: ${phase}`)) throw new Error(`Startup continuity Electron fixture failed: ${JSON.stringify({ ...result, timedOut })}`);
    } finally { clearTimeout(timer); server.releaseAll(); await server.close(); }
  }
  if (ports[0] === ports[1]) throw new Error('Restart fixture must use different loopback ports');
  console.log('PASS: ten Activity targets and four resource snapshots survive actual Electron restart and changing loopback ports.');
} finally { await tls.cleanup(); await rm(directory, { recursive: true, force: true }); await rm(compiled, { recursive: true, force: true }); }
