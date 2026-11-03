import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { buildDesktopMain } from './build-main.mjs';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-reserved-path-'));
  await session.directory(directory);
  const output = path.resolve('dist/web-service-reserved-path-acceptance');
  await mkdir(output, { recursive: true });
  await rm(path.join(output, 'report.json'), { force: true });
  const runner = path.join(directory, 'runner.cjs');
  const preload = path.join(directory, 'toolbar.cjs');
  await buildDesktopMain({ entryPoint: 'scripts/fixtures/web-service-reserved-path-electron.ts', outfile: runner, report: false });
  await build({ entryPoints: ['src/preload/webServiceBrowser.ts'], outfile: preload, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await session.evidence(path.join(output, 'report.json'));
  const child = await session.spawn(electron, [runner, '--user-data-dir=' + directory + '/profile'], {
    stdio: 'inherit', cwd: directory, detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_RESERVED_PATH_OUTPUT: output, REDEVEN_RESERVED_PATH_PRELOAD: preload },
  });
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify({ pid: child.pid, state: directory, port: null }, null, 2));
  const result = await session.wait(child, 120000);
  if (result.code !== 0 || result.signal) throw new Error('Reserved path qualification failed: ' + JSON.stringify(result));
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  if (report.scenarioStatus !== 'passed' || report.cases.length < 40 || !report.actions || !report.disclosure || !report.keyboard || !report.ordinary404 || !report.redirect) throw new Error('Incomplete reserved path qualification');
  await session.writeEvidence(path.join(output, 'report.json'), report);
});
