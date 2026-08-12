import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIsolatedSmokeConfiguration,
  assessPluginSmoke,
  browserPages,
  isEnvAppPage,
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

test('Desktop smoke reconnects CDP after opening a new Electron session window', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /await open\.click\(\);\s+browser = await reconnectBrowser\(\);/u);
  assert.doesNotMatch(source, /async \(\) => \{\s+await browser\.close\(\);\s+browser = await chromium\.connectOverCDP/u);
});

test('Desktop smoke identifies the Env App target by its product route before shell readiness', () => {
  assert.equal(isEnvAppPage({ url: () => 'http://127.0.0.1:60927/_redeven_proxy/env/' }), true);
  assert.equal(isEnvAppPage({ url: () => 'file:///workspace/desktop/dist/welcome/index.html' }), false);
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
  assert.doesNotMatch(source, /page\.locator\('#redeven-plugin-switcher'\)\.count\(\)/u);
});
