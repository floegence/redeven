import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIsolatedSmokeConfiguration,
  assessPluginSmoke,
  browserPages,
  isEnvAppPage,
  waitFor,
} from './smoke_desktop_plugins.mjs';

test('isolated smoke configuration rejects shared Desktop paths and ports', () => {
  assert.throws(() => assertIsolatedSmokeConfiguration({
    root: '/tmp/redeven-plugin-smoke',
    stateRoot: '/Users/test/.redeven',
    userDataRoot: '/tmp/redeven-plugin-smoke/user-data',
    cacheRoot: '/tmp/redeven-plugin-smoke/cache',
    tempRoot: '/tmp/redeven-plugin-smoke/temp',
    localUIPort: 23998,
    cdpPort: 9222,
    inspectorPort: 9230,
  }), /shared Desktop/u);
});

test('plugin smoke fails on a typed refresh failure and preserves its body', () => {
  const refresh = {
    ok: true,
    data: {
      results: [{
        plugin_instance_id: 'catalog_containers',
        status: 'failed',
        error: { reason: 'trust_state_advanced', action: 'retry' },
      }],
    },
  };
  const result = assessPluginSmoke({ refresh, catalog: { plugins: [] }, panelInstalledCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'refresh_failed');
  assert.deepEqual(result.refresh, refresh);
});

test('plugin smoke fails when enabled catalog and Panel installed counts differ', () => {
  const result = assessPluginSmoke({
    refresh: { ok: true, data: { results: [{ plugin_instance_id: 'catalog_containers', status: 'refreshed' }] } },
    catalog: { plugins: [{ plugin_instance_id: 'catalog_containers', enable_state: 'enabled' }] },
    panelInstalledCount: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'inventory_count_mismatch');
  assert.equal(result.catalogEnabledCount, 1);
});

test('plugin smoke rejects an empty catalog instead of passing without a real plugin', () => {
  const result = assessPluginSmoke({
    refresh: { ok: true, data: { results: [] } },
    catalog: { plugins: [] },
    panelInstalledCount: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'enabled_plugin_missing');
});

test('plugin smoke accepts converged refresh, matching Panel inventory, iframe, and RPC', () => {
  const result = assessPluginSmoke({
    refresh: { ok: true, data: { results: [{ plugin_instance_id: 'catalog_containers', status: 'refreshed' }] } },
    catalog: { plugins: [{ plugin_instance_id: 'catalog_containers', enable_state: 'enabled' }] },
    panelInstalledCount: 1,
    surface: { ready: true, url: 'about:blank' },
    rpc: { ok: true, method: 'endpoints.list' },
  });
  assert.equal(result.ok, true);
});

test('smoke wait accepts state that converges on the deadline boundary', async () => {
  let timestamp = 0;
  let checks = 0;
  const value = await waitFor(
    () => (++checks === 2 ? 'ready' : null),
    100,
    'deadline state',
    {
      now: () => timestamp,
      delay: async () => { timestamp = 100; },
    },
  );
  assert.equal(value, 'ready');
  assert.equal(checks, 2);
});

test('Desktop smoke installs through Plugin Center only for the initial isolated phase', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /config\.phase !== 'initial'/u);
  assert.match(source, /\[data-plugin-center-install\]/u);
  assert.match(source, /\[data-plugin-install-review-confirm\]/u);
  assert.match(source, /cold restart started without an enabled plugin/u);
});

test('Desktop smoke records close button, Escape, backdrop, and final reopen evidence', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /panelDismissal\.close_button/u);
  assert.match(source, /panelDismissal\.escape/u);
  assert.match(source, /panelDismissal\.backdrop/u);
  assert.match(source, /panelDismissal\.final_reopen/u);
  assert.match(source, /waitFor\(\{ state: 'detached', timeout: 10_000 \}\)/u);
});

test('Desktop smoke discovers Electron windows across every CDP browser context', () => {
  const welcome = { id: 'welcome' };
  const environment = { id: 'environment' };
  const browser = {
    contexts: () => [
      { pages: () => [welcome] },
      { pages: () => [environment] },
    ],
  };
  assert.deepEqual(browserPages(browser), [welcome, environment]);
});

test('Desktop smoke closes every CDP transport opened while discovering Electron windows', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /const browsers = new Set\(\)/u);
  assert.match(source, /browsers\.add\(connected\)/u);
  assert.match(source, /Promise\.all\(\[\.\.\.browsers\]\.map\(\(connected\) => connected\.close\(\)\.catch\(\(\) => \{\}\)\)\)/u);
});

test('Desktop smoke re-resolves the visible Plugin Panel trigger after installation', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /const visiblePluginTrigger = \(\) => page\.locator\('\[aria-controls="redeven-plugin-switcher"\]'\)\.filter\(\{ visible: true \}\)\.first\(\)/u);
  assert.match(source, /if \(bootstrap\.performed\) \{[\s\S]*?await visiblePluginTrigger\(\)\.click\(\);/u);
  assert.doesNotMatch(source, /const pluginTrigger = page\.locator\(PLUGIN_TRIGGER_SELECTOR\)\.first\(\)/u);
});

test('Desktop smoke leaves Plugin Center before reopening the Activity Plugin Panel after installation', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /const closeCenter = page\.locator\('\[data-plugin-center-toolbar-primary\] button\[aria-label\]'\)\.last\(\)/u);
  assert.match(source, /page\.locator\('\[data-plugin-center-view\]'\)\.waitFor\(\{ state: 'detached'/u);
  assert.doesNotMatch(source, /data-activity-id="monitor"/u);
  assert.match(source, /const activityPluginTrigger = page\.locator\('\[aria-controls="redeven-plugin-switcher"\]'\)\.filter\(\{ visible: true \}\)\.first\(\)/u);
  assert.match(source, /await activityPluginTrigger\.click\(\)/u);
});

test('Desktop smoke identifies the Env App target by its product route before shell readiness', () => {
  assert.equal(isEnvAppPage({ url: () => 'http://127.0.0.1:60927/_redeven_proxy/env/' }), true);
  assert.equal(isEnvAppPage({ url: () => 'file:///workspace/desktop/dist/welcome/index.html' }), false);
});

test('Desktop smoke brings the Env App window to the foreground before user interaction', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /page = await waitFor[\s\S]*?await page\.bringToFront\(\);[\s\S]*?page\.waitForLoadState\('domcontentloaded'\)/u);
});

test('Desktop smoke observes the first Env App navigation without forcing a reload', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(source, /page\.reload\(/u);
  assert.match(source, /page\.waitForLoadState\('domcontentloaded'\)/u);
});

test('Desktop smoke waits for the closed Panel trigger instead of the unmounted dialog', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /\[aria-controls="redeven-plugin-switcher"\]/u);
  assert.match(source, /\[data-workbench-dock-action="plugins"\]/u);
  assert.doesNotMatch(source, /page\.locator\('#redeven-plugin-switcher'\)\.count\(\)/u);
});

test('Desktop smoke normalizes every phase to the Activity Plugin Panel', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /getByRole\('tab', \{ name: 'Activity', exact: true \}\)/u);
  assert.match(source, /page\.locator\('\[aria-controls="redeven-plugin-switcher"\]'\)\.filter\(\{ visible: true \}\)/u);
  assert.doesNotMatch(source, /locator\('\[data-plugin-launcher-backdrop\]'\)\.count\(\) === 1/u);
});

test('Desktop smoke preserves surface-open diagnostics when the real iframe does not appear', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /surface-diagnostics\.json/u);
  assert.match(source, /tileBeforeOpen/u);
  assert.match(source, /surfaceErrors/u);
  assert.match(source, /pluginResponses/u);
  assert.match(source, /page\.locator\('\[data-plugin-surface-iframe\]'\)/u);
  assert.doesNotMatch(source, /candidate\.url\(\) === 'about:blank'/u);
  assert.match(source, /request observation failed/u);
  assert.match(source, /response observation failed/u);
});

test('Desktop smoke verifies owned PID cleanup and includes it in the final summary', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.sh', import.meta.url),
    'utf8',
  ));
  assert.match(source, /kill -0 "\$pid"/u);
  assert.match(source, /PIDS_RELEASED=false/u);
  assert.match(source, /cleanup:JSON\.parse\(f\.readFileSync\(p\.join\(root,"cleanup\.json"\)\)\)/u);
  assert.doesNotMatch(source, /"pids_released":true/u);
});

test('Desktop smoke records the task owner in each phase summary', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /owner_id: config\.ownerID/u);
});
