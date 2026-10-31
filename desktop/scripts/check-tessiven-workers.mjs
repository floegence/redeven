import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as buildMain } from 'esbuild';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import welcomeConfig from '../vite.welcome.config.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 120000 });
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-tessiven-workers-')));
  const output = path.join(root, 'desktop/dist/tessiven-worker-acceptance');
  await mkdir(output, { recursive: true });
  const fixtureRoot = path.join(root, 'desktop/scripts/fixtures');
  const dist = path.join(state, 'renderer');
  await build({ ...welcomeConfig, configFile: false, root: fixtureRoot, base: '/_redeven_proxy/env/', logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: path.join(fixtureRoot, 'tessiven-worker.html') } } });
  await buildMain({ entryPoints: [path.join(root, 'desktop/src/main/desktopSessionTransport.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(state, 'transport.cjs') });
  const token = randomBytes(32).toString('base64url');
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const authorized = request.headers['x-redeven-desktop-bridge-token'] === token;
    requests.push({ pathname, authorized });
    if (!authorized) { response.writeHead(401).end(); return; }
    const target = path.resolve(dist, '.' + pathname.replace('/_redeven_proxy/env/', '/'));
    if (!target.startsWith(dist + path.sep)) { response.writeHead(404).end(); return; }
    try {
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': target.endsWith('.js') ? 'text/javascript'
        : target.endsWith('.css') ? 'text/css' : target.endsWith('.wasm') ? 'application/wasm' : 'text/html' }).end(await readFile(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await session.port(server.address().port);
  await session.defer('server connections', () => server.closeAllConnections(), { phase: 'release' });
  await session.defer('server', () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, [
    "const { app, BrowserWindow, session } = require('electron');",
    "const { desktopPrivateBridgeRequestHeaders, desktopRequestSourceScope } = require('./transport.cjs');",
    "app.setPath('userData', process.env.TESSIVEN_PROFILE);",
    "globalThis.workerRequests = [];",
    "app.whenReady().then(() => {",
    "  const origin = process.env.TESSIVEN_ORIGIN;",
    "  const transport = { kind: 'native_local_bridge', baseURL: origin + '/', allowedBaseURL: origin + '/' };",
    "  const startup = { local_ui_bridge_token: process.env.TESSIVEN_TOKEN };",
    "  const network = session.fromPartition('tessiven-worker-acceptance');",
    "  network.webRequest.onBeforeSendHeaders((details, callback) => {",
    "    const scope = process.env.TESSIVEN_LEGACY === '1'",
    "      ? { requestingFrameURL: details.resourceType === 'mainFrame' ? details.url : details.frame?.url ?? '' }",
    "      : desktopRequestSourceScope(details);",
    "    const requestHeaders = desktopPrivateBridgeRequestHeaders(transport, startup, details.url, details.requestHeaders, scope);",
    "    globalThis.workerRequests.push({ path: new URL(details.url).pathname, frame: !!details.frame, initiatorOrigin: details.initiatorOrigin, authorized: !!requestHeaders['X-Redeven-Desktop-Bridge-Token'] });",
    "    callback({ requestHeaders });",
    "  });",
    "  const window = new BrowserWindow({ show: false, width: 1250, height: 820, webPreferences: { session: network, contextIsolation: true, sandbox: true, nodeIntegration: false } });",
    "  window.loadURL(origin + '/_redeven_proxy/env/tessiven-worker.html');",
    "});",
  ].join(String.fromCharCode(10)));
  const report = { scenarios: [] };
  for (const legacy of [true, false]) {
    requests.length = 0;
    const application = await session.launchElectron(_electron, { executablePath: electron, args: [entry],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, TESSIVEN_PROFILE: path.join(state, legacy ? 'legacy' : 'fixed'),
        TESSIVEN_ORIGIN: origin, TESSIVEN_TOKEN: token, TESSIVEN_LEGACY: legacy ? '1' : '0' } });
    try {
      const page = await application.firstWindow();
      if (legacy) {
        await page.waitForFunction(() => document.querySelector('.tessiven-canvas .tessiven-error')?.textContent);
        assert.match(await page.locator('.tessiven-error').textContent(), /Graph ELK worker failed/);
        assert.equal(await page.locator('.floe-graph__node').count(), 0);
        assert.ok(requests.some(request => request.pathname.includes('elk-worker') && !request.authorized));
      } else {
        await page.waitForFunction(() => document.querySelectorAll('.tessiven-node').length > 0 && !document.querySelector('[aria-label="Arranging canvas"]'));
        assert.equal(await page.locator('.tessiven-error').count(), 0);
        const zoom = page.locator('.tessiven-canvas-tools output');
        const before = await zoom.textContent();
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
        assert.notEqual(await zoom.textContent(), before);
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.tessiven-node').length > 0 && !document.querySelector('[aria-label="Arranging canvas"]'));
        assert.equal(await page.locator('.tessiven-error').count(), 0);
        assert.ok(requests.some(request => request.pathname.includes('elk-worker') && request.authorized));
        assert.ok(requests.every(request => request.authorized));
      }
      const workerRequests = await application.evaluate(() => globalThis.workerRequests.filter(request => request.path.includes('elk-worker')));
      assert.ok(workerRequests.some(request => !request.frame && request.initiatorOrigin === origin));
      report.scenarios.push({ mode: legacy ? 'legacy-reproduces-blank' : 'fixed-cold-load-zoom-reload',
        nodes: await page.locator('.floe-graph__node').count(), workerRequests });
      await page.screenshot({ path: path.join(output, legacy ? 'before.png' : 'after.png') });
    } finally { await session.closeElectron(application); }
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
