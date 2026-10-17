import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  observeContinuityFrames,
  cachePages,
  recordDocumentPaints,
} from '../../internal/envapp/ui_src/scripts/fixtures/startupContinuity.mjs';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 420000,
});
await session.run(async () => {
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(path.join(desktop, 'package.json'));
  const { _electron } = createRequire(path.join(desktop, '../internal/envapp/ui_src/package.json'))('playwright');
  const target = process.env.REDEVEN_CONTINUITY_PAGE ?? 'applications';
  assert.ok(['applications', 'files'].includes(target), 'Unsupported continuity page');
  const presentation =
    target === 'files' ? { row: '[data-file-browser-item-id]', skeleton: '[data-file-browser-initial-loading]' } : cachePages.applications;
  const navigationLabel = target === 'files' ? /^(File Browser|文件浏览器)$/ : /^(Host Applications|主机应用)$/;
  const busySelector = target === 'files' ? '[aria-label="Refresh current directory"]:disabled' : '.host-apps-header .animate-spin';
  const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
  assert.ok(bundle, 'Build a task-owned Runtime and set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT');
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-content-'));
  await session.directory(directory);
  await session.target(path.join(bundle, 'redeven'), path.join(directory, 'state'));
  const marker = randomUUID();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function eventually(probe, message, timeout = 60000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const result = await probe();
      if (result) return result;
      await sleep(50);
    }
    throw new Error(message);
  }
  async function freePort() {
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    return port;
  }
  execFileSync(path.join(desktop, '../scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
  console.log(
    'Production continuity artifact:',
    JSON.stringify({
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: desktop,
        encoding: 'utf8',
      }).trim(),
      manifest,
      directory,
      marker,
    }),
  );
  for (const phase of ['initial', 'restart']) {
    const runtimePort = await freePort();
    const application = await session.launchElectron(_electron, {
      executablePath: require('electron'),
      args: [desktop, `--user-data-dir=${directory}/profile`, `--redeven-content-run=${marker}`],
      cwd: directory,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        REDEVEN_STATE_ROOT: `${directory}/state`,
        REDEVEN_DESKTOP_USER_DATA_ROOT: `${directory}/profile`,
        REDEVEN_DESKTOP_CACHE_ROOT: `${directory}/cache`,
        REDEVEN_DESKTOP_TEMP_ROOT: `${directory}/temp`,
        REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1',
        REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
        REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${runtimePort}`,
        REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle,
        REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version,
        REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
      },
    });
    const child = application.process();
    await session.port(runtimePort);
    let log = '';
    child.stdout.on('data', (chunk) => {
      log += chunk;
    });
    child.stderr.on('data', (chunk) => {
      log += chunk;
    });
    let welcome;
    try {
      const context = application.context();
      await context.addInitScript(() => {
        const NativeWebSocket = window.WebSocket;
        globalThis.__continuitySockets = [];
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            globalThis.__continuitySockets.push(this);
          }
        };
      });
      welcome = await eventually(() => context.pages().find((page) => page.url().includes('/welcome/')), `Welcome did not open: ${log}`);
      const open = () => welcome.getByRole('button', { name: /^(Open|Show|打开|显示) Env App$/ }).first();
      await open().click({ timeout: 60000 });
      let page = await eventually(
        () => context.pages().find((page) => page.url().includes('/_redeven_proxy/env/')),
        'Env App did not open from Welcome',
      );
      page.setDefaultTimeout(30000);
      if (phase === 'initial') {
        await page.getByText('Activity', { exact: true }).click();
        await page.getByRole('button', { name: navigationLabel, exact: true }).click();
      }
      await page.locator(presentation.row).first().waitFor();
      await page.waitForFunction((selector) => !document.querySelector(selector), busySelector);
      const assets = await page.evaluate(() => [...document.scripts].map((script) => script.src).filter(Boolean));
      console.log(
        'Assertions complete: production Welcome entry:',
        JSON.stringify({
          target,
          phase,
          pid: child.pid,
          runtimePort,
          url: page.url(),
          assets,
          fingerprint: createHash('sha256')
            .update(JSON.stringify(assets.map((url) => new URL(url).pathname)))
            .digest('hex'),
        }),
      );
      // Reload the actual production document, holding its entry module before the Shell exists.
      await page.addInitScript(observeContinuityFrames, presentation);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      let releaseEntry;
      const entryGate = new Promise((resolve) => {
        releaseEntry = resolve;
      });
      const entryURL = assets.find((url) => /\/assets\/index-[^/]+\.js$/.test(new URL(url).pathname));
      assert.ok(entryURL, 'Production entry module is identifiable');
      await page.route(entryURL, async (route) => {
        await entryGate;
        await route.continue().catch(() => {});
      });
      const reloadCDP = await context.newCDPSession(page);
      const finishPaints = await recordDocumentPaints(reloadCDP);
      let paints;
      try {
        await page.reload({ waitUntil: 'commit' });
        await page.locator('[data-floe-reload-placeholder]').waitFor();
        assert.equal(await page.locator('[data-floe-shell]').count(), 0, 'The entry module must really be delayed');
        releaseEntry();
        await page.locator(presentation.row).first().waitFor();
        await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
        await page.waitForFunction((selector) => !document.querySelector(selector), busySelector);
        const frames = await page.evaluate(() => globalThis.__continuityFrames);
        assert.ok(
          frames.length && frames.every((frame) => frame.documentLoading || frame.placeholder || frame.row),
          JSON.stringify(frames),
        );
        const content = frames.findIndex((frame) => frame.row && !frame.placeholder);
        assert.ok(
          content >= 0 && frames.slice(content).every((frame) => frame.row && !frame.skeleton && !frame.placeholder),
          JSON.stringify(frames),
        );
        paints = await finishPaints();
        assert.ok(paints.count > 0);
        assert.deepEqual(paints.blank, [], 'Production reload must not paint a blank document');
        console.log('Assertions complete: production full document reload:', JSON.stringify({ phase, paints, frames }));
      } finally {
        if (!paints) await finishPaints();
        await reloadCDP.detach();
        releaseEntry();
        await page.unroute(entryURL);
      }
      if (phase === 'initial') {
        await page.evaluate(() => {
          globalThis.__continuityFrames.length = 0;
        });
        await page
          .locator(presentation.row)
          .first()
          .evaluate((row) => {
            globalThis.__retainedRow = row;
          });
        await page.evaluate(() => window.redevenDesktopShell.minimizeWindow());
        await open().click();
        assert.equal(
          await page
            .locator(presentation.row)
            .first()
            .evaluate((row) => row === globalThis.__retainedRow),
          true,
        );
        const reconfirmed = page.waitForResponse((response) => response.url().endsWith('/ui-cache-scope') && response.status() === 200);
        const closed = await page.evaluate(() => {
          const sockets = globalThis.__continuitySockets.filter((socket) => socket.readyState === WebSocket.OPEN);
          sockets.forEach((socket) => socket.close(4001, 'Continuity test transport interruption'));
          return sockets.length;
        });
        assert.ok(closed > 0, 'The production connection must actually be interrupted');
        await reconfirmed;
        await page.getByRole('button', { name: /^(Reconnect|重新连接|重连)$/ }).waitFor({ timeout: 60000 });
        await page.waitForFunction((selector) => !document.querySelector(selector), busySelector);
        assert.equal(
          await page
            .locator(presentation.row)
            .first()
            .evaluate((row) => row === globalThis.__retainedRow),
          true,
        );
        const frames = await page.evaluate(() => globalThis.__continuityFrames);
        assert.ok(frames.length && frames.every((frame) => frame.row && !frame.skeleton), JSON.stringify(frames));
        console.log(
          'Assertions complete: production hide/show and reconnect:',
          JSON.stringify({
            interruptedSockets: closed,
            reconfirmed: true,
            frames,
          }),
        );
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await page.evaluate(() => window.redevenDesktopShell.closeWindow()).catch(() => {});
        await eventually(() => page.isClosed(), 'Env App close did not destroy its window');
        await open().click();
        page = await eventually(
          () => context.pages().find((candidate) => candidate.url().includes('/_redeven_proxy/env/')),
          'Env App did not reopen',
        );
        await page.locator(presentation.row).first().waitFor();
        console.log('Assertions complete: production close/reopen retains Activity target and inventory');
      }
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      if (target === 'applications')
        await eventually(
          async () => (await page.evaluate(() => window.redevenDesktopResourceCache.list())).length > 0,
          'Desktop cache did not persist',
        );
    } catch (error) {
      console.error('Production Desktop failure:', error, log.slice(-16000));
      for (const page of application.context().pages())
        console.error(
          'Window:',
          page.url(),
          await page
            .locator('body')
            .innerText()
            .catch(() => 'unavailable'),
        );
      throw error;
    } finally {
      await session.closeElectron(application);
      assert.equal(child.signalCode, null);
      assert.equal(child.exitCode, 0);
      console.log('Assertions complete: production Desktop shutdown:', phase);
    }
  }
});
