import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';
import { cachePages, navigationKey, navigationRecord, createContinuityServer, observeContinuityFrames, recordDocumentPaints } from './fixtures/startupContinuity.mjs';

const artifact = process.env.REDEVEN_RELOAD_ARTIFACT_DIR;
if (artifact) await mkdir(artifact, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createContinuityServer(tls);
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] });
const nextPaint = page => page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
try {
  for (const [target, selectors] of Object.entries(cachePages)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await trustBuiltDistWebTransport(page, tls);
    await page.addInitScript(({ key, record }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(record));
      localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    }, { key: navigationKey, record: navigationRecord(target) });
    await page.addInitScript(observeContinuityFrames, selectors);
    await page.goto(new URL('_redeven_proxy/env/', server.baseURL).href);
    const row = page.locator(selectors.row).filter({ hasText: selectors.title }).first();
    await row.waitFor();
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-floe-shell-slot="main"] .animate-spin'));
    await nextPaint(page);
    const bounds = await row.boundingBox();
    // Flush durable content before testing a new document and its initial access checks.
    await page.evaluate(() => globalThis.window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(async () => {
      const db = await new Promise(resolve => { const request = globalThis.indexedDB.open('redeven-resource-cache'); request.onsuccess = () => resolve(request.result); });
      try { return await new Promise(resolve => { const request = db.transaction('snapshots').objectStore('snapshots').count(); request.onsuccess = () => resolve(request.result > 0); }); } finally { db.close(); }
    });
    const entry = server.hold('entry');
    const permissions = server.hold('permissions');
    const scope = server.hold('scope');
    const data = server.hold('data');
    const finishPaints = await recordDocumentPaints(cdp);
    let paints;
    try {
      await page.reload({ waitUntil: 'commit' });
      await page.locator('[data-floe-reload-placeholder]').waitFor();
      await nextPaint(page);
      assert.equal(await page.locator('[data-floe-shell]').count(), 0, 'The application module is held');
      const record = await page.evaluate(() => JSON.parse(sessionStorage.getItem('redeven-envapp:reload-layout')));
      assert.ok(record.boxes.some(box => Math.abs(box[0] - bounds.x) < 1 && Math.abs(box[1] - bounds.y) < 1 && Math.abs(box[2] - bounds.width) < 1 && Math.abs(box[3] - bounds.height) < 1), `${target}: the prior real row boundary must survive`);
      assert.ok(!JSON.stringify(record).includes(selectors.title), 'Geometry cannot persist resource content');
      if (artifact) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(`${artifact}/${target}-before-module.png`, Buffer.from(shot.data, 'base64'));
      }
      entry();
      await page.locator('[data-floe-shell-slot="main"]').waitFor();
      await nextPaint(page);
      assert.equal(await row.count(), 0, 'No cached facts before identity confirmation');
      assert.equal(await page.locator('[data-floe-reload-placeholder]').count(), 1, 'Do not reveal a second skeleton while access is pending');
      permissions();
      await nextPaint(page);
      assert.equal(await page.locator('[data-floe-reload-placeholder]').count(), 1);
      scope();
      await row.waitFor();
      await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
      await row.evaluate(element => { globalThis.__reloadRow = element; element.setAttribute('tabindex', '-1'); element.focus(); });
      data();
      await page.waitForFunction(() => !globalThis.document.querySelector('[data-floe-shell-slot="main"] .animate-spin'));
      assert.equal(await row.evaluate(element => element === globalThis.__reloadRow && globalThis.document.activeElement === element), true);
      await nextPaint(page);
      const frames = await page.evaluate(() => globalThis.__continuityFrames);
      assert.ok(frames.length > 0);
      assert.ok(frames.every(frame => frame.documentLoading || frame.placeholder || frame.row), `${target}: blank or mismatched skeleton frame: ${JSON.stringify(frames)}`);
      const content = frames.findIndex(frame => frame.row && !frame.placeholder);
      assert.ok(content >= 0 && frames.slice(content).every(frame => frame.row && !frame.placeholder && !frame.skeleton), `${target}: content must not regress`);
      assert.deepEqual(errors, []);
      paints = await finishPaints();
      assert.ok(paints.count > 0, 'Observe actual compositor paints');
      assert.deepEqual(paints.blank, [], `${target}: no blank document paint`);
      console.log(`PASS complete document reload: ${target}`, JSON.stringify({ bounds, paints, frames }));
      server.setReadDenied(true);
      const denied = page.waitForResponse(response => response.url().endsWith('/api/local/environment'));
      await page.reload();
      await denied;
      await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
      await nextPaint(page);
      assert.equal(await row.count(), 0, `${target}: revoked read access cannot display cached facts`);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('redeven-envapp:reload-layout')), null, 'Revocation removes old geometry');
      assert.ok((await page.evaluate(() => globalThis.__continuityFrames)).every(frame => !frame.row), 'Denied content is never painted');
      console.log(`PASS document reload denial: ${target}`);
    } finally { if (!paints) await finishPaints(); server.setReadDenied(false); entry(); permissions(); scope(); data(); await context.close(); }
  }
} finally { server.releaseAll(); await browser.close(); await server.close(); await tls.cleanup(); }
