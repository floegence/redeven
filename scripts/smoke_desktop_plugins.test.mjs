import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAttachSmokeConfiguration,
  assertExtensionIOEvidence,
  assertIsolatedSmokeConfiguration,
  assessPluginSmoke,
  browserPages,
  ensureEnabledWorkerRuntime,
  isEnvAppPage,
  releaseRefFromInstalledPlugin,
  runtimePIDFromHealth,
  waitFor,
  workerResultFromRPCResponse,
} from './smoke_desktop_plugins.mjs';

const completeIOEvidence = {
  linux_target: {
    os: 'linux',
    arch: 'arm64',
    container_id: '0123456789abcdef',
    commit: '89ba888e68078fb77eeb29ed55e510a52382a338',
    runtime_pid: 41,
    local_ui_pid: 17,
    state_root: '/smoke/state',
  },
  v9: {
    manifest_schema: 'redevplugin.manifest.v9',
    enabled_after_install: true,
    fs: {
      bytes: 64 * 1024 * 1024,
      sha256: 'a'.repeat(64),
      expected_sha256: 'a'.repeat(64),
      list: true,
      stat: true,
      rename: true,
      watch: true,
      remove: true,
    },
    http: { download_bytes: 64 * 1024 * 1024, upload_bytes: 64 * 1024 * 1024, sha256: 'b'.repeat(64) },
    websocket: { messages: 100 },
    tcp: { exchanges: 100 },
    udp: { datagrams: 100 },
  },
  revoke: {
    disabled: true,
    pending_rpc_rejected: true,
    http_closed: true,
    websocket_closed: true,
    tcp_closed: true,
    revoked_resources: 4,
  },
};

test('Desktop smoke accepts complete Linux v9 I/O and revoke evidence', () => {
  assert.doesNotThrow(() => assertExtensionIOEvidence(completeIOEvidence));
});

test('Desktop smoke reads worker evidence from the canonical RPC result envelope', () => {
  const workerResult = { manifest: 'redevplugin.manifest.v9', fs: { bytes: 64 * 1024 * 1024 } };

  assert.equal(workerResultFromRPCResponse({ ok: true, data: { data: workerResult } }), workerResult);
  assert.throws(
    () => workerResultFromRPCResponse({ ok: true, data: workerResult }),
    /worker data/u,
  );
});

test('Desktop smoke rejects partial protocol or revoke coverage', () => {
  assert.throws(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    v9: { ...completeIOEvidence.v9, udp: { datagrams: 99 } },
  }), /UDP/u);
  assert.throws(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    revoke: { ...completeIOEvidence.revoke, websocket_closed: false },
  }), /revoke/u);
  assert.throws(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    v9: {
      ...completeIOEvidence.v9,
      fs: { ...completeIOEvidence.v9.fs, expected_sha256: 'f'.repeat(64) },
    },
  }), /FS/u);
});

test('Desktop smoke requires a distinct Linux PID and reused state for cold restart evidence', () => {
  assert.doesNotThrow(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    linux_target: { ...completeIOEvidence.linux_target, previous_runtime_pid: 40 },
    cold_restart: { runtime_restarted: true, state_root_reused: true, enabled_after_restart: true },
  }, { requireRevoke: false, requireColdRestart: true }));
  assert.throws(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    linux_target: { ...completeIOEvidence.linux_target, previous_runtime_pid: 41 },
    cold_restart: { runtime_restarted: true, state_root_reused: true, enabled_after_restart: true },
  }, { requireRevoke: false, requireColdRestart: true }), /cold restart/u);
  assert.throws(() => assertExtensionIOEvidence({
    ...completeIOEvidence,
    linux_target: { ...completeIOEvidence.linux_target, runtime_pid: completeIOEvidence.linux_target.local_ui_pid },
  }), /provenance/u);
});

test('Desktop smoke starts and retries workers installed after an empty startup recovery snapshot', async () => {
  const requests = [];
  const responses = new Map([
    ['/_redevplugin/api/plugins/features/query', { status: 200, body: { ok: true, data: ['runtime', 'io', 'connectivity'] } }],
    ['/_redevplugin/api/plugins/runtime/health/query', [
      {
        status: 200,
        body: {
          ok: true,
          data: {
            ready: false,
            descriptor: { target: 'linux/arm64' },
            shards: [],
          },
        },
      },
      {
        status: 200,
        body: {
          ok: true,
          data: {
            ready: true,
            descriptor: { target: 'linux/arm64' },
            shards: [{ ready: true, runtime_instance_id: 'runtime_431', descriptor: { target: 'linux/arm64' } }],
          },
        },
      },
    ]],
    ['/_redevplugin/api/plugins/runtime/start', {
      status: 200,
      body: {
        ok: true,
        data: {
          ready: true,
          descriptor: { target: 'linux/arm64' },
          shards: [{ ready: true, runtime_instance_id: 'runtime_431', descriptor: { target: 'linux/arm64' } }],
        },
      },
    }],
    ['/_redevplugin/api/plugins/runtime/recover/retry', {
      status: 200,
      body: { ok: true, data: { status: 'ready' } },
    }],
  ]);
  const request = async (pathname, body) => {
    requests.push({ pathname, body });
    const configured = responses.get(pathname);
    return Array.isArray(configured) ? configured.shift() : configured;
  };
  const plugins = [
    { plugin_instance_id: 'plugini_io', enable_state: 'enabled', manifest: { workers: [{ worker_id: 'io' }] } },
    { plugin_instance_id: 'plugini_ui', enable_state: 'enabled', manifest: { workers: [] } },
  ];

  const result = await ensureEnabledWorkerRuntime({ request, plugins });

  assert.equal(result.runtimePID, 431);
  assert.deepEqual(requests, [
    { pathname: '/_redevplugin/api/plugins/features/query', body: {} },
    { pathname: '/_redevplugin/api/plugins/runtime/health/query', body: {} },
    { pathname: '/_redevplugin/api/plugins/runtime/start', body: { target: { os: 'linux', arch: 'arm64' } } },
    { pathname: '/_redevplugin/api/plugins/runtime/recover/retry', body: { plugin_instance_id: 'plugini_io' } },
    { pathname: '/_redevplugin/api/plugins/runtime/health/query', body: {} },
  ]);
});

test('Desktop smoke rejects Local UI agent identity as runtime PID evidence', () => {
  assert.equal(runtimePIDFromHealth({
    ready: true,
    shards: [{ ready: true, runtime_instance_id: 'runtime_431' }],
  }), 431);
  assert.throws(() => runtimePIDFromHealth({
    ready: true,
    shards: [{ ready: true, runtime_instance_id: 'agent_17' }],
  }), /runtime process identity/u);
});

test('Desktop smoke does not expose bridge credentials in observations', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(source, /plugin_gateway_token.*observation/u);
  assert.doesNotMatch(source, /revoked_resources:[^\n]*\?\? 1/u);
  assert.match(source, /'x-redeven-plugin-session': payload\.pluginSession/u);
  assert.doesNotMatch(source, /plugin_session_credential.*observation/u);
});

test('v9 I/O smoke surface runs as an opaque worker and drives hold through rendered UI', async () => {
  const fs = await import('node:fs/promises');
  const [workerSource, browserSource] = await Promise.all([
    fs.readFile(new URL('./fixtures/redevplugin_io_smoke/ui/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('./smoke_desktop_plugins.mjs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(workerSource, /\b(?:document|window|location)\b/u);
  assert.match(workerSource, /bridge\.render\(/u);
  assert.match(workerSource, /data-redevplugin-action[^\n]*hold-smoke/u);
  assert.match(workerSource, /bridge\.onAction\(['"]hold-smoke['"]/u);
  assert.match(browserSource, /data-redevplugin-action="hold-smoke"/u);
  assert.doesNotMatch(browserSource, /window\.__ioSmokeHold/u);
});

test('Desktop smoke retains the active I/O frame through revoke verification', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  const frameDeclaration = source.indexOf('let frame = null;');
  const inventoryAssessment = source.indexOf('const inventoryAssessment');
  const revokeVerification = source.indexOf('verifyIOSmokeRevoke(page, frame', inventoryAssessment);
  assert.ok(frameDeclaration >= 0 && frameDeclaration < inventoryAssessment);
  assert.ok(revokeVerification > inventoryAssessment);
  assert.equal(source.indexOf('let frame;', inventoryAssessment), -1);
});

test('v9 I/O smoke worker preserves stable SDK errors instead of collapsing them into HOSTCALL_FAILED', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./fixtures/redevplugin_io_smoke/worker/src/lib.rs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /fn platform_error\(error: PlatformError\) -> WorkerError/u);
  assert.match(source, /ErrorCode::MountUnavailable => "MOUNT_UNAVAILABLE"/u);
  assert.match(source, /ErrorCode::PermissionDenied => "PERMISSION_DENIED"/u);
  assert.doesNotMatch(source, /fn fail\(/u);
  assert.doesNotMatch(source, /WorkerError::hostcall\(error\.to_string\(\)\)/u);
});

test('v9 I/O smoke keeps 64 MiB transfer verification bounded to streaming chunks', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./fixtures/redevplugin_io_smoke/worker/src/lib.rs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /file\.read\(CHUNK\)/u);
  assert.match(source, /download_body\.read\(CHUNK\)/u);
  assert.doesNotMatch(source, /fs::read_file/u);
  assert.doesNotMatch(source, /\.read_all\(\)/u);
  assert.doesNotMatch(source, /Sha256/u);
});

test('Desktop smoke persists the failed RPC response and iframe diagnostics on timeout', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /rpc-diagnostics\.json/u);
  assert.match(source, /matchingRequests/u);
  assert.match(source, /matchingResponses/u);
  assert.match(source, /iframeBody/u);
  assert.match(source, /fixtureState/u);
  assert.match(source, /diagnosticResponse/u);
  assert.match(source, /plugins\/diagnostics\/query/u);
  assert.match(source, /consoleErrors/u);
  assert.match(source, /pageErrors/u);
});

test('Desktop smoke redacts Local UI resume credentials from persisted unlock evidence', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  const unlockEvidence = source.slice(
    source.indexOf("const accessPassword = page.locator('#redeven-access-password');"),
    source.indexOf("phase = 'surface_reset';"),
  );
  assert.match(unlockEvidence, /unlocked: body\?\.data\?\.unlocked === true/u);
  assert.doesNotMatch(unlockEvidence, /response\.text\(\)|resume_token/u);
});

test('Desktop smoke launches a task-owned Linux target and opens it through the Desktop preload bridge', async () => {
  const [shellSource, browserSource] = await Promise.all([
    import('node:fs/promises').then((fs) => fs.readFile(new URL('./smoke_desktop_plugins.sh', import.meta.url), 'utf8')),
    import('node:fs/promises').then((fs) => fs.readFile(new URL('./smoke_desktop_plugins.mjs', import.meta.url), 'utf8')),
  ]);
  assert.match(shellSource, /docker run/u);
  assert.match(shellSource, /linux\/arm64/u);
  assert.ok(shellSource.indexOf('scripts/build_assets.sh') < shellSource.indexOf('go build -trimpath -o /out/redeven'));
  assert.match(shellSource, /REDEVEN_DESKTOP_AUTO_START_RUNTIME=0/u);
  assert.match(browserSource, /redevenDesktopLauncher\.performAction/u);
  assert.match(browserSource, /kind: 'open_remote_environment'/u);
  assert.match(shellSource, /restart_linux_redeven/u);
  assert.match(shellSource, /run_phase initial\s+restart_linux_redeven\s+run_phase cold_restart/u);
  assert.match(shellSource, /previous_runtime_pid/u);
  assert.match(shellSource, /reserve_linux_ports/u);
  assert.match(shellSource, /container_removed/u);
  assert.doesNotMatch(shellSource, /127\.0\.0\.1:1808[0-2]:1808[0-2]/u);
});

test('Linux smoke reserves a distinct non-ephemeral port group for the shared container namespace', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.sh', import.meta.url),
    'utf8',
  ));
  assert.match(source, /reserve_linux_ports/u);
  assert.match(source, /LOW_PORT_MIN=20000/u);
  assert.match(source, /LOW_PORT_MAX=29999/u);
  assert.match(source, /new Set\(ports\)\.size === ports\.length/u);
  assert.doesNotMatch(source, /LINUX_UI_PORT=.*\$\(reserve_port\)/u);
  assert.doesNotMatch(source, /FIXTURE_HTTP_PORT=.*\$\(reserve_port\)/u);
});

test('Linux smoke permits Host clone3 so the runtime can install its own containment profile', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.sh', import.meta.url),
    'utf8',
  ));
  assert.match(source, /docker run -d --rm --platform linux\/arm64 --security-opt seccomp=unconfined/u);
});

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

test('browser smoke opens the Panel before waiting for session inventory credentials', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  const sessionWait = source.indexOf("}, 30_000, 'plugin session credential');");
  const panelPhase = source.indexOf("phase = 'panel_open';");
  const panelOpen = source.indexOf("await visiblePluginTrigger().click();", panelPhase);
  assert.ok(panelOpen > panelPhase && sessionWait > panelOpen);
  assert.doesNotMatch(source, /session inventory prefetch|data-plugin-inventory-debug/u);
  assert.match(source, /config\.mode === 'attach'[\s\S]*?aria-expanded[\s\S]*?state: 'detached'/u);
});

test('the Activity Plugin Panel is an eagerly mounted core control', async () => {
  const fs = await import('node:fs/promises');
  const [shellSource, panelSource] = await Promise.all([
    fs.readFile(new URL('../internal/envapp/ui_src/src/ui/EnvAppShell.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(shellSource, /import \{ PluginPanel \} from '\.\/plugins\/PluginPanel'/u);
  assert.doesNotMatch(shellSource, /const PluginPanel = lazy/u);
  assert.match(shellSource, /type PluginPanelState = Readonly<\{[\s\S]*?open: boolean;[\s\S]*?placement: 'activity' \| 'workbench';[\s\S]*?trigger: HTMLButtonElement \| null;/u);
  assert.match(shellSource, /createSignal<PluginPanelState>/u);
  assert.match(shellSource, /<PluginPanel[\s\S]*?open=\{pluginsPanelOpen\(\)\}/u);
  assert.match(shellSource, /<EnvContext\.Provider[\s\S]*?>\s*<PluginPanel[\s\S]*?<TerminalSessionCatalogProvider>/u);
  assert.doesNotMatch(shellSource, /requestPluginPanelState|activePluginPanelManager|activePluginsActivityBinding/u);
  assert.doesNotMatch(shellSource, /data-plugin-inventory-debug/u);
  assert.match(panelSource, /import \{ Portal \} from 'solid-js\/web'/u);
  assert.match(panelSource, /const visible = \(\) => props\.open \|\| mounted\(\)/u);
  assert.match(panelSource, /<Portal>[\s\S]*?data-plugin-launcher-backdrop=\{visible\(\) \? '' : undefined\}[\s\S]*?hidden=\{!visible\(\)\}/u);
  assert.doesNotMatch(panelSource, /openCommands|registerController|PLUGIN_PANEL_CONTROL_EVENT/u);
});

test('Linux fixture preparation resolves the current published Go module', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.sh', import.meta.url),
    'utf8',
  ));
  assert.match(source, /GOWORK=off go list -m -f '\{\{\.Version\}\}' github\.com\/floegence\/redevplugin\/v3/u);
  assert.match(source, /runtime_version=\$\{runtime_tag#v\}/u);
  assert.match(source, /GOWORK=off go list -m -f '\{\{\.Dir\}\}' "github\.com\/floegence\/redevplugin\/v3@\$\{runtime_tag\}"/u);
  assert.doesNotMatch(source, /read_redevplugin_release_manifest/u);
  assert.doesNotMatch(source, /testdata\/compat|v1\.1\.4/u);
  assert.doesNotMatch(source, /\/Users\/[^"]+\/go\/pkg\/mod\/github\.com\/floegence\/redevplugin/u);
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
  assert.match(source, /official plugin activation/u);
  assert.match(source, /cold restart started without an enabled plugin/u);
});

test('Desktop smoke waits for the current plugin surface before fixing Panel expectations', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /active\.some\(\(plugin\) => plugin\.plugin_instance_id === installed\.plugin_instance_id/u);
  assert.match(source, /v9 plugin activation/u);
  assert.match(source, /panel-reopen-\$\{index \+ 1\}-diagnostics\.json/u);
});

test('Desktop smoke refreshes the UI projection once after direct fixture installation', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /if \(config\.ioPackagePath\) \{[\s\S]*?data-plugin-center-market-action[\s\S]*?data-plugin-center-refresh/u);
  assert.match(source, /centerItems\.count\(\) === bootstrap\.enabledCount/u);
  assert.match(source, /pluginCenterRefresh\.isDisabled\(\)/u);
  assert.match(source, /Plugin Center projection after direct smoke install/u);
  assert.match(source, /direct-install-projection-diagnostics\.json/u);
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
  assert.match(source, /plugin\?\.enable_state === 'disabled_by_user'/u);
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

test('Desktop smoke reopens the Panel five times without a visible loading state or inventory reload', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./smoke_desktop_plugins.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /for \(let index = 0; index < 5; index \+= 1\)/u);
  assert.match(source, /Loading plugins\|正在加载插件/u);
  assert.match(source, /catalogQueryCountBefore/u);
  assert.match(source, /catalogQueryCountAfter/u);
  assert.match(source, /catalogQueryCountAfter !== catalogQueryCountBefore/u);
  assert.match(source, /open_duration_ms/u);
  assert.match(source, /tile_keys/u);
  assert.match(source, /inventory_refresh_count/u);
  assert.match(source, /background refresh control pending/u);
  assert.match(source, /page\.route\('\*\*\/_redevplugin\/api\/plugins\/catalog\/query'/u);
  assert.match(source, /background_refresh_tile_keys/u);
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
  assert.match(source, /const pluginCenter = page\.locator\('\[data-plugin-center-view\]'\)/u);
  assert.match(source, /if \(await pluginCenter\.isVisible\(\)\.catch\(\(\) => false\)\) \{[\s\S]*?page\.locator\('\[data-plugin-center-close\]'\)\.click\(\)[\s\S]*?pluginCenter\.waitFor\(\{ state: 'hidden'/u);
  assert.match(source, /plugin-center-close-diagnostics\.json/u);
  assert.doesNotMatch(source, /data-activity-id="monitor"/u);
  assert.match(source, /const activityPluginTrigger = page\.locator\('\[aria-controls="redeven-plugin-switcher"\]'\)\.filter\(\{ visible: true \}\)\.first\(\)/u);
  assert.match(source, /const pluginPanelBackdrop = page\.locator\('\[data-plugin-launcher-backdrop\]'\)\.first\(\)/u);
  assert.match(source, /if \(!await pluginPanelBackdrop\.isVisible\(\)\.catch\(\(\) => false\)\) \{[\s\S]*?await activityPluginTrigger\.click\(\);[\s\S]*?pluginPanelBackdrop\.waitFor\(\{ state: 'visible'/u);
  assert.doesNotMatch(source, /stale Activity Plugin Panel trigger reset|panelTriggerOpenDelayMS|pluginPanelActivityEvents|__redevenPluginPanelClickTrace/u);
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
