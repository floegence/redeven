import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = fileURLToPath(new URL('../dist/environment-access-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], errors: [] };
const load = relative => server.ssrLoadModule(fileURLToPath(new URL(relative, import.meta.url)));
try {
  const { linkedEnvironmentFixture } = await load('../src/testSupport/linkedEnvironmentFixture.ts');
  const { compactEnvironmentPreviewFixture } = await load('../src/testSupport/compactEnvironmentPreviewFixture.ts');
  const { decorateEnvironmentAccess, rememberEnvironmentIdentity } = await load('../src/main/environmentAccess.ts');
  const { defaultDesktopPreferences } = await load('../src/main/desktopPreferences.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const { runtime, cloud, snapshot: base } = linkedEnvironmentFixture();
  const source = compactEnvironmentPreviewFixture().coverage;
  const gateway = { ...source.environments.find(entry => entry.kind === 'gateway_environment'), gateway_label: 'Office Gateway' };
  const identity = `runtime:${'a'.repeat(64)}`;
  const preferences = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), runtime, identity), gateway, identity);
  const snapshot = { ...base, environments: decorateEnvironmentAccess([runtime, cloud, gateway], preferences), gateway_sources: source.gateway_sources };
  for (const locale of REDEVEN_SUPPORTED_LOCALES) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(({ snapshot, locale }) => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, { snapshot, locale });
    await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    const cards = page.locator('[data-environment-group]:visible');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2, 'Public health observations never merge Gateway member authority with another registration');
    const linked = cards.filter({ has: page.locator('[data-owner-role="runtime"]') });
    const native = linked.locator('[data-owner-role="runtime"]');
    await native.locator('.redeven-split-action-primary button').first().click();
    assert.ok((await page.evaluate(() => window.settingsFixture.requests)).some(r => r.kind === 'open_local_environment'));
    await linked.getByRole('tab').nth(1).click();
    await linked.locator('[data-owner-role="cloud"] .redeven-split-action-primary button').first().click();
    assert.equal((await page.evaluate(() => window.settingsFixture.requests)).at(-1).kind, 'open_provider_environment');
    const member = page.locator(`[data-owner-id="${gateway.id}"]`);
    await member.locator('.redeven-split-action-primary button').first().click();
    const request = (await page.evaluate(() => window.settingsFixture.requests)).at(-1);
    assert.equal(request.kind, 'open_gateway_environment');
    assert.equal(request.gateway_id, gateway.gateway_id);
    assert.equal(request.gateway_env_id, gateway.gateway_member.member_id);
    assert.equal('access_mode' in request, false);
    assert.equal(await member.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: gateway.label }), exact: true }).count(), 0);
    for (const width of [1280, 430]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.emulateMedia({ colorScheme: width === 430 ? 'dark' : 'light' });
      await page.evaluate(width => { document.documentElement.style.fontSize = width === 430 ? '20px' : '16px'; }, width);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await member.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${locale}/${width}: member fits`);
      await page.screenshot({ path: `${output}/${locale}-${width}.png` });
    }
    report.cases.push(`${locale}: separate member identity, one reverse access path, independent direct and Cloud owners`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(`PASS Gateway and independent access ownership (${report.cases.length} locales)`);
