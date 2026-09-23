import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createBuiltDistTLS, trustBuiltDistWebTransport } from './checkPackagedRenderer.mjs';
import { navigationKey, navigationRecord, createContinuityServer, recordDocumentPaints } from './fixtures/startupContinuity.mjs';

const artifact = process.env.REDEVEN_FILES_ARTIFACT_DIR;
if (artifact) await mkdir(artifact, { recursive: true });
const tls = await createBuiltDistTLS();
const server = await createContinuityServer(tls, { fileContinuity: true });
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`] });
const paint = page => page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
try {
  for (const mode of ['List', 'Grid']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await trustBuiltDistWebTransport(page, tls);
    await page.addInitScript(({ key, record, viewMode }) => {
      if (!globalThis.localStorage.getItem(key)) globalThis.localStorage.setItem(key, JSON.stringify(record));
      globalThis.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
      globalThis.localStorage.setItem('redeven-envapp:env_local-files:env_local:fileBrowser:viewMode', JSON.stringify(viewMode));
    }, { key: navigationKey, record: navigationRecord('files'), viewMode: mode.toLowerCase() });
    await page.addInitScript(() => {
      globalThis.__fileFrames = [];
      const visible = element => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      const sample = () => {
        const main = globalThis.document.querySelector('[data-floe-shell-slot="main"]');
        const state = {
          workspace: visible(main?.querySelector('[data-browser-workspace]')) || false,
          loading: visible(main?.querySelector('[data-file-browser-initial-loading]')) || false,
          empty: /This folder is empty|No folders in this location/.test(main?.textContent ?? ''),
          generic: (main?.textContent ?? '').includes('Loading page...'),
          curtain: visible(main?.querySelector('.redeven-loading-curtain')) || false,
          row: visible(main?.querySelector('[data-file-browser-item-id="/workspace/continuity-file.txt"]')) || false,
          placeholder: !!globalThis.document.querySelector('[data-floe-reload-placeholder]'),
        };
        const frames = globalThis.__fileFrames;
        if (JSON.stringify(frames.at(-1)) !== JSON.stringify(state)) frames.push(state);
        globalThis.requestAnimationFrame(sample);
      };
      globalThis.requestAnimationFrame(sample);
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const releaseModule = server.hold('files-module');
    const releaseContext = server.hold('file-context');
    const releaseListing = server.hold('file-list');
    const workspace = page.locator('[data-browser-workspace]').first();
    const pending = page.locator('[data-file-browser-initial-loading]').first();
    const row = page.locator('[data-file-browser-item-id="/workspace/continuity-file.txt"]').first();
    const itemGeometry = element => ({
      box: element.getBoundingClientRect().toJSON(),
      cells: [...element.children].slice(0, element.hasAttribute('data-file-list-row') ? 3 : 2).map(child => child.getBoundingClientRect().toJSON()),
    });
    try {
      await page.goto(new URL('_redeven_proxy/env/', server.baseURL).href, { waitUntil: 'commit' });
      await pending.waitFor();
      await paint(page);
      const initialBounds = await page.waitForFunction(() => {
        const rect = globalThis.document.querySelector('[data-browser-workspace]')?.getBoundingClientRect();
        return rect?.width && rect.height ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      }).then(handle => handle.jsonValue());
      assert.equal(await page.getByRole('radio', { name: mode, exact: true }).getAttribute('aria-checked'), 'true', 'Module fallback restores the actual view mode');
      assert.ok(await page.locator('[data-file-browser-placeholder]').count() > 0);
      const initialItemGeometry = await page.locator('[data-file-browser-placeholder]').first().evaluate(itemGeometry);
      assert.equal(await page.getByText('Loading files...', { exact: true }).count(), 0);
      if (artifact) await page.screenshot({ path: `${artifact}/files-${mode}-initial.png` });
      releaseModule();
      await page.waitForFunction(() => globalThis.document.querySelector('[data-browser-mode-stack]'));
      await paint(page);
      assert.deepEqual(await workspace.boundingBox(), initialBounds, 'Module handoff must retain the workspace layout');
      assert.equal(await pending.isVisible(), true);
      assert.deepEqual(await page.locator('[data-file-browser-placeholder]').first().evaluate(itemGeometry), initialItemGeometry, 'Module and data placeholders share item geometry');
      releaseContext();
      await page.waitForFunction(() => globalThis.document.querySelector('[data-filesystem-root-id]') || globalThis.document.querySelector('[data-browser-mode-stack]'));
      await paint(page);
      assert.equal(await pending.isVisible(), true);
      releaseListing();
      await row.waitFor();
      await pending.waitFor({ state: 'detached' });
      await page.getByRole('radio', { name: mode, exact: true }).click();
      await paint(page);
      assert.deepEqual(await workspace.boundingBox(), initialBounds);
      assert.deepEqual(await row.evaluate(itemGeometry), initialItemGeometry, 'Initial placeholders match actual item and cell geometry');
      const coldFrames = await page.evaluate(() => globalThis.__fileFrames);
      assert.ok(coldFrames.every(frame => !frame.empty && !frame.generic && !frame.curtain), JSON.stringify(coldFrames));
      // Same-path refresh never replaces the existing tree, rows, or focused filter.
      const refresh = server.hold('file-list');
      await row.evaluate(element => { globalThis.__fileRow = element; });
      const filter = page.getByRole('textbox', { name: 'Filter files', exact: true });
      await page.getByRole('button', { name: 'Refresh current directory', exact: true }).click();
      await filter.fill('continuity');
      assert.equal(await row.evaluate(element => element === globalThis.__fileRow), true);
      assert.equal(await pending.count(), 0);
      refresh();
      await page.waitForFunction(() => !globalThis.document.querySelector('[aria-label="Refresh current directory"]:disabled'));
      assert.equal(await row.evaluate(element => element === globalThis.__fileRow), true, 'Completed refresh retains the row node');
      assert.equal(await filter.inputValue(), 'continuity');
      assert.equal(await filter.evaluate(element => globalThis.document.activeElement === element), true);
      await filter.fill('');
      await paint(page);
      if (artifact) await page.screenshot({ path: `${artifact}/files-${mode}-ready.png` });
      await page.evaluate(() => globalThis.window.dispatchEvent(new Event('pagehide')));
      const entry = server.hold('entry');
      const listing = server.hold('file-list');
      const finishPaints = await recordDocumentPaints(cdp);
      let paints;
      try {
        await page.reload({ waitUntil: 'commit' });
        await page.locator('[data-floe-reload-placeholder]').waitFor();
        assert.equal(await workspace.count(), 0);
        if (artifact) {
          const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(`${artifact}/files-${mode}-reload.png`, Buffer.from(screenshot.data, 'base64'));
        }
        entry();
        await pending.waitFor();
        assert.equal(await page.locator('[data-floe-reload-placeholder]').count(), 1);
        listing();
        await row.waitFor();
        await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
        await paint(page);
        const frames = await page.evaluate(() => globalThis.__fileFrames);
        assert.ok(frames.every(frame => !frame.generic && !frame.empty && !frame.curtain), JSON.stringify(frames));
        assert.ok(frames.filter(frame => frame.workspace).every(frame => frame.placeholder || frame.row), JSON.stringify(frames));
        paints = await finishPaints();
        assert.ok(paints.count > 0);
        assert.deepEqual(paints.blank, []);
        console.log('PASS Files startup, refresh and full reload:', JSON.stringify({ mode, coldFrames, frames, paints }));
      } finally { entry(); listing(); if (!paints) await finishPaints(); }
      // A confirmed empty result is renderable; a transport failure has a retry, never a false empty state.
      server.setEmpty(true);
      await page.getByRole('button', { name: 'Refresh current directory', exact: true }).click();
      await page.getByText('This folder is empty', { exact: true }).waitFor();
      await page.reload();
      await page.getByText('This folder is empty', { exact: true }).waitFor();
      await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
      server.setEmpty(false);
      server.setFilesFailure(503);
      await page.reload();
      await page.locator('[data-testid="file-browser-navigation-failure"]').waitFor();
      assert.equal(await pending.count(), 0);
      assert.equal(await page.getByText('This folder is empty', { exact: true }).count(), 0);
      assert.equal(await page.locator('[data-floe-reload-placeholder]').count(), 0);
      server.setFilesFailure(0);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await row.waitFor();
      assert.deepEqual(errors, []);
      console.log('PASS Files empty, failed restore and explicit retry:', mode);
      server.setReadDenied(true);
      const denied = page.waitForResponse(response => response.url().endsWith('/api/local/environment'));
      await page.reload();
      await denied;
      await page.locator('[data-floe-reload-placeholder]').waitFor({ state: 'detached' });
      await paint(page);
      assert.equal(await row.count(), 0);
      assert.equal(await page.evaluate(() => globalThis.sessionStorage.getItem('redeven-envapp:reload-layout')), null);
      assert.ok((await page.evaluate(() => globalThis.__fileFrames)).every(frame => !frame.row));
      console.log('PASS Files denied access never presents old content:', mode);
    } catch (error) {
      console.error('Files continuity failure:', { mode, body: await page.locator('body').innerText(), requests: server.requests.slice(-30) });
      throw error;
    } finally {
      releaseModule(); releaseContext(); releaseListing(); server.releaseAll(); server.setEmpty(false); server.setFilesFailure(0); server.setReadDenied(false); await context.close();
    }
  }
} finally { await browser.close(); await server.close(); await tls.cleanup(); }
