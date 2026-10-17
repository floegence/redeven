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
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-titlebar-'));
  await session.directory(directory);
  const marker = randomUUID();
  const repository = path.resolve('..');

  execFileSync(path.join(repository, 'scripts/check_desktop_electron_test_runtime.sh'), [process.cwd()], { stdio: 'inherit' });
  const entries = [
    ['scripts/fixtures/host-application-titlebar.ts', 'fixture.cjs'],
    ['src/preload/hostApplicationWindow.ts', 'preload.cjs'],
  ];
  for (const [entry, name] of entries) {
    await build({
      entryPoints: [entry],
      outfile: path.join(directory, name),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
  }
  const child = await session.spawn(
    electron,
    [path.join(directory, 'fixture.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-titlebar-run=${marker}`],
    {
      cwd: directory,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        REDEVEN_TITLEBAR_REPOSITORY: repository,
        REDEVEN_TITLEBAR_PRELOAD: path.join(directory, 'preload.cjs'),
      },
    },
  );
  console.log(
    'Owned titlebar runtime:',
    JSON.stringify({
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      pid: child.pid,
      state: directory,
      marker,
    }),
  );

  const result = await session.wait(child, 60000);

  if (result.code !== 0) throw new Error(`Titlebar fixture failed: ${JSON.stringify({ ...result })}`);
});
