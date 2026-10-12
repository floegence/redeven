import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_SETTINGS_STYLE_OUTPUT || fileURLToPath(new URL('../dist/settings-style-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pid: process.pid,
  url: server.resolvedUrls.local[0], cases: [], errors: [], status: 'running' };
const contrastOnly = process.argv.includes('--contrast-only');
const addressesOnly = process.argv.includes('--addresses-only');
const themeName = process.argv.find(arg => arg.startsWith('--theme='))?.slice(8);
const connectionWidth = Number(process.argv.find(arg => arg.startsWith('--width='))?.slice(8));
const connectionKind = process.argv.find(arg => arg.startsWith('--kind='))?.slice(7);
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const dialog = page.getByRole('dialog');
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  let t;
  const button = key => dialog.getByRole('button', { name: t(key), exact: true });
  const shell = locator => locator.evaluate(el => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, border: s.border, radius: s.borderRadius };
  });
  async function layout(label) {
    const geometry = await dialog.evaluate(el => {
      const body = [...el.querySelectorAll('.environment-settings-scroll')].find(node => node.checkVisibility());
      return { panel: el.scrollWidth > el.clientWidth, body: body.scrollWidth > body.clientWidth,
        overflow: [...body.querySelectorAll('*')].filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && node.getBoundingClientRect().right > body.getBoundingClientRect().right + 1).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent.trim().slice(0, 60) })).slice(0, 15),
        buttons: [...el.querySelectorAll('button')].filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !node.closest('[aria-hidden="true"]')).map(node => ({
          text: node.textContent.trim() || node.getAttribute('aria-label'), overflow: node.scrollWidth > node.clientWidth + 1,
          height: node.getBoundingClientRect().height, whitespace: getComputedStyle(node).whiteSpace,
        })) };
    });
    assert.equal(geometry.panel || geometry.body, false, `${label}: no horizontal scrolling ${JSON.stringify(geometry.overflow)}`);
    for (const action of geometry.buttons) {
      assert.equal(action.overflow, false, `${label}: clipped action ${action.text}`);
      assert.ok(action.height >= 32, `${label}: action target ${action.text}`);
    }
  }
  if (!process.argv.includes('--connection-only')) for (const preset of builtInShellThemePresets.filter(preset => !themeName || preset.name === themeName)) for (const width of (contrastOnly ? [1280] : [1280, 390, 320]).filter(width => !connectionWidth || width === connectionWidth)) {
    const locale = width === 320 ? 'de-DE' : 'zh-CN';
    t = createDesktopI18n(locale).t;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${report.url}environment-endpoints.html?preset=${preset.name}&locale=${locale}&password=1&network-local=1`);
    await page.locator('[data-environment="Local Environment"] > button').click();
    await button('accessFlow.changeAccess').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    const colors = await dialog.evaluate(el => {
      const reference = document.createElement('span'); reference.style.background = 'var(--popover)'; el.append(reference);
      const expected = getComputedStyle(reference).backgroundColor; reference.remove();
      return { expected, actual: getComputedStyle(el).backgroundColor };
    });
    assert.equal(colors.actual, colors.expected, `${preset.name}: dialog uses its theme surface without a gray overlay`);
    const connection = await shell(dialog.locator('.environment-access-overview'));
    const summary = await shell(dialog.locator('.access-flow-summary'));
    assert.deepEqual(connection, summary, `${preset.name}: connection and task overview share one surface`);
    assert.notEqual(connection.border, '0px none rgb(0, 0, 0)', 'connection has a visible grouping boundary');
    await layout(`${preset.name}-${width}-overview`);
    if (width === 1280) {
      const require = createRequire(new URL('../../internal/envapp/ui_src/package.json', import.meta.url));
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => (await window.axe.run('.redeven-environment-settings-dialog', {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
      assert.deepEqual(violations, [], `${preset.name}: readable contrast and accessible overview`);
    }
    if (width === 1280 && ['classic-light', 'paper', 'mist', 'meadow', 'lilac', 'ocean'].includes(preset.name)) {
      await dialog.screenshot({ path: `${output}/overview-${preset.name}.png`, animations: 'disabled' });
    }
    if (contrastOnly) { report.cases.push(`${preset.name}-contrast`); continue; }
    for (const disclosure of await dialog.locator('.redeven-address-group--summary > summary').all()) await disclosure.click();
    await layout(`${preset.name}-${width}-addresses`);
    const addressLists = await dialog.locator('.redeven-address-group--summary').evaluateAll(groups => groups.map(group => {
      const viewport = group.querySelector('.redeven-address-viewport');
      const header = group.querySelector('thead');
      const style = getComputedStyle(viewport);
      return { border: parseFloat(style.borderTopWidth), radius: parseFloat(style.borderRadius), background: style.backgroundColor,
        headerHeight: header.getBoundingClientRect().height,
        readingEdge: group.querySelector('.redeven-card-endpoint-content').getBoundingClientRect().left
          + parseFloat(getComputedStyle(group.querySelector('.redeven-card-endpoint-content')).paddingLeft)
          - group.querySelector('.redeven-address-title').getBoundingClientRect().left };
    }));
    for (const list of addressLists) {
      assert.equal(list.border, 0, 'address lists have no nested outer border');
      assert.equal(list.radius, 0, 'address lists share the parent surface');
      assert.equal(list.background, 'rgba(0, 0, 0, 0)', 'address lists have no separate background');
      assert.ok(list.headerHeight <= 1, 'column labels are available without a visible header');
      assert.ok(Math.abs(list.readingEdge) < 1, 'addresses align with their section label');
    }
    if (addressesOnly && width === 1280) {
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
      });
      const violations = await page.evaluate(async () => (await window.axe.run('.redeven-environment-settings-dialog', {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) })));
      assert.deepEqual(violations, [], `${preset.name}: accessible expanded addresses`);
    }
    if (width === 1280 && ['classic-light', 'paper', 'mist', 'ocean'].includes(preset.name)) {
      await dialog.locator('.environment-settings-scroll:visible').evaluate(body => { body.scrollTop = 0; });
      await page.mouse.move(0, 0);
      await dialog.screenshot({ path: `${output}/addresses-${preset.name}.png`, animations: 'disabled' });
    }
    if (addressesOnly) { report.cases.push(`${preset.name}-${width}-addresses`); continue; }
    await button('accessFlow.manageProtection').click();
    await dialog.locator('.access-flow-password-setting').waitFor();
    assert.deepEqual(await shell(dialog.locator('.access-flow-password-setting')), connection);
    assert.deepEqual(await shell(dialog.locator('.two-factor-setting')), connection);
    await layout(`${preset.name}-${width}-security`);
    await button('accessFlow.changePassword').click();
    await layout(`${preset.name}-${width}-password`);
    await button('common.cancel').click();
    await button('settings.certificateManage').click();
    await dialog.locator('.environment-certificate-setting').waitFor();
    assert.deepEqual(await shell(dialog.locator('.environment-certificate-setting')), connection);
    await layout(`${preset.name}-${width}-certificate`);
    await button('common.cancel').click();
    await button('accessFlow.changeAccess').click();
    await layout(`${preset.name}-${width}-access`);
    await button('accessFlow.checkChanges').click();
    await dialog.locator('.access-flow-review').waitFor();
    assert.deepEqual(await shell(dialog.locator('.access-flow-review')), connection);
    await layout(`${preset.name}-${width}-review`);
    report.cases.push(`${preset.name}-${width}`);
  }
  if (!contrastOnly && !addressesOnly) {
  const { mixedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/mixedEnvironmentFixture.ts', import.meta.url)));
  const { snapshot } = mixedEnvironmentFixture({ linkState: 'unbound' });
  const original = snapshot.environments.find(entry => entry.kind === 'ssh_environment');
  const cloud = snapshot.environments.find(entry => entry.cloud_origin && !entry.managed_runtime_host_access);
  assert.ok(original && cloud, 'real snapshot includes SSH and cloud registrations');
  await page.addInitScript(value => { window.settingsFixtureSnapshot = value; }, snapshot);
  for (const preset of ['classic-light', 'paper', 'ocean']) for (const width of [1280, 390, 320].filter(width => !connectionWidth || width === connectionWidth)) {
    t = createDesktopI18n('en-US').t;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${report.url}environment-settings.html?locale=en-US`);
    await page.evaluate(name => document.documentElement.setAttribute('data-floe-shell-theme', name), preset);
    const variants = {
      ssh: original,
      wsl: { ...original, kind: 'wsl_environment', managed_runtime_host_access: { kind: 'wsl_host', distribution_name: 'Ubuntu', linux_user: 'dev' } },
      container: { ...original, managed_runtime_host_access: { kind: 'local_host' }, managed_runtime_placement: {
        kind: 'container_process', container_engine: 'docker', container_id: 'fixture-container', container_ref: 'fixture-container', container_label: 'Container', runtime_root: '/root/.redeven', bridge_strategy: 'exec_stream' } },
      url: { ...original, kind: 'external_local_ui', registration_ref: { kind: 'saved_environment', id: 'fixture-url' }, local_ui_url: 'https://example.invalid/' },
      gateway: { ...original, kind: 'gateway_environment', access_group_id: undefined, registration_ref: { kind: 'gateway_environment', gateway_id: 'fixture-gateway', gateway_env_id: 'fixture-profile' }, gateway_environment_profile_access_route: { kind: 'url', url: 'https://example.invalid/' } },
      cloud,
    };
    for (const [kind, value] of Object.entries(variants)) {
      if (connectionKind && kind !== connectionKind) continue;
      const entry = { ...value, id: `fixture-${kind}`, label: `Fixture ${kind}` };
      await page.evaluate(value => window.settingsFixture.publish(value), { ...snapshot, environments: [...snapshot.environments, entry] });
      await page.getByRole('button', { name: `Settings for Fixture ${kind}`, exact: true }).click();
      await dialog.waitFor();
      const groups = dialog.locator('.ssh-settings-fields:visible, .environment-connection-group:visible, .environment-settings-information:visible');
      await groups.first().waitFor();
      const surfaces = await groups.evaluateAll(elements => elements.map(el => {
        const s = getComputedStyle(el); return { background: s.backgroundColor, border: s.border, radius: s.borderRadius };
      }));
      for (const surface of surfaces) assert.deepEqual(surface, surfaces[0], `${kind}: matching settings groups`);
      await layout(`${preset}-${width}-${kind}`);
      if (preset === 'classic-light' && width === 1280) await dialog.screenshot({ path: `${output}/connection-${kind}.png`, animations: 'disabled' });
      await dialog.locator('[data-floe-dialog-header] button').click();
      await dialog.waitFor({ state: 'hidden' });
      report.cases.push(`${preset}-${width}-${kind}`);
    }
  }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error.stack); throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
