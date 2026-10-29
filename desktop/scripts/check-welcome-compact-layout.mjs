import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_LAYOUT_OUTPUT || fileURLToPath(new URL('../dist/welcome-compact-layout/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], failures: [], errors: [] };
const check = (value, message) => { if (!value) report.failures.push(message); };
try {
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { runtimeLifecycleProgress } = await load('../src/shared/desktopRuntimeLifecycleProgress.ts');
  const { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } = await load('../src/shared/i18n/index.ts');
  const snapshot = mixedEnvironmentFixture().snapshot;
  const entry = snapshot.environments.find(environment => environment.kind === 'ssh_environment');
  assert.ok(entry, 'SSH fixture exists');
  const urls = ['http://localhost:23998/', 'http://127.0.0.1:23998/', 'http://[::1]:23998/'];
  const inventory = { ...snapshot, environments: snapshot.environments.map(environment => environment.id === entry.id
    ? { ...environment, local_ui_url: urls[0], local_ui_urls: urls } : environment) };
  const operationKey = 'compact-layout-failure';
  const failed = {
    action: 'start_environment_runtime', environment_id: entry.id, environment_label: entry.label, operation_key: operationKey,
    subject_kind: 'ssh_environment', subject_id: entry.id, started_at_unix_ms: Date.now(),
    status: 'failed', phase: 'checking_host', title: 'Check host', detail: 'SSH connection refused',
    active_progress_surface: 'runtime_lifecycle', cancelable: false,
    lifecycle_progress: runtimeLifecycleProgress({ location: 'ssh_host', operation: 'start', phase: 'checking_host',
      targetID: entry.id, targetLabel: entry.label, stepStates: [{ id: 'checking_host', status: 'failed' }] }),
    failure: { code: 'ssh_connection_failed', severity: 'error', title: 'SSH connection failed',
      summary: 'SSH connection refused', diagnostics: [{ channel: 'stderr', label: 'SSH', text: 'ssh: connection refused' }] },
    next_actions: [
      { kind: 'update_runtime', environment_id: entry.id, label: 'Update' },
      { kind: 'retry', operation_key: operationKey, retry_action: { kind: 'start_environment_runtime', environment_id: entry.id }, label: 'Retry' },
      { kind: 'refresh_status', environment_id: entry.id, label: 'Refresh' },
      { kind: 'copy_diagnostics', operation_key: operationKey, label: 'Copy log' },
      { kind: 'dismiss', operation_key: operationKey, label: 'Close' },
    ],
  };
  const locales = process.env.REDEVEN_LAYOUT_SMOKE ? ['zh-CN'] : REDEVEN_SUPPORTED_LOCALES;
  for (const locale of locales) {
    const i18n = createDesktopI18n(locale);
    const context = await browser.newContext({ viewport: { width: 1261, height: 958 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        window.copiedLayoutValues = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => window.copiedLayoutValues.push(value) } });
      }, { snapshot: inventory, locale });
      await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
      const card = page.locator('.redeven-environment-card').filter({ has: page.getByText(entry.label, { exact: true }) }).first();
      await card.waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const theme of ['light', 'dark']) for (const width of [1261, 720, 390]) {
        const label = `${locale}/${theme}/${width}`;
        await page.setViewportSize({ width, height: 958 });
        await page.evaluate(theme => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          document.documentElement.classList.toggle('light', theme === 'light');
          document.documentElement.dataset.floeShellTheme = `classic-${theme}`;
        }, theme);
        await page.evaluate(value => window.settingsFixture.publish(value), inventory);
        const grid = page.locator('.redeven-new-environment-options');
        await grid.scrollIntoViewIfNeeded();
        const tiles = await grid.locator('button').evaluateAll(buttons => buttons.map(button => {
          const box = button.getBoundingClientRect();
          return { top: box.top, left: box.left, width: box.width, height: box.height, overflow: button.scrollWidth - button.clientWidth };
        }));
        check(tiles.length === 4 && Math.abs(tiles[0].top - tiles[1].top) < 1
          && Math.abs(tiles[2].top - tiles[3].top) < 1 && Math.abs(tiles[0].left - tiles[2].left) < 1
          && Math.abs(tiles[1].left - tiles[3].left) < 1 && tiles.every(tile => Math.abs(tile.width - tiles[0].width) < 1 && tile.overflow <= 1), `${label}: complete equal-width 2x2 create grid`);
        await card.getByRole('button', { name: i18n.t('environmentCenter.showEndpoints'), exact: true }).click();
        const popover = page.locator('.redeven-endpoints-popover');
        await popover.waitFor();
        const internal = popover.locator('[data-address-scope=environment_only]');
        const layout = await internal.evaluate(group => {
          const headingElement = group.querySelector('.redeven-card-endpoint-label');
          const scopeElement = group.querySelector('.redeven-endpoint-scope-title');
          const heading = headingElement.getBoundingClientRect();
          const scope = scopeElement.getBoundingClientRect();
          const firstLineCenter = element => element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).lineHeight) / 2;
          const summary = group.querySelector('summary');
          return { aligned: window.innerWidth <= 608 ? scope.top >= heading.bottom : Math.abs(firstLineCenter(headingElement) - firstLineCenter(scopeElement)) <= 3,
            concise: !!summary.querySelector('.redeven-endpoint-scope-title') && !group.querySelector('p') && !group.querySelector('.redeven-card-endpoint-detail'),
            countInDisclosure: !!summary.querySelector('.redeven-address-count'),
            detachedCount: !!group.querySelector('.redeven-address-heading .redeven-address-count'), overflow: group.scrollWidth - group.clientWidth };
        });
        check(layout.concise && layout.aligned && layout.countInDisclosure && !layout.detachedCount && layout.overflow <= 1, `${label}: one concise access disclosure without explanatory paragraphs`);
        const disclosure = internal.locator('summary');
        await disclosure.click();
        assert.equal(await internal.locator('tbody tr').count(), 3);
        assert.equal(await internal.locator('button').count(), 0, 'internal addresses have no browser/copy/share actions');
        assert.ok(await popover.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${label}: expanded listeners stay inside the popover`);
        await internal.locator('summary').focus();
        await page.evaluate(value => window.settingsFixture.publish(structuredClone(value)), inventory);
        assert.equal(await internal.locator('details').getAttribute('open'), '', 'refresh preserves disclosure');
        await disclosure.press('Enter');
        assert.equal(await internal.locator('details').getAttribute('open'), null, 'keyboard closes disclosure');
        if (['zh-CN', 'en-US'].includes(locale) && width === 1261) await popover.screenshot({ path: `${output}/${locale}-${theme}-connection.png` });
        await popover.getByRole('button', { name: i18n.t('environmentCenter.closeEndpoints'), exact: true }).click();
        await page.evaluate(value => window.settingsFixture.publish(value), { ...inventory, action_progress: [failed] });
        await card.locator('.redeven-split-action-trigger--attention').click();
        const panel = page.locator('.redeven-environment-progress:visible');
        const copy = panel.getByRole('button', { name: i18n.t('progress.copyLog'), exact: true });
        const close = panel.getByRole('button', { name: i18n.t('progress.dismiss'), exact: true });
        await copy.waitFor();
        assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${label}: operation content stays inside the popover`);
        const footer = await panel.locator('.redeven-action-popover__actions[data-layout=secondary]').evaluate(group => [...group.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
          return { top: rect.top, height: rect.height, width: rect.width, border: style.borderTopWidth, color: style.borderTopColor,
            radius: style.borderRadius, font: style.fontSize, overflow: button.scrollWidth - button.clientWidth };
        }));
        check(footer.length === 2 && ['top', 'height', 'width'].every(key => Math.abs(footer[0][key] - footer[1][key]) < 1)
          && ['border', 'color', 'radius', 'font'].every(key => footer[0][key] === footer[1][key])
          && parseFloat(footer[0].border) > 0 && footer.every(button => button.overflow <= 1), `${label}: consistent copy and close button geometry and appearance`);
        await copy.click();
        assert.match((await page.evaluate(() => window.copiedLayoutValues)).at(-1), /ssh: connection refused/);
        if (['zh-CN', 'en-US'].includes(locale) && width === 1261) {
          await panel.screenshot({ path: `${output}/${locale}-${theme}-failure.png` });
          await page.locator('.redeven-new-environment-card').screenshot({ path: `${output}/${locale}-${theme}-create.png` });
        }
        await close.click();
        await panel.waitFor({ state: 'hidden' });
        assert.ok((await page.evaluate(() => window.settingsFixture.requests)).some(request => request.kind === 'dismiss_launcher_operation'));
        report.cases.push(label);
        console.log(`Checked ${label}`);
      }
      await page.evaluate(value => window.settingsFixture.publish(value), inventory);
      for (const [index, key] of ['redevenUrl', 'sshHost', 'localContainer', 'sshContainer'].entries()) {
        await page.locator('.redeven-new-environment-options button').nth(index).click();
        const dialog = page.getByRole('dialog', { name: i18n.t('connectionDialog.newEnvironmentTitle'), exact: true });
        const option = dialog.getByRole('radio', { name: i18n.t(`connectionDialog.${key}`), exact: true });
        await option.waitFor();
        assert.equal(await option.getAttribute('aria-checked'), 'true', `${locale}: create entry opens its own connection type`);
        await dialog.getByRole('button', { name: i18n.t('common.close'), exact: true }).first().click();
        await dialog.waitFor({ state: 'hidden' });
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, [], 'no browser errors');
  assert.deepEqual(report.failures, [], 'layout regressions');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
