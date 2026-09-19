import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/cloud-account-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pid: process.pid,
  url: server.resolvedUrls.local[0], output, cases: [], errors: [] };
try {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const { snapshot } = mixedEnvironmentFixture();
  const failed = mixedEnvironmentFixture({ syncState: 'provider_unreachable' }).snapshot;
  failed.control_planes[0].last_sync_error_message = 'Desktop failed to talk to the provider.';
  const expired = mixedEnvironmentFixture({ syncState: 'auth_required' }).snapshot;
  const locales = process.argv.length > 2 ? process.argv.slice(2) : REDEVEN_SUPPORTED_LOCALES;
  assert.ok(locales.every(locale => REDEVEN_SUPPORTED_LOCALES.includes(locale)), 'requested locales must be supported');
  for (const locale of locales) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', report.url).href);
    await page.locator('.redeven-console-tab').nth(1).click();
    const account = page.locator('.redeven-cloud-source-header').first();
    await account.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await account.locator('h2').textContent(), 'Team account');
    assert.deepEqual(await account.locator('dd').allTextContents(), ['3', '2', '1']);
    assert.equal(await account.getByRole('button', { name: i18n.t('environmentCenter.cloudSignInAgain'), exact: true }).count(), 0);
    // Search changes the visible grid, never the account's inventory totals.
    await page.locator('.redeven-header-separator input').fill('env_0_0');
    assert.equal(await page.locator('[data-environment-group]:visible').count(), 1);
    assert.deepEqual(await account.locator('dd').allTextContents(), ['3', '2', '1']);
    await page.locator('.redeven-header-separator input').fill('');
    await account.getByRole('button', { name: i18n.t('common.refresh'), exact: true }).click();
    assert.ok(await page.evaluate(() => window.settingsFixture.requests.some(request => request.kind === 'refresh_control_plane')));
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), failed);
    assert.equal(await page.locator('[data-environment-group]:visible').count(), 6);
    assert.ok((await account.innerText()).includes(i18n.t('environmentStatus.syncFailed')));
    assert.ok(!(await account.innerText()).includes('Desktop failed to talk to the provider.'));
    assert.equal(await account.locator('[data-cloud-stat="online"]').getAttribute('data-stale'), 'true');
    for (const [width, dark, fontSize] of [[1280, false, '16px'], [1280, true, '16px'], [768, true, '20px'], [390, true, '20px']]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(({ dark, fontSize }) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.fontSize = fontSize;
      }, { dark, fontSize });
      await account.scrollIntoViewIfNeeded();
      const failures = await page.locator('.redeven-cloud-source-header:visible').evaluateAll(accounts => accounts.flatMap(account => {
        const bounds = account.getBoundingClientRect();
        return [...account.querySelectorAll('button, dt, dd')].flatMap(el => {
          const box = el.getBoundingClientRect();
          if (box.left < bounds.left || box.right > bounds.right) return [`outside account: ${el.textContent}`];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            if ([...range.getClientRects()].some(rect => rect.left < box.left - 2 || rect.right > box.right + 2 || rect.bottom > box.bottom + 2)) return [`clipped: ${el.textContent}`];
          }
          return [];
        });
      }));
      assert.deepEqual(failures, [], `${locale}: ${width}px account content stays readable`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}: no horizontal overflow`);
      await page.screenshot({ path: `${output}/${locale}-${width}-${dark ? 'dark' : 'light'}-failed.png`, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
    const detailsTrigger = account.getByRole('button', { name: i18n.t('environmentCenter.cloudSyncDetails'), exact: true });
    await detailsTrigger.click();
    const details = page.getByRole('dialog', { name: i18n.t('environmentCenter.cloudSyncDetails'), exact: true });
    await details.waitFor();
    assert.ok((await details.innerText()).includes('Desktop failed to talk to the provider.'));
    await details.getByRole('button').focus();
    await page.evaluate(async snapshot => {
      const focused = document.activeElement;
      window.settingsFixture.publish(structuredClone(snapshot));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (document.activeElement !== focused) throw new Error('Snapshot replaced account details focus');
    }, failed);
    await page.keyboard.press('Escape'); await details.waitFor({ state: 'detached' });
    assert.ok(await detailsTrigger.evaluate(el => el === document.activeElement));
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), expired);
    await account.getByRole('button', { name: i18n.t('environmentCenter.cloudSignInAgain'), exact: true }).click();
    assert.ok(await page.evaluate(() => window.settingsFixture.requests.some(request => request.kind === 'start_control_plane_connect')));
    await page.screenshot({ path: `${output}/${locale}-expired.png`, animations: 'disabled' });
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), snapshot);
    const signOut = account.getByRole('button', { name: i18n.t('environmentCenter.cloudSignOutAriaLabel', { label: 'Team account' }), exact: true });
    await signOut.click();
    const confirmation = page.getByRole('dialog', { name: i18n.t('confirm.cloudSignOutTitle'), exact: true });
    await confirmation.getByRole('button', { name: i18n.t('common.cancel'), exact: true }).click();
    await confirmation.waitFor({ state: 'detached' });
    await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, i18n.t('environmentCenter.cloudSignOutAriaLabel', { label: 'Team account' }));
    await signOut.click();
    await page.screenshot({ path: `${output}/${locale}-sign-out.png`, animations: 'disabled' });
    await confirmation.getByRole('button', { name: i18n.t('environmentCenter.cloudSignOut'), exact: true }).click();
    const request = await page.evaluate(() => window.settingsFixture.requests.at(-1));
    assert.deepEqual(request, { kind: 'sign_out_control_plane', provider_origin: snapshot.control_planes[0].provider.provider_origin, provider_id: snapshot.control_planes[0].provider.provider_id });
    await page.evaluate(snapshot => window.settingsFixture.publish(snapshot), { ...snapshot, control_planes: snapshot.control_planes.slice(1), environments: snapshot.environments.filter(entry => entry.kind !== 'provider_environment' || entry.provider_origin !== snapshot.control_planes[0].provider.provider_origin) });
    await confirmation.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.redeven-cloud-source-header').count(), 1);
    report.cases.push(`${locale}:account-totals-localized-recovery-responsive-status-details-focus-sign-out`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error?.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); await server.close(); }
console.log(JSON.stringify(report, null, 2));
