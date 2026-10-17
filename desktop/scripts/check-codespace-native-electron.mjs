import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 180000,
});
await session.run(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-native-electron-'));
  await session.directory(directory);
  const runMarker = randomUUID();

  await build({
    entryPoints: [
      process.env.REDEVEN_NATIVE_EDITOR_FIXTURE
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
  const { code } = await session.wait(child, 60000);

  if (code !== 0) throw new Error(`Native Electron smoke failed: ${code}`);
});
