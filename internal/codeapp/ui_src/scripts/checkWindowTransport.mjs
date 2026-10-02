/* global window, document, parent, RedevenWindowTransport */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../../envapp/ui_src/package.json', import.meta.url));
const { chromium, _electron } = require('playwright');
const fixture = JSON.parse(process.env.REDEVEN_WINDOW_FIXTURE);
const electron = process.env.REDEVEN_WINDOW_BROWSER === 'electron';
const root = path.resolve(import.meta.dirname, '../../../..');
let browser, application, directory;
// This disposable Runtime uses its test CA, never the user's trust store.
try {
  if (!electron) browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--redeven-window-transport-acceptance'] });
  for (const profile of fixture.profiles.filter(profile => !electron || profile.kind === 'private')) {
    let context, page;
    if (electron) {
      const desktop = createRequire(path.join(root, 'desktop/package.json'));
      execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
      directory = await mkdtemp(path.join(tmpdir(), 'redeven-window-transport-'));
      const runner = path.join(directory, 'fixture.cjs');
      await desktop('esbuild').build({ entryPoints: [path.join(root, 'desktop/scripts/fixtures/window-transport.ts')], outfile: runner,
        bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
      // Playwright owns this launch's isolated process group and its teardown.
      application = await _electron.launch({ executablePath: desktop('electron'), cwd: directory,
        args: [runner, `--user-data-dir=${directory}/profile`, `--redeven-window-transport-run=${randomUUID()}`],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_WINDOW_ELECTRON_FIXTURE: JSON.stringify({ ...profile, forward: fixture.forward }) } });
      context = application.context();
      page = await application.firstWindow();
    } else {
      context = await browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: profile.token ? { 'X-Redeven-Desktop-Bridge-Token': profile.token } : {} });
      await context.grantPermissions(['local-network-access'], { origin: profile.origin });
      page = await context.newPage();
    }
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    const sockets = [];
    const requests = [];
    page.on('response', response => { requests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    page.on('websocket', socket => { sockets.push(socket.url()); socket.on('socketerror', error => failures.push(String(error))); });
    await page.addInitScript(() => {
      const NetworkSocket = window.WebSocket;
      window.carriers = [];
      window.socketEvents = [];
      window.WebSocket = class extends NetworkSocket {
        constructor(...args) { super(...args); window.carriers.push(this); this.addEventListener('close', event => window.socketEvents.push({ code: event.code, reason: event.reason })); }
      };
    });
    const base = '/pf/' + fixture.forward;
    await page.route('**/transport-test.html', route => route.fulfill({ contentType: 'text/html', body: `<html data-redeven-window><script src="${base}/_redeven_proxy/window-transport.js"></script></html>` }));
    await page.goto(profile.origin + base + '/transport-test.html');
    await page.evaluate(({ profile, forward, base }) => {
      window.transport = RedevenWindowTransport.create({ kind: profile.kind, forward_id: forward, base });
    }, { profile, forward: fixture.forward, base });
    const inspect = async () => {
      let timer;
      try { return await Promise.race([page.evaluate(async base => {
        try {
          const response = await window.transport.fetch(base + '/_redeven_desktop/ticket', { method: 'POST' });
          const ticket = await response.json();
          return { status: response.status, ok: ticket.ok, hasToken: Boolean(ticket.data?.token) };
        } catch (error) { throw new Error(JSON.stringify({ name: error.name, message: error.message, code: error.code, cause: error.cause?.message })); }
      }, base), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('window ticket timed out')), 15000); })]); }
      catch (error) { console.error({ requests, sockets, failures, closes: await page.evaluate(() => window.socketEvents) }); throw error; }
      finally { clearTimeout(timer); }
    };
    assert.deepEqual(await inspect(), { status: 200, ok: true, hasToken: true });
    await page.route('**/prepared-xpra-test.html', route => route.fulfill({ contentType: 'text/html',
      body: '<html data-floe-host-transport="required"><script src="/_redeven_proxy/window-transport.js"></script></html>' }));
    await page.evaluate(base => {
      const frame = document.createElement('iframe');
      frame.id = 'application';
      frame.src = base + '/prepared-xpra-test.html';
      document.body.append(frame);
    }, base);
    const child = await page.waitForSelector('#application').then(element => element.contentFrame());
    await child.waitForFunction(() => window.floeHostTransport);
    assert.equal(await child.evaluate(() => window.floeHostTransport.WebSocket === parent.redevenWindowTransport.WebSocket), true,
      'prepared Xpra must inherit the exact parent-owned native constructor');
    assert.equal(await page.evaluate(async base => (await fetch(base + '/_redeven_desktop/ticket', { method: 'POST' })).status, base), 403);
    assert.equal(await page.evaluate(async () => {
      try { await window.transport.fetch('/pf/other/_redeven_desktop/ticket', { method: 'POST' }); return false; } catch { return true; }
    }), true);
    await page.evaluate(() => window.carriers.at(-1).close());
    assert.deepEqual(await inspect(), { status: 200, ok: true, hasToken: true });
    assert.ok(sockets.length >= 2, 'reconnection must acquire a fresh native carrier');
    assert.ok(sockets.every(url => new URL(url).pathname === '/flowersec/v3/direct'), 'no raw graphical data sockets');
    await page.evaluate(() => window.transport.dispose());
    assert.equal(await page.evaluate(async base => {
      try { await window.transport.fetch(base + '/_redeven_desktop/ticket'); return false; } catch { return true; }
    }, base), true);
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ client: electron ? 'electron' : 'chromium', profile: profile.kind, protocol: new URL(profile.origin).protocol, carriers: sockets.length, ticket: true, reconnect: true, rawRejected: true, disposed: true }));
    if (!electron) await context.close();
  }
} finally {
  await application?.close();
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}
