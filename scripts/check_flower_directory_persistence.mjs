import { createDesktopTestSession } from './desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 120000 });
await session.run(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const desktop = createRequire(path.join(root, 'desktop/package.json'));
  const ui = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
  const { _electron } = ui('playwright');
  const { build: bundle } = desktop('esbuild');
  const { build } = await import(pathToFileURL(desktop.resolve('vite')));
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-directory-persistence-'));
  await session.directory(temporary);
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  for (const [source, output] of [['directoryPersistenceDesktop.ts', 'main.cjs'], ['directoryPersistencePreload.ts', 'preload.cjs']]) {
    await bundle({ entryPoints: [path.join(root, 'internal/flower_ui/testing/performance', source)], outfile: path.join(temporary, output),
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  }
  const dist = path.join(temporary, 'dist');
  await build({ configFile: path.join(root, 'desktop/vite.welcome.config.mjs'), logLevel: 'error', build: { outDir: dist, emptyOutDir: true,
    cssCodeSplit: false, rollupOptions: { input: path.join(root, 'internal/flower_ui/testing/performance/directoryPersistence.tsx'), output: { entryFileNames: 'fixture.js' } } } });
  const css = (await readdir(path.join(dist, 'assets'))).filter(value => value.endsWith('.css'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8">'
    + css.map(value => '<link rel="stylesheet" href="/assets/' + value + '">').join('')
    + '</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(target)); }
    catch { response.writeHead(404).end(); }
  });
  await session.defer('directory preference fixture server', () => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await session.port(server.address().port);
  const launch = () => session.launchElectron(_electron, { executablePath: desktop('electron'), args: [path.join(temporary, 'main.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PREFERENCE_PROFILE: path.join(temporary, 'profile'), FLOWER_PREFERENCE_URL: `http://127.0.0.1:${server.address().port}` } });
  const first = await launch();
  const page = await first.firstWindow();
  await page.getByRole('radio', { name: 'Directory' }).click();
  assert.equal(await page.getByRole('radio', { name: 'Directory' }).getAttribute('aria-checked'), 'true');
  await session.closeElectron(first);
  const second = await launch();
  const reopened = await second.firstWindow();
  assert.equal(await reopened.getByRole('radio', { name: 'Directory' }).getAttribute('aria-checked'), 'true');
  assert.equal(await reopened.evaluate(() => localStorage.length), 0);
  await session.closeElectron(second);
  console.log('Flower directory preference survives an Electron restart with an ephemeral renderer partition.');
});
