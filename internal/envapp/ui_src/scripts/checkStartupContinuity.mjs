import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';
import { cachePages, navigationPages, navigationKey, navigationRecord, createContinuityServer, observeContinuityFrames } from './fixtures/startupContinuity.mjs';

const tls = await createBuiltDistTLS();
const server = await createContinuityServer(tls);
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] });
console.log('Owned startup continuity runtime:', JSON.stringify({ port: new URL(server.baseURL).port, state: tls.directory, pid: process.pid }));
try {
  for (const [target, selectors] of Object.entries(cachePages)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.log('renderer', message.text()); });
    await trustBuiltDistWebTransport(page, tls);
    await page.addInitScript(({ key, record }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(record));
      localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    }, { key: navigationKey, record: navigationRecord(target) });
    await page.addInitScript(observeContinuityFrames, selectors);
    const url = new URL('_redeven_proxy/env/', server.baseURL).href;
    await page.goto(url);
    await page.locator(selectors.row).filter({ hasText: selectors.title }).first().waitFor();
    // pagehide flushes the cache writer; wait for a persisted snapshot before exercising a new owner.
    await page.evaluate(() => globalThis.window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve, reject) => { const request = globalThis.indexedDB.open('redeven-resource-cache'); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      try { return await new Promise(resolve => { const request = db.transaction('snapshots').objectStore('snapshots').count(); request.onsuccess = () => resolve(request.result > 0); }); } finally { db.close(); }
    });
    const permissions = server.hold('permissions'); const scope = server.hold('scope'); const data = server.hold('data');
    try {
      await page.reload();
      await page.locator(selectors.skeleton).first().waitFor();
      assert.equal(await page.locator(selectors.row).count(), 0);
      permissions();
      await page.waitForFunction(() => !!globalThis.document.querySelector('[data-floe-keep-alive-view]'));
      assert.equal(await page.locator(selectors.row).count(), 0, `${target}: no unconfirmed content`);
      scope();
      const row = page.locator(selectors.row).filter({ hasText: selectors.title }).first();
      await row.waitFor();
      assert.equal(await page.locator(selectors.skeleton).count(), 0, `${target}: restored content replaces skeleton once`);
      await row.evaluate(element => { globalThis.__continuityRow = element; element.setAttribute('tabindex', '-1'); element.focus(); });
      data();
      await page.waitForFunction(() => !globalThis.document.querySelector('[data-floe-shell-slot="main"] .animate-spin'));
      assert.equal(await row.evaluate(element => element === globalThis.__continuityRow && globalThis.document.activeElement === element), true, `${target}: retain row and focus`);
      const frames = await page.evaluate(() => globalThis.__continuityFrames);
      assert.ok(frames.filter(frame => frame.main).every(frame => frame.views.every(id => id === target)), `${target}: wrong target ${JSON.stringify(frames)}`);
      assert.ok(frames.filter(frame => frame.main).every(frame => frame.row || frame.skeleton), `${target}: blank frame ${JSON.stringify(frames)}`);
      const shown = frames.findIndex(frame => frame.row);
      assert.ok(shown >= 0 && frames.slice(shown).every(frame => frame.row && !frame.skeleton), `${target}: content regressed ${JSON.stringify(frames)}`);
      assert.deepEqual(errors, [], `${target}: renderer errors`);
      console.log(`PASS real Shell cache startup: ${target}`, JSON.stringify(frames));
      server.setDataFailure(true);
      await page.reload();
      await page.locator(selectors.row).filter({ hasText: selectors.title }).first().waitFor();
      await page.waitForFunction(() => !globalThis.document.querySelector('[data-floe-shell-slot="main"] .animate-spin'));
      assert.equal(await page.locator(selectors.skeleton).count(), 0, `${target}: failed refresh must retain cache`);
      server.setDataFailure(false);
      server.setEmpty(true);
      await page.reload();
      await page.waitForFunction(({ row, skeleton }) => !globalThis.document.querySelector(row) && !globalThis.document.querySelector(skeleton) && !!globalThis.document.querySelector('[data-floe-shell-slot="main"]') && !globalThis.document.querySelector('[data-floe-shell-slot="main"] .animate-spin'), selectors);
      await page.evaluate(() => globalThis.window.dispatchEvent(new Event('pagehide')));
      await page.waitForFunction(async target => {
        const db = await new Promise(resolve => { const request = globalThis.indexedDB.open('redeven-resource-cache'); request.onsuccess = () => resolve(request.result); });
        const entries = await new Promise(resolve => { const request = db.transaction('snapshots').objectStore('snapshots').getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
        const key = target === 'applications' ? 'host-applications:en-US' : target === 'ports' ? 'web-service-forwards' : target === 'codespaces' ? 'codespaces' : null;
        return entries.some(entry => {
          const identity = JSON.parse(entry.key)[1];
          if (key ? identity !== key : !identity.includes('containers') || identity === 'container-runtimes') return false;
          const data = JSON.parse(entry.value).data;
          return target === 'applications' ? data.applications.length === 0 : Array.isArray(data) && data.length === 0;
        });
      }, target);
      const releaseEmpty = server.hold('data');
      const releaseEmptyScope = server.hold('scope');
      try {
        await page.reload();
        await page.locator(selectors.skeleton).waitFor();
        releaseEmptyScope();
        await page.locator(selectors.skeleton).waitFor({ state: 'detached' });
        assert.equal(await page.locator(selectors.row).count(), 0, `${target}: successful empty cache`);
      } finally { releaseEmptyScope(); releaseEmpty(); }
      // Corrupt disk payloads are discarded while the current page keeps its structural placeholder.
      await page.evaluate(async () => {
        const db = await new Promise(resolve => { const request = globalThis.indexedDB.open('redeven-resource-cache'); request.onsuccess = () => resolve(request.result); });
        await new Promise(resolve => { const transaction = db.transaction('snapshots', 'readwrite'); const request = transaction.objectStore('snapshots').openCursor(); request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.update({ ...cursor.value, value: '{' }); cursor.continue(); } }; transaction.oncomplete = resolve; }); db.close();
      });
      server.setEmpty(false);
      const releaseCorrupt = server.hold('data');
      try {
        await page.reload();
        await page.locator(selectors.skeleton).waitFor();
        assert.equal(await page.locator(selectors.row).count(), 0);
        releaseCorrupt();
        await page.locator(selectors.row).filter({ hasText: selectors.title }).first().waitFor();
      } finally { releaseCorrupt(); }
      console.log(`PASS real Shell empty, corrupt, and failed refresh: ${target}`);

    } catch (error) {
      console.log('FAILED STARTUP', target, server.requests, await page.evaluate(async () => {
        const db = await new Promise(resolve => { const request = globalThis.indexedDB.open('redeven-resource-cache'); request.onsuccess = () => resolve(request.result); });
        const entries = await new Promise(resolve => { const request = db.transaction('snapshots').objectStore('snapshots').getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
        return { text: globalThis.document.body.innerText, frames: globalThis.__continuityFrames, entries };
      }));
      throw error;
    } finally { server.setEmpty(false); server.setDataFailure(false); permissions(); scope(); data(); await context.close(); }
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await trustBuiltDistWebTransport(page, tls);
  await page.goto(new URL('_redeven_proxy/env/', server.baseURL).href);
  for (const target of navigationPages) {
    await page.evaluate(({ key, record }) => { localStorage.setItem(key, JSON.stringify(record)); localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity'); }, { key: navigationKey, record: navigationRecord(target) });
    await page.reload();
    await page.locator(`[data-floe-keep-alive-view="${target}"]`).waitFor();
    const visible = await page.locator('[data-floe-keep-alive-view]:visible').evaluateAll(elements => elements.map(element => element.getAttribute('data-floe-keep-alive-view')).filter(id => id !== 'activity' && id !== 'workbench'));
    assert.deepEqual(visible, [target]);
    console.log(`PASS real Shell navigation reload: ${target}`);
  }
  await context.close();
} finally { server.releaseAll(); await browser.close(); await server.close(); await tls.cleanup(); }
