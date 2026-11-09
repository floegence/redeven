import assert from 'node:assert/strict';
import { build } from 'esbuild';
import electron from 'electron';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';

// Explicit network qualification. No mocked SDK or credential is used. The
// snapshots are then consumed by TestOfficialTemplateMarketLifecycle.
const evidence = process.env.REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE;
assert.ok(evidence && path.isAbsolute(evidence), 'Set an absolute evidence directory');
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 240000 });
await session.run(async () => {
  await mkdir(evidence, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), 'redeven-template-electron-'));
  await session.directory(temporary);
  for (const name of ['template-acquisition-electron', 'template-acquisition-preload']) {
    await build({ entryPoints: [`scripts/fixtures/${name}.ts`], outfile: path.join(temporary, `${name}.cjs`), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  }
  const result = await fetch('https://plugins.redeven.com/v1/service-templates/catalog', { redirect: 'error' });
  assert.equal(result.status, 200);
  const catalog = await result.json();
  assert.ok(catalog.data?.length > 0);
  await writeFile(path.join(evidence, 'desktop-catalog.json'), JSON.stringify(catalog, null, 2));
  const child = await session.spawn(electron, [path.join(temporary, 'template-acquisition-electron.cjs'), `--user-data-dir=${temporary}/profile`], {
    cwd: temporary, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, GITHUB_TOKEN: undefined, GH_TOKEN: undefined, REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE: evidence, REDEVEN_TEMPLATE_PRELOAD: path.join(temporary, 'template-acquisition-preload.cjs') },
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
  const exit = await session.wait(child, 180000);
  assert.equal(exit.code, 0);
  assert.ok(output.includes('Assertions complete: anonymous Desktop source acquisition'));
  const summary = JSON.parse(await readFile(path.join(evidence, 'desktop-acquisition.json'), 'utf8'));
  assert.equal(summary.templates.length, 4);
  assert.ok(summary.templates.every(item => item.requests.length === 1 && item.requests[0].host === 'codeload.github.com' && item.requests[0].status === 200));
});
