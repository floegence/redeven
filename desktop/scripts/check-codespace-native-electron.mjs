import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
const directory = await mkdtemp(
  path.join(tmpdir(), 'redeven-native-electron-'),
);
const runMarker = randomUUID();
try {
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
    external: ['electron'],
  });
  const child = spawn(
    electron,
    [path.join(directory, 'smoke.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-smoke-run=${runMarker}`],
    {
      stdio: 'inherit',
      cwd: directory,
      detached: process.platform !== 'win32',
      env: { ...process.env, REDEVEN_NATIVE_EDITOR_SMOKE_STATE: path.join(directory, 'editor'), ELECTRON_RUN_AS_NODE: undefined },
    },
  );
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  }, 60000);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Native Electron smoke failed: ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
