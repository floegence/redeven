import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 180000,
});
await session.run(async () => {
  execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [], { stdio: 'inherit' });
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-appearance-electron-'));
  await session.directory(directory);
  const output = path.resolve('dist/appearance-acceptance');
  const marker = randomUUID();
  const server = await createSSHSettingsPreviewServer(0);
  await session.defer('preview server', () => server.close());
  await session.port(new URL(server.resolvedUrls.local[0]).port);
  await mkdir(output, { recursive: true });

  for (const [entry, target] of [
    ['appearance-electron', 'runtime'],
    ['appearance-preload', 'preload'],
  ]) {
    await build({
      entryPoints: [`scripts/fixtures/${entry}.ts`],
      outfile: path.join(directory, `${target}.cjs`),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
  }
  await session.evidence(path.join(output, 'report.json'));
  const child = await session.spawn(
    electron,
    [path.join(directory, 'runtime.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-smoke-run=${marker}`],
    {
      stdio: 'inherit',
      cwd: directory,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        REDEVEN_APPEARANCE_URL: new URL('appearance.html', server.resolvedUrls.local[0]).href,
        REDEVEN_APPEARANCE_OUTPUT: output,
        REDEVEN_APPEARANCE_PRELOAD: path.join(directory, 'preload.cjs'),
      },
    },
  );
  const runtime = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    pid: child.pid,
    port: new URL(server.resolvedUrls.local[0]).port,
    state: directory,
    marker,
  };
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify(runtime, null, 2));
  console.log('Owned appearance acceptance runtime:', JSON.stringify(runtime));
  const result = await session.wait(child, 60000);
  if (result.code !== 0) throw new Error(`Appearance Electron verification failed: ${JSON.stringify({ ...result })}`);
});
