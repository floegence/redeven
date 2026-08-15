import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAttachSmokeConfiguration,
  assertIsolatedSmokeConfiguration,
  assessPluginSmoke,
  browserPages,
  isEnvAppPage,
  releaseRefFromInstalledPlugin,
  waitFor,
} from './smoke_desktop_plugins.mjs';

test('attach smoke accepts the shared dev Desktop ports with verified provenance', () => {
  assert.doesNotThrow(() => assertAttachSmokeConfiguration({
    mode: 'attach',
    cdpPort: 9222,
    localUIPort: 23998,
    inspectorPort: 9230,
    electronPID: 86045,
    runtimePID: 86386,
    runningRoot: '/Users/test/code/redeven',
    runningCommit: '416871dd1731',
    runtimeCommit: '416871dd1731',
    ownerID: 'owner-id',
    stateRoot: '/Users/test/.redeven',
  }));
});

test('attach smoke requires process and commit provenance', () => {
  assert.throws(() => assertAttachSmokeConfiguration({
    mode: 'attach',
    cdpPort: 9222,
    localUIPort: 23998,
    inspectorPort: 9230,
    electronPID: 86045,
    runtimePID: 86386,
    runningRoot: '/Users/test/code/redeven',
    runningCommit: 'different',
    runtimeCommit: '416871dd1731',
    ownerID: 'owner-id',
    stateRoot: '/Users/test/.redeven',
  }), /commit provenance/u);
});

test('attach shell never launches, installs, restarts, or stops the existing Desktop', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.sh', import.meta.url),
    'utf8',
  ));
  assert.match(source, /if \[\[ "\$MODE" == "attach" \]\]; then[\s\S]*?run_attach[\s\S]*?exit \$\?/u);
  const attachFunction = source.slice(
    source.indexOf('run_attach() {'),
    source.lastIndexOf('if [[ "$MODE" == "attach" ]]'),
  );
  assert.doesNotMatch(attachFunction, /dev_desktop\.sh|stop_owned|plugin-center-install|cold_restart/u);
  assert.match(attachFunction, /process-preservation\.json/u);
  assert.match(attachFunction, /kill -0/u);
  assert.match(attachFunction, /smoke_commit.*running_commit/u);
  assert.match(attachFunction, /runtime_status.*ready/u);
  assert.match(attachFunction, /runtime_open_readiness.*openable/u);
});

test('attach browser smoke opens the Panel before waiting for a current session credential', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  const panelOpen = source.indexOf("await visiblePluginTrigger().click();");
  const sessionWait = source.indexOf("}, 30_000, 'plugin session credential');");
  assert.ok(panelOpen > 0 && sessionWait > panelOpen);
  assert.match(source, /config\.mode === 'attach'[\s\S]*?aria-expanded[\s\S]*?state: 'detached'/u);
});

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

test('plugin smoke fails on a typed recovery failure and preserves its body', () => {
  const recovery = {
    ok: true,
    data: {
      results: [{
        plugin_instance_id: 'catalog_containers',
        status: 'failed',
        error: { reason: 'trust_state_advanced', action: 'retry' },
      }],
    },
  };
  const result = assessPluginSmoke({ recovery, catalog: { plugins: [] }, panelInstalledCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'recovery_failed');
  assert.deepEqual(result.recovery, recovery);
});

test('plugin smoke fails when enabled catalog and Panel installed counts differ', () => {
  const result = assessPluginSmoke({
    recovery: { ok: true, data: { results: [{ plugin_instance_id: 'catalog_containers', status: 'ready' }] } },
    catalog: { plugins: [{ plugin_instance_id: 'catalog_containers', enable_state: 'enabled' }] },
    panelInstalledCount: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'inventory_count_mismatch');
  assert.equal(result.catalogEnabledCount, 1);
});

test('plugin smoke rejects an empty catalog instead of passing without a real plugin', () => {
  const result = assessPluginSmoke({
    recovery: { ok: true, data: { results: [] } },
    catalog: { plugins: [] },
    panelInstalledCount: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'enabled_plugin_missing');
});

test('plugin smoke accepts converged recovery, matching Panel inventory, iframe, and RPC', () => {
  const result = assessPluginSmoke({
    recovery: { ok: true, data: { results: [{ plugin_instance_id: 'catalog_containers', status: 'ready' }] } },
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
  assert.match(source, /installedPlugins\(catalog\)\.length > 0/u);
  assert.doesNotMatch(source, /\[data-plugin-center-card-primary\]/u);
  assert.doesNotMatch(source, /official plugin enable action/u);
  assert.match(source, /official plugin installation did not finish enabled/u);
  assert.match(source, /cold restart started without an enabled plugin/u);
});

test('Desktop smoke reconstructs the exact signed release reference from Host-owned installed facts', () => {
  assert.deepEqual(releaseRefFromInstalledPlugin({
    package_hash: 'package-sha256',
    manifest_hash: 'manifest-sha256',
    entries_hash: 'entries-sha256',
    release_trust_binding: {
      source_id: 'official',
      channel: 'stable',
      release_metadata_ref: 'https://example.invalid/release.json',
      release_metadata_sha256: 'release-sha256',
      publisher_id: 'redeven',
      plugin_id: 'containers',
      version: '4.4.4',
    },
  }), {
    source_id: 'official',
    channel: 'stable',
    release_metadata_ref: 'https://example.invalid/release.json',
    release_metadata_sha256: 'release-sha256',
    publisher_id: 'redeven',
    plugin_id: 'containers',
    version: '4.4.4',
    expected_hashes: {
      package_sha256: 'package-sha256',
      manifest_sha256: 'manifest-sha256',
      entries_sha256: 'entries-sha256',
    },
  });
});

test('Desktop smoke verifies user-disabled intent through a real signed release update', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /\/_redevplugin\/api\/plugins\/disable/u);
  assert.match(source, /\/_redevplugin\/api\/plugins\/update-release-ref/u);
  assert.match(source, /plugin\?\.enable_state === 'disabled'/u);
  assert.match(source, /disabled_update_intent: disabledUpdateIntent/u);
  assert.match(source, /explicit re-enable before cold restart/u);
});

test('Desktop smoke uses the current Host-owned recovery route', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /runtime\/recover-enabled/u);
  assert.doesNotMatch(source, /runtime\/refresh-enabled/u);
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
  assert.match(source, /page\.locator\('\[data-plugin-center-view\]'\)\.waitFor\(\{ state: 'hidden'/u);
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
  const initialBackdropIndex = source.indexOf('initialBackdrop');
  assert.ok(
    initialBackdropIndex >= 0 && initialBackdropIndex < source.indexOf('const activityMode'),
    'an already-open Panel must be closed before the Activity tab can be clicked',
  );
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

test('Desktop smoke resets an existing surface and requires a predecoded installed icon', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /while \(await existingSurfaceHosts\.count\(\) > 0\)/u);
  assert.match(source, /data-redeven-plugin-activity-window/u);
  assert.match(source, /icon\\\/\[0-9a-f\]\{64\}/u);
  assert.match(source, /startsWith\('blob:'\)/u);
  assert.match(source, /naturalWidth <= 0/u);
  assert.match(source, /iconFallbackCount !== 0/u);
  assert.match(source, /icon_responses: pluginIconResponses/u);
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
