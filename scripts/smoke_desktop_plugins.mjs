import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SHARED_PORTS = new Set([23998, 9222, 9230]);
const PLUGIN_TRIGGER_SELECTOR = '[aria-controls="redeven-plugin-switcher"], [data-workbench-dock-action="plugins"]';
const require = createRequire(import.meta.url);

export function assertIsolatedSmokeConfiguration(config) {
  const root = path.resolve(String(config.root ?? ''));
  const roots = [config.stateRoot, config.userDataRoot, config.cacheRoot, config.tempRoot]
    .map((value) => path.resolve(String(value ?? '')));
  const taskSeedState = config.reusedTaskState === true
    && /^\/tmp\/(?:redeven-plugin-|rdsmoke-)/u.test(roots[0]);
  if (!root.startsWith('/tmp/') || roots.slice(1).some((value) => !value.startsWith(`${root}${path.sep}`))
    || (!roots[0].startsWith(`${root}${path.sep}`) && !taskSeedState)) {
    throw new Error('plugin smoke must use task-owned roots below its unique /tmp root, not shared Desktop state');
  }
  if (roots.some((value) => value.endsWith(`${path.sep}.redeven`))) {
    throw new Error('plugin smoke must not use shared Desktop state');
  }
  for (const port of [config.localUIPort, config.cdpPort, config.inspectorPort].map(Number)) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || SHARED_PORTS.has(port)) {
      throw new Error('plugin smoke must use unique non-shared ports');
    }
  }
}

export function assertAttachSmokeConfiguration(config) {
  const requiredPorts = [config.localUIPort, config.cdpPort, config.inspectorPort].map(Number);
  const requiredPIDs = [config.electronPID, config.runtimePID].map(Number);
  const runningCommit = String(config.runningCommit ?? '').trim();
  const runtimeCommit = String(config.runtimeCommit ?? '').trim();
  if (config.mode !== 'attach'
    || requiredPorts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
    || requiredPIDs.some((pid) => !Number.isInteger(pid) || pid <= 1)
    || !path.isAbsolute(String(config.runningRoot ?? ''))
    || !path.isAbsolute(String(config.stateRoot ?? ''))
    || !String(config.ownerID ?? '').trim()) {
    throw new Error('attach smoke requires complete running Desktop provenance');
  }
  if (!runningCommit || !runtimeCommit
    || (!runningCommit.startsWith(runtimeCommit) && !runtimeCommit.startsWith(runningCommit))) {
    throw new Error('attach smoke commit provenance does not match the running runtime');
  }
}

export function assertExtensionIOEvidence(evidence, { requireRevoke = true, requireColdRestart = false } = {}) {
  const target = evidence?.linux_target;
  if (target?.os !== 'linux' || !['amd64', 'arm64'].includes(target.arch)
    || !/^[0-9a-f]{12,64}$/u.test(String(target.container_id ?? ''))
    || !/^[0-9a-f]{12,40}$/u.test(String(target.commit ?? ''))
    || !Number.isInteger(target.runtime_pid) || target.runtime_pid <= 1
    || !Number.isInteger(target.local_ui_pid) || target.local_ui_pid <= 1
    || !String(target.state_root ?? '').startsWith('/')) {
    throw new Error('Linux target provenance is incomplete');
  }
  const v9 = evidence?.v9;
  if (v9?.manifest_schema !== 'redevplugin.manifest.v9' || v9.enabled_after_install !== true) {
    throw new Error('v9 install evidence is incomplete');
  }
  if (!Number.isInteger(v9.fs?.bytes) || v9.fs.bytes < 64 * 1024 * 1024
    || !/^[0-9a-f]{64}$/u.test(String(v9.fs.sha256 ?? ''))
    || ['list', 'stat', 'rename', 'watch', 'remove'].some((key) => v9.fs[key] !== true)) {
    throw new Error('v9 FS streaming/list/stat/rename/watch/remove evidence is incomplete');
  }
  if (!Number.isInteger(v9.http?.download_bytes) || v9.http.download_bytes < 64 * 1024 * 1024
    || !Number.isInteger(v9.http?.upload_bytes) || v9.http.upload_bytes < 64 * 1024 * 1024
    || !/^[0-9a-f]{64}$/u.test(String(v9.http.sha256 ?? ''))) {
    throw new Error('v9 HTTP streaming evidence is incomplete');
  }
  if (!Number.isInteger(v9.websocket?.messages) || v9.websocket.messages < 100) throw new Error('v9 WebSocket evidence is incomplete');
  if (!Number.isInteger(v9.tcp?.exchanges) || v9.tcp.exchanges < 100) throw new Error('v9 TCP evidence is incomplete');
  if (!Number.isInteger(v9.udp?.datagrams) || v9.udp.datagrams < 100) throw new Error('v9 UDP evidence is incomplete');
  const frozen = evidence?.frozen_v1_1_4;
  if (!String(frozen?.package ?? '').endsWith('.redevplugin')
    || !/^[0-9a-f]{64}$/u.test(String(frozen.expected_sha256 ?? ''))
    || frozen.expected_sha256 !== frozen.observed_sha256 || frozen.rpc_ok !== true
    || !String(frozen.plugin_instance_id ?? '').trim()) {
    throw new Error('frozen v1.1.4 compatibility evidence is incomplete');
  }
  if (requireRevoke) {
    const revoke = evidence?.revoke;
    if (revoke?.disabled !== true || revoke.pending_rpc_rejected !== true
      || revoke.http_closed !== true || revoke.websocket_closed !== true || revoke.tcp_closed !== true
      || !Number.isInteger(revoke.revoked_resources) || revoke.revoked_resources < 3) {
      throw new Error('revoke/resource closure evidence is incomplete');
    }
  }
  if (requireColdRestart) {
    const cold = evidence?.cold_restart;
    if (cold?.runtime_restarted !== true || cold?.state_root_reused !== true
      || cold?.enabled_after_restart !== true
      || !Number.isInteger(target.previous_runtime_pid) || target.previous_runtime_pid <= 1
      || target.previous_runtime_pid === target.runtime_pid) {
      throw new Error('Linux cold restart evidence is incomplete');
    }
  }
  return true;
}

export function assessPluginSmoke({ recovery, catalog, panelInstalledCount, surface, rpc }) {
  const results = Array.isArray(recovery?.data?.results) ? recovery.data.results : [];
  if (!recovery?.ok || results.some((result) => result?.status === 'failed')) {
    return { ok: false, failure: 'recovery_failed', recovery };
  }
  const plugins = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
  const catalogEnabledCount = plugins.filter((plugin) => plugin?.enable_state === 'enabled').length;
  if (catalogEnabledCount === 0) {
    return { ok: false, failure: 'enabled_plugin_missing', recovery, catalogEnabledCount };
  }
  if (catalogEnabledCount !== Number(panelInstalledCount)) {
    return {
      ok: false,
      failure: 'inventory_count_mismatch',
      recovery,
      catalogEnabledCount,
      panelInstalledCount: Number(panelInstalledCount),
    };
  }
  if (catalogEnabledCount > 0 && !surface?.ready) {
    return { ok: false, failure: 'surface_not_ready', recovery, catalogEnabledCount, panelInstalledCount };
  }
  if (catalogEnabledCount > 0 && !rpc?.ok) {
    return { ok: false, failure: 'rpc_failed', recovery, catalogEnabledCount, panelInstalledCount, surface, rpc };
  }
  return { ok: true, recovery, catalogEnabledCount, panelInstalledCount, surface, rpc };
}

export function browserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

export function isEnvAppPage(page) {
  try {
    return new URL(page.url()).pathname.startsWith('/_redeven_proxy/env/');
  } catch {
    return false;
  }
}

export async function waitFor(check, timeoutMS, label, options = {}) {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((timeout) => new Promise((resolve) => setTimeout(resolve, timeout)));
  const deadline = now() + timeoutMS;
  let lastError;
  while (now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  try {
    const value = await check();
    if (value) return value;
  } catch (error) {
    lastError = error;
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function responseJSON(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestPluginJSON(page, pathname, body = {}, inheritedHeaders = {}) {
  const headers = Object.fromEntries(Object.entries(inheritedHeaders).filter(([key]) => (
    /^(x-redevplugin-csrf|x-redeven-plugin-session|content-type)$/iu.test(key)
  )));
  headers['content-type'] ??= 'application/json';
  return page.evaluate(async ({ pathname: requestPath, body: requestBody, requestHeaders }) => {
    const response = await fetch(requestPath, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, body: payload };
  }, { pathname, body, requestHeaders: headers });
}

function enabledPlugins(catalog) {
  return Array.isArray(catalog?.plugins)
    ? catalog.plugins.filter((plugin) => plugin?.enable_state === 'enabled')
    : [];
}

function installedPlugins(catalog) {
  return Array.isArray(catalog?.plugins) ? catalog.plugins : [];
}

export function releaseRefFromInstalledPlugin(plugin) {
  const binding = plugin?.release_trust_binding;
  const expectedHashes = {
    package_sha256: plugin?.package_hash,
    manifest_sha256: plugin?.manifest_hash,
    entries_sha256: plugin?.entries_hash,
  };
  if (!binding || Object.values(expectedHashes).some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('installed official plugin does not expose its verified release binding');
  }
  return {
    source_id: binding.source_id,
    channel: binding.channel,
    release_metadata_ref: binding.release_metadata_ref,
    release_metadata_sha256: binding.release_metadata_sha256,
    publisher_id: binding.publisher_id,
    plugin_id: binding.plugin_id,
    version: binding.version,
    expected_hashes: expectedHashes,
  };
}

async function verifyDisabledUpdateIntent(page, sessionHeaders, initialCatalog, pluginResponses) {
  const initiallyEnabled = enabledPlugins(initialCatalog)[0];
  if (!initiallyEnabled) throw new Error('disabled update smoke requires an enabled official plugin');
  const queryCatalog = async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/catalog/query', {}, sessionHeaders);
    pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/catalog/query', ...response });
    return response;
  };
  const mutate = async (pathname, body) => {
    const response = await requestPluginJSON(page, pathname, body, sessionHeaders);
    pluginResponses.push({ method: 'POST', pathname, ...response });
    if (response.status !== 200) throw new Error(`${pathname} failed with status ${response.status}`);
    return response.body?.data ?? response.body;
  };

  await mutate('/_redevplugin/api/plugins/disable', {
    plugin_instance_id: initiallyEnabled.plugin_instance_id,
    expected_management_revision: initiallyEnabled.management_revision,
    reason: 'user_disabled',
  });
  const disabledCatalog = await waitFor(async () => {
    const response = await queryCatalog();
    if (response.status !== 200) return null;
    const catalog = response.body?.data ?? response.body;
    return installedPlugins(catalog).find((plugin) => (
      plugin.plugin_instance_id === initiallyEnabled.plugin_instance_id && plugin.enable_state === 'disabled'
    )) ? catalog : null;
  }, 30_000, 'user-disabled plugin state');
  const disabled = installedPlugins(disabledCatalog).find(
    (plugin) => plugin.plugin_instance_id === initiallyEnabled.plugin_instance_id,
  );

  await mutate('/_redevplugin/api/plugins/update-release-ref', {
    plugin_instance_id: disabled.plugin_instance_id,
    expected_management_revision: disabled.management_revision,
    release_ref: releaseRefFromInstalledPlugin(disabled),
  });
  const preservedCatalog = await waitFor(async () => {
    const response = await queryCatalog();
    if (response.status !== 200) return null;
    const catalog = response.body?.data ?? response.body;
    const plugin = installedPlugins(catalog).find((candidate) => candidate.plugin_instance_id === disabled.plugin_instance_id);
    return plugin?.enable_state === 'disabled' && plugin.management_revision > disabled.management_revision ? catalog : null;
  }, 120_000, 'disabled intent after signed release update');
  const preserved = installedPlugins(preservedCatalog).find(
    (plugin) => plugin.plugin_instance_id === initiallyEnabled.plugin_instance_id,
  );

  await mutate('/_redevplugin/api/plugins/enable', {
    plugin_instance_id: preserved.plugin_instance_id,
    expected_management_revision: preserved.management_revision,
  });
  const restoredCatalog = await waitFor(async () => {
    const response = await queryCatalog();
    if (response.status !== 200) return null;
    const catalog = response.body?.data ?? response.body;
    return enabledPlugins(catalog).some((plugin) => plugin.plugin_instance_id === preserved.plugin_instance_id)
      ? catalog
      : null;
  }, 120_000, 'explicit re-enable before cold restart');
  const restored = enabledPlugins(restoredCatalog).find(
    (plugin) => plugin.plugin_instance_id === initiallyEnabled.plugin_instance_id,
  );
  return {
    plugin_instance_id: initiallyEnabled.plugin_instance_id,
    before_revision: initiallyEnabled.management_revision,
    disabled_revision: disabled.management_revision,
    updated_revision: preserved.management_revision,
    updated_enable_state: preserved.enable_state,
    restored_revision: restored.management_revision,
    restored_enable_state: restored.enable_state,
  };
}

async function installUploadedSmokePlugin(page, sessionHeaders, config, pluginResponses) {
  const packageBytes = await fs.readFile(config.ioPackagePath);
  const encoded = packageBytes.toString('base64');
  const inspectionResponse = await page.evaluate(async (payload) => {
    const bytes = Uint8Array.from(atob(payload.bytes), (value) => value.charCodeAt(0));
    const response = await fetch('/_redevplugin/api/plugins/external-packages/upload/inspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/vnd.redevplugin.package+zip',
        ...(payload.csrf ? { 'x-redevplugin-csrf': payload.csrf } : {}),
        ...(payload.pluginSession ? { 'x-redeven-plugin-session': payload.pluginSession } : {}),
      },
      credentials: 'include',
      body: bytes,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, {
    bytes: encoded,
    csrf: sessionHeaders['x-redevplugin-csrf'],
    pluginSession: sessionHeaders['x-redeven-plugin-session'],
  });
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/external-packages/upload/inspect', ...inspectionResponse });
  if (inspectionResponse.status !== 200) throw new Error(`I/O package inspection failed: ${JSON.stringify(inspectionResponse)}`);
  const inspection = inspectionResponse.body?.data ?? inspectionResponse.body;
  const approvedPermissionIDs = [...new Set((inspection.security_summary?.permissions ?? []).map((permission) => permission.permission_id))];
  const installResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/external-packages/install', {
    inspection_id: inspection.inspection_id,
    expected_package_sha256: inspection.inspected_hashes.package_sha256,
    activate_after_install: true,
    approved_permission_ids: approvedPermissionIDs,
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/external-packages/install', ...installResponse });
  if (installResponse.status !== 200) throw new Error(`I/O package install failed: ${JSON.stringify(installResponse)}`);
  return {
    performed: true,
    enabledCount: 1,
    package_sha256: inspection.inspected_hashes.package_sha256,
    approved_permission_ids: approvedPermissionIDs,
    plugin_instance_id: installResponse.body?.data?.plugin?.plugin_instance_id ?? installResponse.body?.plugin?.plugin_instance_id,
  };
}

async function installCompatibilityPackage(page, sessionHeaders, packagePath, pluginResponses) {
  const bytes = (await fs.readFile(packagePath)).toString('base64');
  const inspectionResponse = await page.evaluate(async (payload) => {
    const raw = Uint8Array.from(atob(payload.bytes), (value) => value.charCodeAt(0));
    const response = await fetch('/_redevplugin/api/plugins/external-packages/upload/inspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/vnd.redevplugin.package+zip',
        'x-redevplugin-csrf': payload.csrf,
        'x-redeven-plugin-session': payload.pluginSession,
      },
      body: raw,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, {
    bytes,
    csrf: sessionHeaders['x-redevplugin-csrf'],
    pluginSession: sessionHeaders['x-redeven-plugin-session'],
  });
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/external-packages/upload/inspect', ...inspectionResponse });
  if (inspectionResponse.status !== 200) throw new Error(`frozen v1.1.4 inspection failed: ${JSON.stringify(inspectionResponse)}`);
  const inspection = inspectionResponse.body?.data ?? inspectionResponse.body;
  const installResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/external-packages/install', {
    inspection_id: inspection.inspection_id,
    expected_package_sha256: inspection.inspected_hashes.package_sha256,
    activate_after_install: true,
    approved_permission_ids: [...new Set((inspection.security_summary?.permissions ?? []).map((permission) => permission.permission_id))],
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/external-packages/install', ...installResponse });
  if (installResponse.status !== 200) throw new Error(`frozen v1.1.4 install failed: ${JSON.stringify(installResponse)}`);
  return installResponse.body?.data?.plugin?.plugin_instance_id ?? installResponse.body?.plugin?.plugin_instance_id;
}

async function verifyIOSmokeRevoke(page, frame, sessionHeaders, catalog, config, pluginResponses, pluginInstanceID) {
  const plugin = enabledPlugins(catalog).find((candidate) => candidate.plugin_instance_id === pluginInstanceID) ?? enabledPlugins(catalog)[0];
  if (!plugin) throw new Error('v9 I/O revoke smoke requires an enabled plugin');
  const holdPromise = frame.evaluate(() => window.__ioSmokeHold?.()).catch((error) => ({ error: String(error) }));
  const stateURL = `http://127.0.0.1:${config.fixturePorts.http}/state`;
  const activeBefore = await waitFor(async () => {
    const response = await fetch(stateURL);
    const state = await response.json();
    return state.http_active > 0 && state.ws_active > 0 && state.tcp_active > 0 ? state : null;
  }, 30_000, 'v9 hold resource activation');
  const disableResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/disable', {
    plugin_instance_id: plugin.plugin_instance_id,
    expected_management_revision: plugin.management_revision,
    reason: 'user_disabled',
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/disable', ...disableResponse });
  if (disableResponse.status !== 200) throw new Error(`v9 I/O disable failed: ${JSON.stringify(disableResponse)}`);
  const closed = await waitFor(async () => {
    const response = await fetch(stateURL);
    const state = await response.json();
    return state.http_active === 0 && state.ws_active === 0 && state.tcp_active === 0
      && state.http_closed > 0 && state.ws_closed > 0 && state.tcp_closed > 0 ? state : null;
  }, 60_000, 'v9 resource closure after revoke');
  const holdOutcome = await Promise.race([
    holdPromise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 30_000)),
  ]);
  const disabled = await waitFor(async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/catalog/query', {}, sessionHeaders);
    if (response.status !== 200) return null;
    const next = response.body?.data ?? response.body;
    return installedPlugins(next).find((item) => item.plugin_instance_id === plugin.plugin_instance_id && item.enable_state === 'disabled') ?? null;
  }, 30_000, 'v9 disabled state');
  const enableResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/enable', {
    plugin_instance_id: disabled.plugin_instance_id,
    expected_management_revision: disabled.management_revision,
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/enable', ...enableResponse });
  if (enableResponse.status !== 200) throw new Error(`v9 I/O re-enable failed: ${JSON.stringify(enableResponse)}`);
  return {
    disabled: true,
    pending_rpc_rejected: holdOutcome?.timeout !== true
      && (Boolean(holdOutcome?.error) || holdOutcome?.ok === false),
    http_closed: closed.http_closed > activeBefore.http_active,
    websocket_closed: closed.ws_closed > activeBefore.ws_active,
    tcp_closed: closed.tcp_closed > activeBefore.tcp_active,
    revoked_resources: activeBefore.http_active + activeBefore.ws_active + activeBefore.tcp_active,
    active_before: activeBefore,
    closed_state: closed,
    hold_outcome: holdOutcome,
  };
}

async function ensureInitialEnabledPlugin(page, sessionHeaders, config, pluginResponses) {
  const queryCatalog = async () => {
    const response = await requestPluginJSON(
      page,
      '/_redevplugin/api/plugins/catalog/query',
      {},
      sessionHeaders,
    );
    pluginResponses.push({
      method: 'POST',
      pathname: '/_redevplugin/api/plugins/catalog/query',
      ...response,
    });
    return response;
  };
  const before = await queryCatalog();
  if (before.status === 200 && enabledPlugins(before.body?.data ?? before.body).length > 0) {
    return { performed: false, enabledCount: enabledPlugins(before.body?.data ?? before.body).length };
  }
  if (config.mode === 'attach') {
    throw new Error('attached Desktop does not have an enabled plugin; inventory mutation is forbidden');
  }
  if (config.phase !== 'initial') {
    throw new Error('cold restart started without an enabled plugin');
  }

  if (config.ioPackagePath) {
    const installed = await installUploadedSmokePlugin(page, sessionHeaders, config, pluginResponses);
    const frozenPluginInstanceID = await installCompatibilityPackage(page, sessionHeaders, config.frozenPackagePath, pluginResponses);
    const expectedPluginInstanceIDs = [installed.plugin_instance_id, frozenPluginInstanceID];
    if (expectedPluginInstanceIDs.some((pluginInstanceID) => !String(pluginInstanceID ?? '').trim())) {
      throw new Error(`smoke package installation omitted plugin identity: ${JSON.stringify(expectedPluginInstanceIDs)}`);
    }
    const enabled = await waitFor(async () => {
      const response = await queryCatalog();
      if (response.status !== 200) return null;
      const catalog = response.body?.data ?? response.body;
      const active = enabledPlugins(catalog);
      return expectedPluginInstanceIDs.every((pluginInstanceID) => active.some((plugin) => (
        plugin.plugin_instance_id === pluginInstanceID && plugin.action_state?.can_open === true
      ))) ? catalog : null;
    }, 120_000, 'v9 and frozen plugin activation');
    return { ...installed, frozen_plugin_instance_id: frozenPluginInstanceID, enabledCount: enabledPlugins(enabled).length };
  }

  const openCenter = page.locator('[data-plugin-center-market-action]').first();
  await openCenter.waitFor({ state: 'visible', timeout: 30_000 });
  await openCenter.click();
  await waitFor(() => page.locator('[data-plugin-center-view]').count(), 30_000, 'Plugin Center');
  const install = page.locator('[data-plugin-center-install]').first();
  await install.waitFor({ state: 'visible', timeout: 30_000 });
  await install.click();
  const confirm = page.locator('[data-plugin-install-review-confirm]').first();
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  await confirm.click();

  const installed = await waitFor(async () => {
    const response = await queryCatalog();
    if (response.status !== 200) return null;
    const catalog = response.body?.data ?? response.body;
    return installedPlugins(catalog).length > 0 ? catalog : null;
  }, 120_000, 'official plugin installation');
  const enabled = await waitFor(async () => {
    if (enabledPlugins(installed).length > 0) return installed;
    const response = await queryCatalog();
    if (response.status !== 200) return null;
    const catalog = response.body?.data ?? response.body;
    return enabledPlugins(catalog).length > 0 ? catalog : null;
  }, 120_000, 'official plugin activation');
  return { performed: true, enabledCount: enabledPlugins(enabled).length };
}

async function runBrowserSmoke(config) {
  if (config.mode === 'attach') {
    assertAttachSmokeConfiguration(config);
  } else {
    assertIsolatedSmokeConfiguration(config);
  }
  const playwrightRoot = config.playwrightRoot;
  if (!playwrightRoot) throw new Error('plugin smoke requires an explicit task-owned Playwright package root');
  const { chromium } = require(path.join(playwrightRoot, 'playwright'));
  const startedAt = performance.now();
  const browsers = new Set();
  const connectBrowser = async () => {
    const connected = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
    browsers.add(connected);
    return connected;
  };
  const browser = await connectBrowser();
  try {
    await runConnectedBrowserSmoke(config, browser, startedAt, connectBrowser);
  } finally {
    await Promise.all([...browsers].map((connected) => connected.close().catch(() => {})));
  }
}

async function runConnectedBrowserSmoke(config, browser, startedAt, reconnectBrowser) {
  let phase = 'connect';
  const writeFailure = async (error) => {
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-failure.json`), JSON.stringify({
      phase,
      error: String(error),
      commit: config.commit,
    }, null, 2));
  };
  try {
  if (browser.contexts().length === 0) throw new Error('Desktop CDP context is unavailable');
  const initialPage = await waitFor(
    () => browserPages(browser).find((candidate) => !candidate.url().startsWith('devtools://') && candidate.url() !== 'about:blank'),
    30_000,
    'Desktop page',
  );
  const existingEnvPage = browserPages(browser).find(isEnvAppPage) ?? null;
  if (!existingEnvPage) {
    if (config.mode === 'attach') {
      throw new Error('attached Desktop has no open Env App target');
    }
    if (!config.externalLocalUIURL) throw new Error('isolated Desktop smoke requires an external Linux Local UI URL');
    const launcherResult = await initialPage.evaluate(async (url) => {
      if (!window.redevenDesktopLauncher?.performAction) throw new Error('Desktop preload launcher bridge is unavailable');
      return window.redevenDesktopLauncher.performAction({
        kind: 'open_remote_environment',
        external_local_ui_url: url,
        environment_id: 'linux-io-smoke',
        label: 'Linux I/O smoke',
      });
    }, config.externalLocalUIURL);
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-external-open.json`), `${JSON.stringify(launcherResult, null, 2)}\n`);
    if (launcherResult?.ok === false) throw new Error(`external Linux Local UI open failed: ${JSON.stringify(launcherResult)}`);
    browser = await reconnectBrowser();
  }
  let page;
  try {
    page = await waitFor(async () => {
      return browserPages(browser).find(isEnvAppPage) ?? null;
    }, 60_000, 'Env App page');
  } catch (error) {
    const candidates = browserPages(browser).map((candidate) => ({
      url: candidate.url(),
    }));
    await fs.writeFile(
      path.join(config.reportRoot, `${config.phase}-page-targets.json`),
      `${JSON.stringify(candidates, null, 2)}\n`,
    );
    throw error;
  }
  await page.bringToFront();
  if (config.externalLocalUIURL) {
    const accessPassword = page.locator('#redeven-access-password');
    let unlock = { status: 204, unlocked: true };
    if (await accessPassword.count() > 0) {
      await accessPassword.fill('smoke-password');
      const unlockResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/local/access/unlock');
      await page.locator('form button[type="submit"]').click();
      const response = await unlockResponse;
      const body = await responseJSON(response);
      unlock = { status: response.status(), unlocked: body?.data?.unlocked === true };
      await accessPassword.waitFor({ state: 'detached', timeout: 30_000 });
    }
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-external-unlock.json`), `${JSON.stringify(unlock, null, 2)}\n`);
    if (unlock.status !== 200 && unlock.status !== 204) throw new Error(`Linux Local UI unlock failed: ${JSON.stringify(unlock)}`);
  }
  phase = 'surface_reset';
  const existingSurfaceHosts = page.locator('[data-plugin-surface-host]');
  while (await existingSurfaceHosts.count() > 0) {
    const host = existingSurfaceHosts.first();
    const activityWindow = host.locator('xpath=ancestor::*[@data-redeven-plugin-activity-window="true"]').first();
    const close = activityWindow.getByRole('button', { name: /^(?:Close|关闭)$/u }).first();
    await close.click();
    await host.waitFor({ state: 'detached', timeout: 30_000 });
  }
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const pluginResponses = [];
  const pluginIconResponses = [];
  const projectionCheckpoints = [];
  const inventoryDebug = () => page.locator('[data-plugin-inventory-debug]').evaluate((node) => ({
    source: node.getAttribute('data-source'),
    loading: node.getAttribute('data-loading'),
    error: node.getAttribute('data-error'),
    items: Number(node.getAttribute('data-items') ?? 0),
    marketUnavailable: node.getAttribute('data-market-unavailable'),
  })).catch(() => null);
  const pluginRequestHeaders = new Map();
  const pluginRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => void (async () => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/_redevplugin/api/plugins/') || pathname.includes('/_redeven_proxy/api/plugins/market')) {
      const observation = { method: request.method(), pathname };
      if (pathname.endsWith('/plugins/rpc')) {
        const body = request.postDataJSON();
        observation.rpc_plugin_instance_id = body?.plugin_instance_id;
        observation.rpc_method = body?.method;
      }
      pluginRequests.push(observation);
      pluginRequestHeaders.set(pathname, await request.allHeaders());
    }
  })().catch((error) => pageErrors.push(`request observation failed: ${String(error)}`)));
  page.on('response', (response) => void (async () => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400) failedResponses.push({ method: request.method(), pathname, status: response.status() });
    if (pathname.includes('/_redevplugin/api/plugins/') || pathname.includes('/_redeven_proxy/api/plugins/market')) {
      if (/\/_redevplugin\/api\/plugins\/[^/]+\/icon\/[0-9a-f]{64}$/u.test(pathname)) {
        pluginIconResponses.push({
          method: request.method(),
          pathname,
          status: response.status(),
          headers: await response.allHeaders(),
        });
      } else {
        const observation = { method: request.method(), pathname, status: response.status(), body: await responseJSON(response) };
        if (pathname.endsWith('/plugins/rpc')) {
          const requestBody = request.postDataJSON();
          observation.rpc_plugin_instance_id = requestBody?.plugin_instance_id;
          observation.rpc_method = requestBody?.method;
        }
        pluginResponses.push(observation);
      }
    }
  })().catch((error) => pageErrors.push(`response observation failed: ${String(error)}`)));

  const timings = {};
  const mark = (name) => { timings[name] = Number((performance.now() - startedAt).toFixed(1)); };
  phase = 'document_ready';
  await page.waitForLoadState('domcontentloaded');
  mark('document_ready_ms');
  try {
    await waitFor(() => page.locator(PLUGIN_TRIGGER_SELECTOR).count(), 60_000, 'Plugin Panel trigger');
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-shell-failure.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-shell-failure.html`), await page.content()).catch(() => {});
    throw error;
  }
  mark('shell_ready_ms');
  phase = 'panel_open';
  const initialBackdrop = page.locator('[data-plugin-launcher-backdrop]').first();
  if (config.mode === 'attach' && await initialBackdrop.count() > 0) {
    const initialClose = initialBackdrop.locator(
      '[aria-label="Close plugins"], [aria-label="关闭插件"]',
    ).first();
    if (await initialClose.count() > 0) await initialClose.click();
    else await initialBackdrop.click({ position: { x: 2, y: 2 } });
    await initialBackdrop.waitFor({ state: 'detached', timeout: 10_000 });
  }
  const activityMode = page.getByRole('tab', { name: 'Activity', exact: true });
  await activityMode.click();
  await waitFor(() => activityMode.getAttribute('aria-selected').then((selected) => selected === 'true'), 10_000, 'Activity mode');
  const visiblePluginTrigger = () => page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first();
  await visiblePluginTrigger().waitFor({ state: 'visible', timeout: 30_000 });
  if (config.mode === 'attach' && await visiblePluginTrigger().getAttribute('aria-expanded') === 'true') {
    await visiblePluginTrigger().click();
    await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'detached', timeout: 10_000 });
  }
  phase = 'session_inventory_prefetch';
  let inventoryPrefetch;
  try {
    inventoryPrefetch = await waitFor(async () => {
      const debug = await inventoryDebug();
      return debug?.source === 'true' && debug.loading === 'false' && debug.error === 'false' ? debug : null;
    }, 60_000, 'session inventory prefetch');
  } catch (error) {
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-inventory-prefetch-diagnostics.json`), JSON.stringify({
      selectedPageURL: page.url(),
      envAppPageURLs: browserPages(browser).filter(isEnvAppPage).map((candidate) => candidate.url()),
      inventoryDebug: await inventoryDebug(),
      failedResponses,
      consoleErrors,
      pageErrors,
      error: String(error),
    }, null, 2));
    throw error;
  }
  mark('inventory_ready_ms');
  const sessionHeaders = await waitFor(() => {
    for (const headers of pluginRequestHeaders.values()) {
      if (headers['x-redeven-plugin-session'] && headers['x-redevplugin-csrf']) return headers;
    }
    return null;
  }, 30_000, 'plugin session credential');
  phase = 'panel_open';
  const firstPanelOpenStartedAt = performance.now();
  await visiblePluginTrigger().click();
  await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'visible', timeout: 10_000 });
  const firstPanelOpenMS = Number((performance.now() - firstPanelOpenStartedAt).toFixed(1));
  phase = 'plugin_bootstrap';
  let bootstrap;
  try {
    bootstrap = await ensureInitialEnabledPlugin(page, sessionHeaders, config, pluginResponses);
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-bootstrap-failure.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-bootstrap-failure.html`), await page.content()).catch(() => {});
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-bootstrap-diagnostics.json`), JSON.stringify({
      inventoryDebug: await inventoryDebug(),
      pluginResponses,
      pluginRequests,
      failedResponses,
      consoleErrors,
      pageErrors,
      error: String(error),
    }, null, 2)).catch(() => {});
    throw error;
  }
  if (bootstrap.performed) {
    const pluginCenter = page.locator('[data-plugin-center-view]');
    if (config.ioPackagePath) {
      try {
        if (!await pluginCenter.isVisible().catch(() => false)) {
          await page.locator('[data-plugin-launcher-backdrop] [data-plugin-center-market-action]').click();
          await pluginCenter.waitFor({ state: 'visible', timeout: 10_000 });
        }
        await page.locator('[data-plugin-center-refresh]').click();
        await waitFor(async () => {
          const debug = await inventoryDebug();
          return debug?.loading === 'false' && debug.items === bootstrap.enabledCount ? debug : null;
        }, 30_000, 'Plugin Center projection after direct smoke install');
      } catch (error) {
        await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-direct-install-projection-failure.png`), fullPage: true }).catch(() => {});
        await fs.writeFile(path.join(config.reportRoot, `${config.phase}-direct-install-projection-failure.html`), await page.content()).catch(() => {});
        await fs.writeFile(path.join(config.reportRoot, `${config.phase}-direct-install-projection-diagnostics.json`), JSON.stringify({
          expectedEnabledCount: bootstrap.enabledCount,
          inventoryDebug: await inventoryDebug(),
          pluginCenterVisible: await pluginCenter.isVisible().catch(() => false),
          pluginResponses,
          pluginRequests,
          failedResponses,
          consoleErrors,
          pageErrors,
          error: String(error),
        }, null, 2)).catch(() => {});
        throw error;
      }
    }
    try {
      if (await pluginCenter.isVisible().catch(() => false)) {
        await page.locator('[data-plugin-center-close]').click();
        await pluginCenter.waitFor({ state: 'hidden', timeout: 10_000 });
      }
    } catch (error) {
      await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-plugin-center-close-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-plugin-center-close-failure.html`), await page.content()).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-plugin-center-close-diagnostics.json`), JSON.stringify({
        pluginCenterCount: await pluginCenter.count(),
        pluginCenterVisible: await pluginCenter.isVisible().catch(() => false),
        toolbarButtons: await page.locator('[data-plugin-center-toolbar-primary] button').evaluateAll((buttons) => buttons.map((button) => ({
          ariaLabel: button.getAttribute('aria-label'),
          disabled: button.hasAttribute('disabled'),
        }))),
        activityPluginTriggers: await page.locator('[aria-controls="redeven-plugin-switcher"]').evaluateAll((triggers) => triggers.map((trigger) => ({
          ariaExpanded: trigger.getAttribute('aria-expanded'),
          ariaPressed: trigger.getAttribute('aria-pressed'),
          visible: Boolean(trigger.getClientRects().length),
        }))),
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
    const activityPluginTrigger = page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first();
    const pluginPanelBackdrop = page.locator('[data-plugin-launcher-backdrop]').first();
    try {
      if (!await pluginPanelBackdrop.isVisible().catch(() => false)) {
        await activityPluginTrigger.waitFor({ state: 'visible', timeout: 10_000 });
        await activityPluginTrigger.click();
      }
      await pluginPanelBackdrop.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-panel-after-install-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-after-install-failure.html`), await page.content()).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-after-install-diagnostics.json`), JSON.stringify({
        trigger: await activityPluginTrigger.evaluate((node) => ({
          ariaExpanded: node.getAttribute('aria-expanded'),
          ariaPressed: node.getAttribute('aria-pressed'),
          className: node.getAttribute('class'),
        })).catch(() => null),
        backdropCount: await page.locator('[data-plugin-launcher-backdrop]').count(),
        backdropVisible: await pluginPanelBackdrop.isVisible().catch(() => false),
        motionStates: await page.locator('[data-plugin-panel-motion-state]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-plugin-panel-motion-state'))),
        workbenchSelected: await page.getByRole('tab', { name: 'Workbench', exact: true }).getAttribute('aria-selected'),
        inventoryDebug: await inventoryDebug(),
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
  }
  phase = 'panel_close_reopen';
  const panelDismissal = {};
  const closePanel = page.locator('[data-plugin-launcher-backdrop] [aria-label="Close plugins"], [data-plugin-launcher-backdrop] [aria-label="关闭插件"]').first();
  await closePanel.click();
  try {
    await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'detached', timeout: 10_000 });
  } catch (error) {
    const backdrops = page.locator('[data-plugin-launcher-backdrop]');
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-close-diagnostics.json`), JSON.stringify({
      trigger: await visiblePluginTrigger().evaluate((node) => ({
        ariaExpanded: node.getAttribute('aria-expanded'),
        ariaPressed: node.getAttribute('aria-pressed'),
      })).catch(() => null),
      backdrops: await Promise.all(Array.from({ length: await backdrops.count() }, async (_, index) => {
        const backdrop = backdrops.nth(index);
        const dialog = backdrop.locator('[role="dialog"]');
        return {
          visible: await backdrop.isVisible(),
          motionState: await dialog.getAttribute('data-plugin-panel-motion-state'),
          ariaModal: await dialog.getAttribute('aria-modal'),
          text: (await dialog.innerText().catch(() => '')).slice(0, 500),
        };
      })),
      inventoryDebug: await inventoryDebug(),
      error: String(error),
    }, null, 2)).catch(() => {});
    throw error;
  }
  panelDismissal.close_button = { closed: true, backdrop_count: 0 };
  await visiblePluginTrigger().click();
  await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'detached', timeout: 10_000 });
  panelDismissal.escape = { closed: true, backdrop_count: 0 };
  await visiblePluginTrigger().click();
  const backdrop = page.locator('[data-plugin-launcher-backdrop]').first();
  await backdrop.waitFor({ state: 'visible', timeout: 10_000 });
  await backdrop.click({ position: { x: 2, y: 2 } });
  await backdrop.waitFor({ state: 'detached', timeout: 10_000 });
  panelDismissal.backdrop = { closed: true, backdrop_count: 0 };
  const catalogQueryCount = () => pluginRequests.filter(
    (request) => request.pathname.endsWith('/plugins/catalog/query'),
  ).length;
  const catalogQueryCountBefore = catalogQueryCount();
  const panelReopenCycles = [];
  let expectedTileKeys = null;
  for (let index = 0; index < 5; index += 1) {
    const openStartedAt = performance.now();
    await visiblePluginTrigger().click();
    const reopenedBackdrop = page.locator('[data-plugin-launcher-backdrop]').first();
    await reopenedBackdrop.waitFor({ state: 'visible', timeout: 10_000 });
    const openDurationMS = Number((performance.now() - openStartedAt).toFixed(1));
    const installedTiles = reopenedBackdrop.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])');
    try {
      await waitFor(async () => (
        await installedTiles.count() === bootstrap.enabledCount ? true : null
      ), 10_000, `Plugin Panel inventory on reopen ${index + 1}`);
    } catch (error) {
      await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-panel-reopen-${index + 1}-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-reopen-${index + 1}-failure.html`), await page.content()).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-reopen-${index + 1}-diagnostics.json`), JSON.stringify({
        cycle: index + 1,
        expectedEnabledCount: bootstrap.enabledCount,
        installedTileCount: await installedTiles.count(),
        tileKeys: await installedTiles.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-plugin-panel-tile'))),
        panelText: (await reopenedBackdrop.innerText().catch(() => '')).slice(0, 4000),
        inventoryDebug: await inventoryDebug(),
        pluginResponses,
        pluginRequests,
        failedResponses,
        consoleErrors,
        pageErrors,
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
    const panelText = await reopenedBackdrop.innerText();
    if (/Loading plugins|正在加载插件/u.test(panelText)) {
      throw new Error(`Plugin Panel exposed a loading banner on reopen ${index + 1}`);
    }
    const tileKeys = await installedTiles.evaluateAll((tiles) => tiles.map(
      (tile) => tile.getAttribute('data-plugin-panel-tile'),
    ));
    const tileOpacities = await installedTiles.evaluateAll((tiles) => tiles.map(
      (tile) => getComputedStyle(tile).opacity,
    ));
    if (tileOpacities.some((opacity) => opacity === '0')) {
      throw new Error(`Plugin Panel hid an installed tile on reopen ${index + 1}`);
    }
    if (expectedTileKeys && JSON.stringify(tileKeys) !== JSON.stringify(expectedTileKeys)) {
      throw new Error(`Plugin Panel inventory changed across reopen ${index + 1}`);
    }
    expectedTileKeys ??= tileKeys;
    panelReopenCycles.push({
      cycle: index + 1,
      open_duration_ms: openDurationMS,
      tile_keys: tileKeys,
      loading_text_visible: false,
      tile_opacities: tileOpacities,
    });
    if (index < 4) {
      const cycleClose = reopenedBackdrop.locator(
        '[aria-label="Close plugins"], [aria-label="关闭插件"]',
      ).first();
      await cycleClose.click();
      await reopenedBackdrop.waitFor({ state: 'detached', timeout: 10_000 });
    }
  }
  const catalogQueryCountAfter = catalogQueryCount();
  if (catalogQueryCountAfter !== catalogQueryCountBefore) {
    throw new Error(`Plugin Panel reopen triggered inventory refresh: ${catalogQueryCountBefore} -> ${catalogQueryCountAfter}`);
  }
  const inventoryRefreshCount = catalogQueryCountAfter - catalogQueryCountBefore;
  const finalBackdrop = page.locator('[data-plugin-launcher-backdrop]').first();
  await finalBackdrop.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-view]').waitFor({ state: 'visible', timeout: 10_000 });
  let releaseDelayedCatalogRequest;
  let delayedCatalogRequestIntercepted = false;
  const delayedCatalogRequestGate = new Promise((resolve) => {
    releaseDelayedCatalogRequest = resolve;
  });
  await page.route('**/_redevplugin/api/plugins/catalog/query', async (route) => {
    delayedCatalogRequestIntercepted = true;
    await delayedCatalogRequestGate;
    await route.continue();
  }, { times: 1 });
  await page.locator('[data-plugin-center-refresh]').click();
  await waitFor(
    () => delayedCatalogRequestIntercepted,
    10_000,
    'delayed background inventory refresh',
  );
  await waitFor(async () => (
    (await inventoryDebug())?.loading === 'true' ? true : null
  ), 10_000, 'background refresh pending');
  let backgroundRefreshTileKeys;
  try {
    await visiblePluginTrigger().click();
    const pendingRefreshBackdrop = page.locator('[data-plugin-launcher-backdrop]').first();
    await pendingRefreshBackdrop.waitFor({ state: 'visible', timeout: 10_000 });
    const pendingRefreshTiles = pendingRefreshBackdrop.locator(
      '[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])',
    );
    await waitFor(async () => (
      await pendingRefreshTiles.count() === bootstrap.enabledCount ? true : null
    ), 10_000, 'Plugin Panel snapshot during background refresh');
    const pendingRefreshText = await pendingRefreshBackdrop.innerText();
    if (/Loading plugins|正在加载插件/u.test(pendingRefreshText)) {
      throw new Error('Plugin Panel exposed a loading banner during a background refresh');
    }
    backgroundRefreshTileKeys = await pendingRefreshTiles.evaluateAll((tiles) => tiles.map(
      (tile) => tile.getAttribute('data-plugin-panel-tile'),
    ));
  } finally {
    releaseDelayedCatalogRequest();
  }
  await waitFor(async () => (
    (await inventoryDebug())?.loading === 'false' ? true : null
  ), 30_000, 'background inventory refresh completion');
  const backgroundRefreshEvidence = {
    delayed: true,
    snapshot_visible_while_pending: true,
    loading_text_visible: false,
    background_refresh_tile_keys: backgroundRefreshTileKeys,
  };
  panelDismissal.final_reopen = { open: true, backdrop_count: 1, cycles: 5 };
  mark('panel_ready_ms');

  phase = 'inventory';
  const recoveryResponse = await waitFor(async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/runtime/recover-enabled', {}, sessionHeaders);
    return response.status === 200 ? response : null;
  }, 30_000, 'recover-enabled response');
  const recoveryEntry = { method: 'POST', pathname: '/_redevplugin/api/plugins/runtime/recover-enabled', ...recoveryResponse };
  pluginResponses.push(recoveryEntry);
  const catalogResponse = await waitFor(async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/catalog/query', {}, sessionHeaders);
    return response.status === 200 ? response : null;
  }, 30_000, 'plugin catalog response');
  const catalogEntry = { method: 'POST', pathname: '/_redevplugin/api/plugins/catalog/query', ...catalogResponse };
  pluginResponses.push(catalogEntry);
  projectionCheckpoints.push({
    label: 'after_catalog_replay',
    panelTiles: await page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])').count(),
    panelText: (await page.locator('[data-plugin-launcher-grid]').innerText().catch(() => '')).slice(0, 4000),
    inventoryDebug: await inventoryDebug(),
  });
  const recovery = recoveryEntry.body;
  const catalog = catalogEntry.body?.data ?? catalogEntry.body;
  const enabledCount = Array.isArray(catalog?.plugins)
    ? catalog.plugins.filter((plugin) => plugin?.enable_state === 'enabled').length
    : 0;
  await fs.writeFile(path.join(config.reportRoot, `${config.phase}-catalog-checkpoint.json`), JSON.stringify({
    recovery,
    catalog,
    enabledCount,
    panelTiles: await page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])').count(),
    panelText: (await page.locator('[data-plugin-launcher-grid]').innerText().catch(() => '')).slice(0, 4000),
  }, null, 2));
  let panelInstalledCount;
  try {
    panelInstalledCount = await waitFor(async () => {
      const count = await page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])').count();
      return count === enabledCount ? count : null;
    }, 30_000, 'Plugin Panel inventory projection');
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-projection-failure.png`), fullPage: true });
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-projection-failure.html`), await page.content());
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-projection-diagnostics.json`), JSON.stringify({
      recovery,
      catalog,
      enabledCount,
      panelTiles: await page.locator('[data-plugin-panel-tile]').count(),
      panelText: (await page.locator('[data-plugin-launcher-grid]').innerText().catch(() => '')).slice(0, 4000),
      inventoryDebug: await inventoryDebug(),
      pluginResponses,
      pluginRequests,
      failedResponses,
      projectionCheckpoints,
      consoleErrors,
      pageErrors,
      error: String(error),
    }, null, 2));
    throw error;
  }

  let surface = { ready: false };
  let rpc = { ok: false };
  const inventoryAssessment = assessPluginSmoke({
    recovery,
    catalog,
    panelInstalledCount,
    surface: { ready: true },
    rpc: { ok: true },
  });
  if (inventoryAssessment.ok && enabledCount > 0) {
    const firstTile = config.ioPackagePath
      ? page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])').filter({ hasText: 'I/O smoke' }).first()
      : page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])').first();
    const icon = await firstTile.locator('img').evaluateAll((images) => images.map((candidate) => {
      const image = candidate;
      return {
        src: image.getAttribute('src'),
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    }));
    const iconFallbackCount = await firstTile.locator('svg').count();
    const iconRoute = pluginIconResponses.find((entry) => entry.status === 200);
    if (icon.length !== 1 || !icon[0]?.src?.startsWith('blob:') || !icon[0].complete
      || icon[0].naturalWidth <= 0 || iconFallbackCount !== 0 || !iconRoute) {
      throw new Error(`installed plugin icon is not locally preloaded: ${JSON.stringify({ icon, iconFallbackCount, pluginIconResponses })}`);
    }
    const iconEvidence = { image: icon[0], fallback_count: iconFallbackCount, route: iconRoute };
    const tileBeforeOpen = {
      key: await firstTile.getAttribute('data-plugin-panel-tile'),
      text: (await firstTile.innerText()).trim(),
      describedBy: await firstTile.getAttribute('aria-describedby'),
    };
    await firstTile.click();
    let frame;
    try {
      const iframe = page.locator('[data-plugin-surface-iframe]').first();
      await iframe.waitFor({ state: 'visible', timeout: 30_000 });
      const iframeHandle = await iframe.elementHandle();
      frame = await iframeHandle?.contentFrame();
      if (!frame) throw new Error('plugin surface iframe has no content frame');
    } catch (error) {
      await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-surface-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-surface-failure.html`), await page.content()).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-surface-diagnostics.json`), JSON.stringify({
        tileBeforeOpen,
        url: page.url(),
        surfaceHosts: await page.locator('[data-plugin-surface-host]').count(),
        surfaceErrors: await page.locator('[data-plugin-surface-error]').allInnerTexts(),
        panelText: (await page.locator('[data-plugin-launcher-grid]').innerText().catch(() => '')).slice(0, 4_000),
        bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 8_000),
        inventoryDebug: await inventoryDebug(),
        pluginResponses,
        pluginRequests,
        failedResponses,
        consoleErrors,
        pageErrors,
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
    await waitFor(async () => (await frame.locator('body').innerText()).trim().length > 0, 30_000, 'plugin iframe body');
    surface = { ready: true, url: frame.url(), body: (await frame.locator('body').innerText()).slice(0, 2_000) };
    const v9Plugin = installedPlugins(catalog).find((candidate) => candidate.plugin_id === 'dev.redeven.smoke.io');
    const rpcEntry = await waitFor(
      () => pluginResponses.find((entry) => entry.pathname.endsWith('/plugins/rpc') && entry.status === 200
        && entry.rpc_plugin_instance_id === v9Plugin?.plugin_instance_id && entry.rpc_method === 'smoke.run'),
      30_000,
      'plugin RPC',
    );
    rpc = { ok: true, method: rpcEntry.body?.data?.method ?? 'observed_plugin_rpc', result: rpcEntry.body };
    surface.icon = iconEvidence;
    mark('surface_ready_ms');
  }

  const assessment = assessPluginSmoke({ recovery, catalog, panelInstalledCount, surface, rpc });
  let disabledUpdateIntent = null;
  if (config.mode !== 'attach' && config.phase === 'initial' && config.ioPackagePath) {
    phase = 'disabled_revoke';
    const v9Plugin = installedPlugins(catalog).find((candidate) => candidate.plugin_id === 'dev.redeven.smoke.io');
    disabledUpdateIntent = await verifyIOSmokeRevoke(page, frame, sessionHeaders, catalog, config, pluginResponses, v9Plugin?.plugin_instance_id);
  } else if (config.mode !== 'attach' && config.phase === 'initial') {
    phase = 'disabled_update_intent';
    disabledUpdateIntent = await verifyDisabledUpdateIntent(page, sessionHeaders, catalog, pluginResponses);
  }
  let ioEvidence = null;
  if (config.ioPackagePath) {
    const workerResult = rpc.result?.data ?? rpc.result?.result ?? rpc.result ?? {};
    const frozenBytes = await fs.readFile(config.frozenPackagePath);
    const frozenObservedHash = createHash('sha256').update(frozenBytes).digest('hex');
    const frozenSums = await fs.readFile(config.frozenSHA256SumsPath, 'utf8');
    const frozenExpectedHash = frozenSums.split('\n').map((line) => line.trim().split(/\s+/u))
      .find(([, name]) => name === 'worker.redevplugin')?.[0];
    if (!/^[0-9a-f]{64}$/u.test(String(frozenExpectedHash ?? ''))) {
      throw new Error('frozen v1.1.4 SHA256SUMS does not contain worker.redevplugin');
    }
    const initialEvidence = config.phase === 'cold_restart' && config.initialOutput
      ? JSON.parse(await fs.readFile(config.initialOutput, 'utf8')).io_evidence
      : null;
    const frozenPluginInstanceID = bootstrap.frozen_plugin_instance_id
      ?? initialEvidence?.frozen_v1_1_4?.plugin_instance_id;
    ioEvidence = {
      linux_target: {
        os: config.linuxTarget?.os,
        arch: config.linuxTarget?.arch,
        container_id: config.linuxTarget?.container_id,
        commit: config.commit,
        runtime_pid: config.linuxTarget?.runtime_pid,
        previous_runtime_pid: config.linuxTarget?.previous_runtime_pid,
        local_ui_pid: config.linuxTarget?.local_ui_pid ?? config.linuxTarget?.runtime_pid,
        state_root: config.linuxTarget?.state_root,
      },
      v9: {
        manifest_schema: workerResult.manifest ?? workerResult.schema_version,
        enabled_after_install: bootstrap.enabledCount > 0,
        fs: workerResult.fs,
        http: workerResult.http,
        websocket: workerResult.websocket,
        tcp: workerResult.tcp,
        udp: workerResult.udp,
      },
      frozen_v1_1_4: {
        package: 'worker.redevplugin',
        plugin_instance_id: frozenPluginInstanceID,
        expected_sha256: frozenExpectedHash,
        observed_sha256: frozenObservedHash,
        rpc_ok: false,
      },
      revoke: disabledUpdateIntent,
      cold_restart: config.phase === 'cold_restart' ? {
        runtime_restarted: true,
        state_root_reused: config.linuxTarget?.state_root === initialEvidence?.linux_target?.state_root,
        enabled_after_restart: bootstrap.enabledCount > 0,
      } : null,
    };
    const frozenPlugin = installedPlugins(catalog).find((candidate) => candidate.plugin_instance_id === frozenPluginInstanceID);
    const surfaceHost = page.locator('[data-plugin-surface-host]').first();
    if (await surfaceHost.count() > 0) {
      const closeSurface = surfaceHost.locator('xpath=ancestor::*[@data-redeven-plugin-activity-window="true"]').getByRole('button', { name: /^(?:Close|关闭)$/u }).first();
      if (await closeSurface.count() > 0) await closeSurface.click();
    }
    const frozenTile = page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])')
      .filter({ hasText: frozenPlugin?.display_name ?? 'worker' }).first();
    if (await frozenTile.count() > 0) {
      const frozenRPCStart = pluginResponses.length;
      await frozenTile.click();
      const frozenFrame = await waitFor(async () => {
        const iframe = page.locator('[data-plugin-surface-iframe]').first();
        if (await iframe.count() === 0) return null;
        const handle = await iframe.elementHandle();
        return handle?.contentFrame() ?? null;
      }, 30_000, 'frozen v1.1.4 surface');
      await waitFor(async () => (await frozenFrame.locator('body').innerText()).trim().length > 0, 30_000, 'frozen v1.1.4 surface body');
      const frozenRPC = await waitFor(() => pluginResponses.slice(frozenRPCStart).find((entry) => (
        entry.pathname.endsWith('/plugins/rpc') && entry.status === 200
        && entry.rpc_plugin_instance_id === frozenPluginInstanceID
      )), 30_000, 'frozen v1.1.4 RPC');
      ioEvidence.frozen_v1_1_4.rpc_ok = Boolean(frozenRPC);
      ioEvidence.frozen_v1_1_4.rpc_method = frozenRPC.rpc_method;
      ioEvidence.frozen_v1_1_4.surface_opened = true;
    } else {
      throw new Error(`frozen v1.1.4 tile is not visible: ${frozenPlugin?.plugin_instance_id ?? 'unknown'}`);
    }
    assertExtensionIOEvidence(ioEvidence, {
      requireRevoke: config.phase === 'initial',
      requireColdRestart: config.phase === 'cold_restart',
    });
  }
  const summary = {
    schema_version: 1,
    mode: config.mode ?? 'isolated',
    phase: config.phase,
    commit: config.commit,
    running_commit: config.runningCommit ?? config.commit,
    runtime_commit: config.runtimeCommit ?? null,
    running_root: config.runningRoot ?? null,
    dependencies: config.dependencies,
    roots: {
      root: config.root,
      state: config.stateRoot,
      runtime: path.join(config.stateRoot, 'local-environment'),
      user_data: config.userDataRoot,
      cache: config.cacheRoot,
      temp: config.tempRoot,
      report: config.reportRoot,
    },
    ports: { local_ui: config.localUIPort, cdp: config.cdpPort, inspector: config.inspectorPort },
    owner_id: config.ownerID,
    pids: config.pids,
    timings,
    inventory_prefetch: {
      completed_before_first_open: true,
      debug: inventoryPrefetch,
      first_open_ms: firstPanelOpenMS,
    },
    bootstrap,
    recovery,
    catalog,
    panel: {
      installed_count: panelInstalledCount,
      needs_attention: await page.locator('[data-plugin-runtime-recovery]').count(),
      dismissal: panelDismissal,
      reopen_cycles: panelReopenCycles,
      inventory_catalog_query_count_before: catalogQueryCountBefore,
      inventory_catalog_query_count_after: catalogQueryCountAfter,
      inventory_refresh_count: inventoryRefreshCount,
      background_refresh: backgroundRefreshEvidence,
      icon_responses: pluginIconResponses,
    },
    surface,
    rpc,
    disabled_update_intent: disabledUpdateIntent,
    io_evidence: ioEvidence,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    failed_responses: failedResponses,
    result: assessment,
  };
  await fs.writeFile(config.output, `${JSON.stringify(summary, null, 2)}\n`);
  if (!assessment.ok) {
    await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-failure.png`), fullPage: true });
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-failure.html`), await page.content());
    throw new Error(`plugin smoke failed: ${assessment.failure}`);
  }
  } catch (error) {
    await writeFailure(error);
    throw error;
  }
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('usage: smoke_desktop_plugins.mjs <config.json>');
  await runBrowserSmoke(JSON.parse(await fs.readFile(configPath, 'utf8')));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
