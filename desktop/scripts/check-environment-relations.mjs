import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

async function assertGridAlignment(page, label) {
  const failures = await page.locator('.redeven-environment-grid:visible').evaluateAll(grids => grids.flatMap(grid => {
    const cards = [...grid.querySelectorAll('[data-environment-group]')].map(card => {
      const bounds = card.getBoundingClientRect();
      const owner = [...card.querySelectorAll('[data-owner-id]')].find(el => !el.closest('[aria-hidden="true"]'));
      const footer = owner.lastElementChild.getBoundingClientRect();
      return { height: bounds.height, top: Math.round(bounds.top), titleTop: owner.querySelector('h3').getBoundingClientRect().top, footerTop: footer.top, footerBottom: footer.bottom };
    });
    if (!cards.length) return [];
    const unequal = Math.max(...cards.map(card => card.height)) - Math.min(...cards.map(card => card.height)) > 1;
    const footerDrift = cards.some(card => cards.some(other => other.top === card.top
      && (Math.abs(card.titleTop - other.titleTop) > 1 || Math.abs(card.footerTop - other.footerTop) > 1 || Math.abs(card.footerBottom - other.footerBottom) > 1)));
    return unequal || footerDrift ? [cards] : [];
  }));
  assert.deepEqual(failures, [], `${label}: cards, titles and action footers align`);
}

const output = fileURLToPath(new URL('../dist/environment-relation-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pid: process.pid, url: server.resolvedUrls.local[0], output, cases: [], errors: [] };
try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { snapshot } = mixedEnvironmentFixture();
  const runtime = snapshot.environments.find(entry => entry.kind === 'local_environment');
  const cloud = snapshot.environments.find(entry => entry.env_public_id === 'env_0_0');
  for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    const cards = page.locator('[data-environment-group]:visible');
    await cards.first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await cards.count(), 8);
    const pair = page.locator('[data-environment-group]').filter({ has: page.locator('[role="tablist"]') });
    assert.equal(await pair.count(), 1);
    assert.equal(await pair.locator('[data-owner-id]:visible').count(), 1);
    await assertGridAlignment(page, `${locale}: overview`);
    const pairHeightBefore = (await pair.boundingBox()).height;
    const neighborsBefore = await cards.evaluateAll(elements => elements.filter(el => !el.querySelector('[role="tablist"]')).map(el => Math.round(el.getBoundingClientRect().height)));
    assert.ok((await pair.boundingBox()).height < 370, 'linked card retains a compact single perspective');
    await pair.locator('[data-owner-role="runtime"] .redeven-split-action-primary button').first().click();
    await pair.locator('[role="tab"]').nth(1).click();
    await pair.locator('[data-owner-role="cloud"] .redeven-split-action-primary button').first().click();
    const requests = await page.evaluate(() => window.settingsFixture.requests);
    assert.ok(requests.some(request => request.kind === 'open_local_environment' && request.environment_id === runtime.id));
    assert.ok(requests.some(request => request.kind === 'open_provider_environment' && request.environment_id === cloud.id && request.route === 'remote_desktop'));
    assert.deepEqual(await cards.evaluateAll(elements => elements.filter(el => !el.querySelector('[role="tablist"]')).map(el => Math.round(el.getBoundingClientRect().height))), neighborsBefore);
    assert.ok(Math.abs((await pair.boundingBox()).height - pairHeightBefore) < 1, 'switching perspectives preserves card height');
    await assertGridAlignment(page, `${locale}: switched overview`);
    // Snapshot replacement preserves the selected tab, DOM identity and keyboard focus.
    await pair.locator('[role="tab"]').nth(1).focus();
    await page.evaluate(async snapshot => {
      const tab = document.activeElement;
      const card = tab.closest('[data-environment-group]');
      for (let tick = 0; tick < 3; tick++) {
        window.settingsFixture.publish(structuredClone(snapshot));
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (document.activeElement !== tab || !card.contains(tab)) throw new Error('Snapshot replaced the focused owner tab');
      }
    }, snapshot);
    const endpoints = pair.locator('[data-owner-role="cloud"] .redeven-card-fact-endpoint-trigger');
    await endpoints.click();
    const popup = page.locator('.redeven-endpoints-popover');
    await popup.waitFor();
    await page.evaluate(async snapshot => {
      const popup = document.querySelector('.redeven-endpoints-popover');
      const button = popup.querySelector('button'); button.focus();
      const name = document.querySelector('[data-owner-role="cloud"] h3');
      const selection = getSelection();
      if (name) { const range = document.createRange(); range.selectNodeContents(name); selection.removeAllRanges(); selection.addRange(range); }
      const selectedText = selection.toString();
      window.settingsFixture.publish(structuredClone(snapshot));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (document.querySelector('.redeven-endpoints-popover') !== popup || document.activeElement !== button || selection.toString() !== selectedText) throw new Error('Snapshot replaced owner interaction state');
    }, snapshot);
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    assert.equal(await endpoints.evaluate(el => document.activeElement === el), true);
    await endpoints.click(); await popup.waitFor();
    await pair.locator('[role="tab"]').first().click(); await popup.waitFor({ state: 'detached' });
    assert.equal(await pair.locator('[role="tab"]').first().evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('ArrowRight');
    await pair.locator('[data-owner-role="cloud"]').waitFor({ state: 'visible' });
    assert.equal(await pair.locator('[data-owner-role="cloud"]:visible').count(), 1);
    assert.equal(await pair.locator('[data-owner-role="runtime"]').evaluate(el => {
      const button = el.querySelector('button'); button.focus();
      return document.activeElement !== button && el.closest('[inert]') !== null;
    }), true, 'inactive perspective cannot receive keyboard focus');
    await page.keyboard.press('ArrowLeft');
    await pair.locator('[data-owner-role="runtime"]').waitFor({ state: 'visible' });
    assert.equal(await pair.locator('[data-owner-role="runtime"]:visible').count(), 1);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${locale}-overview.png`, animations: 'disabled', fullPage: true });
    await page.locator('.redeven-console-tab').nth(1).click();
    await page.locator('[data-cloud-source]').first().waitFor();
    assert.equal(await cards.count(), 6);
    assert.equal(await page.locator('[data-cloud-source]:visible').count(), 2);
    const cloudPair = page.locator('[data-environment-group]').filter({ has: page.locator('[role="tablist"]') });
    assert.equal(await cloudPair.locator('[data-owner-role="cloud"]:visible').count(), 1);
    await cloudPair.locator('[role="tab"]').first().click();
    await cloudPair.locator('[data-owner-role="runtime"]').waitFor({ state: 'visible' });
    const search = page.locator('.redeven-header-separator input');
    await search.fill('Team Cloud'); assert.equal(await cards.count(), 3);
    await search.fill('env_0_0'); assert.equal(await cards.count(), 1);
    assert.equal(await cloudPair.locator('[data-owner-role="runtime"]:visible').count(), 1);
    await search.fill('no matching source'); assert.equal(await cards.count(), 0);
    await search.fill(''); assert.equal(await cards.count(), 6);
    assert.equal(await cloudPair.locator('[data-owner-role="runtime"]:visible').count(), 1);
    await cloudPair.locator('[role="tab"]').nth(1).click();
    await cloudPair.locator('[data-owner-role="cloud"]').waitFor({ state: 'visible' });
    await assertGridAlignment(page, `${locale}: Cloud sources`);
    await page.screenshot({ path: `${output}/${locale}-cloud.png`, animations: 'disabled', fullPage: true });
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.style.fontSize = '20px'; });
      await page.screenshot({ path: `${output}/${locale}-${width}-dark-large.png`, animations: 'disabled', fullPage: true });
      await assertGridAlignment(page, `${locale}: ${width}px enlarged text`);
      const overflow = await cards.evaluateAll(elements => elements.flatMap(card => [...card.querySelectorAll('button,[role="tab"]')]
        .filter(button => button.offsetWidth && !button.closest('[aria-hidden="true"]')).filter(button => { const box = button.getBoundingClientRect(); const bounds = card.getBoundingClientRect(); return box.right > bounds.right + 1 || box.left < bounds.left - 1; })
        .map(button => button.textContent)));
      assert.deepEqual(overflow, [], `${locale}: actions fit at ${width}px with enlarged text`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}: no page overflow`);
      const clippedText = await page.evaluate(() => [...document.querySelectorAll('.redeven-header-separator button, .redeven-cloud-source-header button, [data-environment-group] button, [role="tab"]')]
        .filter(el => el.offsetWidth && !el.closest('[hidden], [aria-hidden="true"]')).flatMap(el => {
          const bounds = el.getBoundingClientRect();
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim() || node.parentElement.closest('.sr-only')) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            if ([...range.getClientRects()].some(rect => rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) return [el.textContent];
          }
          return [];
        }));
      assert.deepEqual(clippedText, [], `${locale}: button text is not vertically clipped at ${width}px`);
      const overlappingFacts = await cards.evaluateAll(elements => elements.flatMap(card => [...card.querySelectorAll('.redeven-card-fact-row')]
        .filter(row => row.offsetWidth && !row.closest('[aria-hidden="true"]')).filter(row => {
          const label = row.querySelector('.redeven-card-fact-label').getBoundingClientRect();
          const value = row.querySelector('.redeven-card-fact-value').getBoundingClientRect();
          return label.right > value.left - 2;
        }).map(row => row.textContent)));
      assert.deepEqual(overlappingFacts, [], `${locale}: fact labels leave space before values`);
      await cards.last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${locale}-${width}-actions.png`, animations: 'disabled' });

    }
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), mixedEnvironmentFixture({ syncState: 'provider_unreachable' }).snapshot);
    assert.equal(await cards.count(), 6, 'failed sync keeps known environments');
    await page.locator('.redeven-console-tab').first().click();
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), mixedEnvironmentFixture({ linkState: 'unbound' }).snapshot);
    await page.waitForFunction(() => document.querySelectorAll('[data-environment-group]').length === 9);
    report.cases.push(`${locale}:equal-cards-aligned-footers-stable-tabs-owner-actions-keyboard-focus-selection-cloud-search-stale-sync-font-scale-unlink`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error?.stack || error); throw error; }
finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 2));
