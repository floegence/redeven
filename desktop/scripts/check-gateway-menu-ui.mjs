import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/gateway-menu-ui/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
try {
  const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { createDesktopI18n } = await load('../src/shared/i18n/index.ts');
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.gateway_sources[0], display_name: 'Office Gateway',
    connection_kind: 'local_host', management_capability: 'managed_local_host',
    service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
  const snapshot = { ...source, gateway_sources: [gateway] };
  for (const locale of ['en-US', 'zh-CN']) {
    const i18n = createDesktopI18n(locale);
    for (const width of [1280, 430]) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
        try {
          const page = await context.newPage();
          page.on('pageerror', error => report.errors.push(error.message));
          await page.addInitScript(({ snapshot, locale }) => {
            window.settingsFixtureSnapshot = snapshot;
            const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
            window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
          }, { snapshot, locale });
          await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
          await page.evaluate(() => document.fonts.ready);
          await page.getByRole('button', { name: i18n.t('environmentCenter.gatewaysSection'), exact: true }).click();
          const card = page.locator(`[data-gateway-id="${gateway.gateway_id}"]`);
          const more = card.getByRole('button', { name: i18n.t('environmentCenter.moreActionsForLabel', { label: gateway.display_name }), exact: true });
          const menu = page.locator('.redeven-gateway-menu');
          const initialGlyph = await card.locator('.redeven-gateway-card__primary-button svg').innerHTML();
          await more.click();
          await menu.waitFor();
          await page.getByRole('menuitem').first().waitFor({ state: 'visible' });
          await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
          const rows = await menu.getByRole('menuitem').evaluateAll(elements => elements.map(element => {
            const row = element.getBoundingClientRect();
            const token = element.querySelector('.redeven-split-menu-item-icon');
            const icon = token?.querySelector('svg');
            const bounds = token?.getBoundingClientRect();
            const iconBounds = icon?.getBoundingClientRect();
            const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            const range = document.createRange();
            if (text) range.selectNodeContents(text);
            const labelBounds = text && range.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { label: element.textContent.trim(), height: row.height,
              paddingLeft: style.paddingLeft, gap: style.gap, cursor: style.cursor,
              token: bounds && { left: bounds.left - row.left, width: bounds.width, height: bounds.height,
                radius: getComputedStyle(token).borderRadius, background: getComputedStyle(token).backgroundColor },
              icon: iconBounds && { left: iconBounds.left - row.left, top: iconBounds.top - row.top,
                width: iconBounds.width, height: iconBounds.height },
              textLeft: labelBounds && labelBounds.left - row.left, overflow: element.scrollWidth > element.clientWidth + 1 };
          }));
          const reference = rows[0];
          for (const row of rows) {
            assert.ok(row.token && row.icon && row.textLeft, `${row.label} has an icon container and label`);
            for (const key of ['height', 'paddingLeft', 'gap', 'textLeft']) assert.equal(row[key], reference[key], `${row.label}: ${key}`);
            for (const key of ['left', 'width', 'height', 'radius']) assert.equal(row.token[key], reference.token[key], `${row.label}: icon container ${key}`);
            assert.deepEqual(row.icon, reference.icon, `${row.label}: icon alignment and size`);
            assert.ok(row.token.background !== 'rgba(0, 0, 0, 0)');
            assert.ok(row.textLeft > row.token.left + row.token.width);
            assert.equal(row.cursor, 'pointer');
            assert.equal(row.overflow, false);
          }
          const bounds = await menu.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900,
            `${locale}/${width}/${colorScheme}: viewport-bounded menu ${JSON.stringify(bounds)}`);
          const item = key => menu.getByRole('menuitem', { name: i18n.t(key), exact: true });
          const restart = item('environmentCenter.gatewayActionRestart');
          const refresh = item('common.refresh');
          const restartGlyph = await restart.locator('svg').innerHTML();
          assert.notEqual(restartGlyph, await refresh.locator('svg').innerHTML());
          assert.equal(await item('environmentCenter.gatewayActionDelete').getAttribute('data-tone'), 'danger');
          await page.screenshot({ path: `${output}/${locale}-${width}-${colorScheme}.png` });
          await page.keyboard.press('End');
          assert.equal(await item('environmentCenter.gatewayActionDelete').evaluate(element => element === document.activeElement), true);
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowDown');
          assert.equal(await restart.evaluate(element => element === document.activeElement), true);
          await page.keyboard.press('Enter');
          await menu.waitFor({ state: 'detached' });
          const panel = page.locator('.redeven-gateway-action-popover-surface');
          await panel.waitFor();
          assert.equal(await card.locator('.redeven-gateway-card__primary-button svg').innerHTML(), restartGlyph);
          assert.equal(await panel.locator('.redeven-gateway-action-panel__primary-action svg').innerHTML(), restartGlyph);
          assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), 0, 'Restart awaits confirmation');
          await page.keyboard.press('Escape');
          await panel.waitFor({ state: 'detached' });
          assert.equal(await card.locator('.redeven-gateway-card__primary-button svg').innerHTML(), initialGlyph);
          await more.click();
          await page.keyboard.press('Escape');
          await menu.waitFor({ state: 'detached' });
          assert.equal(await more.evaluate(element => element === document.activeElement), true);
          await more.click();
          await item('environmentCenter.gatewayActionOpenSettings').click();
          await page.getByRole('dialog').locator('#gateway-name').waitFor();
          assert.equal(await page.evaluate(() => window.settingsFixture.requests.length), 0, 'Settings does not mutate the Gateway');
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'detached' });
          await page.evaluate(snapshot => window.settingsFixture.publish({ ...snapshot, gateway_sources: [{
            ...snapshot.gateway_sources[0], capabilities: ['member_access'], permissions: { access: true, manage_members: false, configure_cloud: false },
          }] }), snapshot);
          await more.click();
          assert.equal(await item('gatewayMembers.invite').count(), 0);
          assert.equal(await item('environmentCenter.gatewayActionOpenSettings').locator('.redeven-split-menu-item-icon > svg').count(), 1);
          assert.equal(await item('environmentCenter.gatewayActionDelete').locator('.redeven-split-menu-item-icon > svg').count(), 1);
          report.cases.push({ locale, width, colorScheme, rows, distinctRestart: true, confirmationPreserved: true, keyboardNavigation: true, focusRestored: true });
        } finally { await context.close(); }
      }
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log(`PASS Gateway menu UI (${report.cases.length} locale/layout/theme cases)`);
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
