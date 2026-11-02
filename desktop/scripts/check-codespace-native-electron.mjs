import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 240000,
  reportFile: process.env.REDEVEN_NATIVE_ACCEPTANCE_REPORT,
});
await session.run(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-native-electron-'));
  await session.directory(directory);
  const runMarker = randomUUID();
  execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [process.cwd()], { stdio: 'inherit' });
  let bridgeFixture, bridgeReady;
  if (process.argv.includes('--real-editor')) {
    const binary = path.join(directory, 'bridge-fixture');
    const buildFixture = await session.spawn('go', ['test', '-c', '-o', binary, './internal/localui'], {
      cwd: path.resolve('..'), stdio: 'inherit', env: { ...process.env, GOWORK: 'off' },
    }, { kind: 'build' });
    await session.wait(buildFixture, 120000);
    bridgeFixture = await session.spawn(binary, ['-test.run=^TestNativeCodeSpaceBrowserEditorFixture$', '-test.timeout=150s'], {
      cwd: directory, stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, REDEVEN_NATIVE_BROWSER_FIXTURE_STATE: path.join(directory, 'editor'), REDEVEN_BROWSER_RUN_MARKER: runMarker },
    }, { kind: 'fixture' });
    bridgeReady = await new Promise((resolve, reject) => {
      let buffer = '';
      bridgeFixture.stdout.on('data', chunk => {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf(String.fromCharCode(10))) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line.startsWith('NATIVE_BROWSER_READY ')) resolve(JSON.parse(line.slice(21)));
        }
      });
      bridgeFixture.once('exit', code => reject(new Error(`Runtime bridge fixture exited before readiness: ${code}`)));
    });
    await session.port(new URL(bridgeReady.bridge_url).port);
    await session.port(bridgeReady.editor_port);
  }

  await build({
    entryPoints: [
      bridgeReady || process.env.REDEVEN_NATIVE_EDITOR_FIXTURE
        ? 'scripts/fixtures/codespace-native-editor.ts'
        : 'scripts/fixtures/codespace-native-electron.ts',
    ],
    outfile: path.join(directory, 'smoke.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', '@floegence/floe-webapp-core/*'],
    banner: {
      js: `var require = require('node:module').createRequire(${JSON.stringify(path.resolve('package.json'))});`,
    },
  });
  const child = await session.spawn(
    electron,
    [path.join(directory, 'smoke.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-smoke-run=${runMarker}`],
    {
      stdio: 'inherit',
      cwd: directory,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        REDEVEN_NATIVE_EDITOR_SMOKE_STATE: path.join(directory, 'editor'),
        REDEVEN_NATIVE_BRIDGE_READY: bridgeReady ? JSON.stringify(bridgeReady) : undefined,
        ELECTRON_RUN_AS_NODE: undefined,
      },
    },
  );
  console.log(
    'Owned native acceptance runtime:',
    JSON.stringify({
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      electron_pid: child.pid,
      state: directory,
      marker: runMarker,
    }),
  );
  const { code } = await session.wait(child, 90000);

  if (code !== 0) throw new Error(`Native Electron smoke failed: ${code}`);
  if (bridgeFixture) { bridgeFixture.kill('SIGTERM'); await session.wait(bridgeFixture, 5000); }
});
