import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    || !path.isAbsolute(String(config.stateRoot ?? ''))) {
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
    || target.runtime_pid === target.local_ui_pid
    || !String(target.state_root ?? '').startsWith('/')) {
    throw new Error('Linux target provenance is incomplete');
  }
  const v9 = evidence?.v9;
  if (v9?.manifest_schema !== 'redevplugin.manifest.v9' || v9.enabled_after_install !== true) {
    throw new Error('v9 install evidence is incomplete');
  }
  if (!Number.isInteger(v9.fs?.bytes) || v9.fs.bytes < 64 * 1024 * 1024
    || !/^[0-9a-f]{64}$/u.test(String(v9.fs.sha256 ?? ''))
    || v9.fs.sha256 !== v9.fs.expected_sha256
    || ['list', 'stat', 'rename', 'watch', 'remove'].some((key) => v9.fs[key] !== true)) {
    throw new Error('v9 FS streaming/list/stat/rename/watch/remove evidence is incomplete');
  }
  if (!Number.isInteger(v9.http?.download_bytes) || v9.http.download_bytes < 64 * 1024 * 1024
    || !Number.isInteger(v9.http?.upload_bytes) || v9.http.upload_bytes < 64 * 1024 * 1024
    || !/^[0-9a-f]{64}$/u.test(String(v9.http.sha256 ?? ''))) {
    throw new Error('v9 HTTP streaming evidence is incomplete');
  }
  if (v9.http.request_bytes !== 1024 * 1024 || v9.http.requests_per_direction !== 64
    || v9.http.upload_limit_enforced !== true || v9.http.download_limit_enforced !== true) {
    throw new Error('v9 bounded HTTP request and quota evidence is incomplete');
  }
  if (!Number.isInteger(v9.websocket?.messages) || v9.websocket.messages < 100) throw new Error('v9 WebSocket evidence is incomplete');
  if (!Number.isInteger(v9.tcp?.exchanges) || v9.tcp.exchanges < 100) throw new Error('v9 TCP evidence is incomplete');
  if (!Number.isInteger(v9.udp?.datagrams) || v9.udp.datagrams < 100) throw new Error('v9 UDP evidence is incomplete');
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

export function isEnvAppPage(page, targetURL) {
  try {
    if (targetURL && new URL(page.url()).origin !== new URL(targetURL).origin) return false;
    return new URL(page.url()).pathname.startsWith('/_redeven_proxy/env/');
  } catch {
    return false;
  }
}

export function workerResultFromRPCResponse(response) {
  const workerResult = response?.ok === true ? response.data?.data : null;
  if (!workerResult || typeof workerResult !== 'object' || Array.isArray(workerResult)) {
    throw new Error('plugin RPC response is missing worker data');
  }
  return workerResult;
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

function successfulPluginResponse(response, operation) {
  if (response?.status !== 200 || response?.body?.ok !== true) {
    throw new Error(`${operation} failed: ${JSON.stringify(response)}`);
  }
  return response.body.data;
}

function runtimeTargetFromDescriptor(descriptor) {
  const artifact = descriptor?.artifact_identity ?? descriptor;
  const match = /^(linux)\/(amd64|arm64)$/u.exec(String(artifact?.target ?? ''));
  if (!match) throw new Error('plugin runtime descriptor does not expose a supported Linux target');
  return { os: match[1], arch: match[2] };
}

export function runtimePIDFromHealth(health) {
  const readyShards = Array.isArray(health?.shards) ? health.shards.filter((shard) => shard?.ready === true) : [];
  if (health?.ready !== true || readyShards.length !== 1) {
    throw new Error('plugin runtime health does not expose one ready runtime process identity');
  }
  const match = /^runtime_([1-9][0-9]*)$/u.exec(String(readyShards[0].runtime_instance_id ?? ''));
  const pid = Number(match?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error('plugin runtime process identity is invalid');
  }
  return pid;
}

export async function ensureEnabledWorkerRuntime({ request, plugins }) {
  if (typeof request !== 'function') throw new Error('plugin runtime request adapter is required');
  const workerPlugins = installedPlugins({ plugins }).filter((plugin) => (
    plugin?.enable_state === 'enabled' && Array.isArray(plugin?.manifest?.workers) && plugin.manifest.workers.length > 0
  ));
  if (workerPlugins.length === 0) return { runtimePID: null, started: false, retries: [], health: null };

  const featuresResponse = await request('/_redevplugin/api/plugins/features/query', {});
  const features = successfulPluginResponse(featuresResponse, 'plugin feature query');
  if (!Array.isArray(features) || !features.includes('runtime')) {
    throw new Error('enabled worker plugins require the configured runtime feature');
  }

  const initialHealthResponse = await request('/_redevplugin/api/plugins/runtime/health/query', {});
  let health = successfulPluginResponse(initialHealthResponse, 'plugin runtime health query');
  let startResponse = null;
  if (health?.ready !== true) {
    startResponse = await request('/_redevplugin/api/plugins/runtime/start', {
      target: runtimeTargetFromDescriptor(health),
    });
    health = successfulPluginResponse(startResponse, 'plugin runtime start');
  }

  const retries = [];
  for (const plugin of workerPlugins) {
    const response = await request('/_redevplugin/api/plugins/runtime/recover/retry', {
      plugin_instance_id: plugin.plugin_instance_id,
    });
    const result = successfulPluginResponse(response, `plugin runtime recovery for ${plugin.plugin_instance_id}`);
    if (result?.status !== 'ready') {
      throw new Error(`plugin runtime recovery failed for ${plugin.plugin_instance_id}: ${JSON.stringify(result)}`);
    }
    retries.push({ plugin_instance_id: plugin.plugin_instance_id, status: result.status });
  }

  const finalHealthResponse = await request('/_redevplugin/api/plugins/runtime/health/query', {});
  health = successfulPluginResponse(finalHealthResponse, 'plugin runtime health verification');
  return {
    runtimePID: runtimePIDFromHealth(health),
    started: startResponse !== null,
    retries,
    health,
  };
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
      plugin.plugin_instance_id === initiallyEnabled.plugin_instance_id && plugin.enable_state === 'disabled_by_user'
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
    return plugin?.enable_state === 'disabled_by_user' && plugin.management_revision > disabled.management_revision ? catalog : null;
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
  const installResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/external-packages/install', {
    inspection_id: inspection.inspection_id,
    expected_package_sha256: inspection.inspected_hashes.package_sha256,
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/external-packages/install', ...installResponse });
  if (installResponse.status !== 200) throw new Error(`I/O package install failed: ${JSON.stringify(installResponse)}`);
  return {
    performed: true,
    enabledCount: 1,
    package_sha256: inspection.inspected_hashes.package_sha256,
    plugin_instance_id: installResponse.body?.data?.plugin?.plugin_instance_id ?? installResponse.body?.plugin?.plugin_instance_id,
  };
}

async function verifyIOSmokeRevoke(page, frame, sessionHeaders, catalog, config, pluginResponses, pluginInstanceID, guestOutcomes) {
  const plugin = enabledPlugins(catalog).find((candidate) => candidate.plugin_instance_id === pluginInstanceID) ?? enabledPlugins(catalog)[0];
  if (!plugin) throw new Error('v9 I/O revoke smoke requires an enabled plugin');
  const holdRPCStart = guestOutcomes.length;
  const holdButton = frame.locator('[data-redevplugin-action="hold-smoke"]');
  await holdButton.waitFor({ state: 'visible', timeout: 30_000 });
  await holdButton.click();
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
  const holdOutcome = await waitFor(() => guestOutcomes.slice(holdRPCStart).find((entry) =>
    entry.method === 'smoke.hold') ?? null, 30_000, 'v9 hold RPC revocation');
  const disabled = await waitFor(async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/catalog/query', {}, sessionHeaders);
    if (response.status !== 200) return null;
    const next = response.body?.data ?? response.body;
    return installedPlugins(next).find((item) => item.plugin_instance_id === plugin.plugin_instance_id && item.enable_state === 'disabled_by_user') ?? null;
  }, 30_000, 'v9 disabled state');
  const enableResponse = await requestPluginJSON(page, '/_redevplugin/api/plugins/enable', {
    plugin_instance_id: disabled.plugin_instance_id,
    expected_management_revision: disabled.management_revision,
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/enable', ...enableResponse });
  if (enableResponse.status !== 200) throw new Error(`v9 I/O re-enable failed: ${JSON.stringify(enableResponse)}`);
  await approveSmokeConnections(page, sessionHeaders, config, pluginResponses, plugin.plugin_instance_id);
  return {
    disabled: true,
    pending_rpc_rejected: holdOutcome.ok === false,
    http_closed: closed.http_closed > activeBefore.http_active,
    websocket_closed: closed.ws_closed > activeBefore.ws_active,
    tcp_closed: closed.tcp_closed > activeBefore.tcp_active,
    revoked_resources: activeBefore.http_active + activeBefore.ws_active + activeBefore.tcp_active,
    active_before: activeBefore,
    closed_state: closed,
    hold_outcome: holdOutcome,
  };
}

async function verifyUninstall(page, sessionHeaders, catalog, pluginResponses) {
  const plugin = installedPlugins(catalog).find((candidate) => candidate.plugin_id === 'dev.redeven.smoke.io');
  if (!plugin) throw new Error('v9 uninstall smoke requires the installed I/O plugin');
  const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/uninstall', {
    plugin_instance_id: plugin.plugin_instance_id,
    expected_management_revision: plugin.management_revision,
    delete_data: true,
  }, sessionHeaders);
  pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/uninstall', ...response });
  if (response.status !== 200 || response.body?.ok !== true) {
    throw new Error(`v9 I/O uninstall failed: ${JSON.stringify(response)}`);
  }
  await waitFor(async () => {
    const next = await requestPluginJSON(page, '/_redevplugin/api/plugins/catalog/query', {}, sessionHeaders);
    if (next.status !== 200) return null;
    const nextCatalog = next.body?.data ?? next.body;
    return installedPlugins(nextCatalog).some((candidate) => candidate.plugin_instance_id === plugin.plugin_instance_id)
      ? null
      : true;
  }, 30_000, 'v9 plugin removal after uninstall');
  return {
    plugin_instance_id: plugin.plugin_instance_id,
    delete_data: true,
    removed_from_catalog: true,
  };
}

async function approveSmokeConnections(page, sessionHeaders, config, pluginResponses, pluginInstanceID) {
  const listed = successfulPluginResponse(await requestPluginJSON(page,
    '/_redevplugin/api/plugins/connections/query', { plugin_instance_id: pluginInstanceID }, sessionHeaders), 'list smoke connections');
  const revisions = new Map((listed.connections ?? []).map((item) => [item.connector_id, item.revision]));
    // Use the released two-step connection contract. No fixed loopback target
    // is admitted from package metadata, and no permission is inferred.
    for (const [connector, scheme, port] of [
      ['http', 'http', config.fixturePorts.http], ['ws', 'ws', config.fixturePorts.ws],
      ['tcp', 'tcp', config.fixturePorts.tcp], ['udp', 'udp', config.fixturePorts.udp],
    ]) {
      const request = async (operation, body) => {
        const pathname = '/_redevplugin/api/plugins/connections/' + operation;
        const response = await requestPluginJSON(page, pathname, body, sessionHeaders);
        pluginResponses.push({ method: 'POST', pathname, ...response });
        if (response.status !== 200) throw new Error('Connection ' + operation + ' failed: ' + JSON.stringify(response));
        return response.body?.data ?? response.body;
      };
      const review = await request('review', {
        plugin_instance_id: pluginInstanceID, connector_id: 'smoke.' + connector,
        destination: scheme + '://127.0.0.1:' + port + (connector === 'http' ? '/' : ''),
        expected_revision: revisions.get('smoke.' + connector) ?? 0, private_prefixes: ['127.0.0.1/32'],
        ...(connector === 'http' ? { http_methods: ['GET', 'POST'] } : {}),
      });
      await request('approve', { plugin_instance_id: pluginInstanceID, review_id: review.review.review_id });
    }
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
    if (!String(installed.plugin_instance_id ?? '').trim()) {
      throw new Error('smoke package installation omitted plugin identity');
    }
    let installedCatalog = await waitFor(async () => {
      const response = await queryCatalog();
      if (response.status !== 200) return null;
      const catalog = response.body?.data ?? response.body;
      return installedPlugins(catalog).find((plugin) => plugin.plugin_instance_id === installed.plugin_instance_id) ?? null;
    }, 120_000, 'v9 plugin installation projection');
    const requiredPermissions = installedCatalog.security_summary?.permissions ?? [];
    for (const requirement of requiredPermissions) {
      const permissionID = String(requirement.permission_id ?? '').trim();
      if (!permissionID) continue;
      const grant = await requestPluginJSON(page, '/_redevplugin/api/plugins/permissions/grant', {
        plugin_instance_id: installedCatalog.plugin_instance_id,
        permission_id: permissionID,
        expected_policy_revision: installedCatalog.policy_revision,
        expected_management_revision: installedCatalog.management_revision,
        expected_revoke_epoch: installedCatalog.revoke_epoch,
      }, sessionHeaders);
      pluginResponses.push({ method: 'POST', pathname: '/_redevplugin/api/plugins/permissions/grant', ...grant });
      if (grant.status !== 200) throw new Error(`v9 permission grant failed: ${JSON.stringify(grant)}`);
      const revisions = grant.body?.data?.revisions ?? grant.body?.revisions;
      installedCatalog = {
        ...installedCatalog,
        policy_revision: Number(revisions?.policy_revision ?? installedCatalog.policy_revision + 1),
        management_revision: Number(revisions?.management_revision ?? installedCatalog.management_revision),
        revoke_epoch: Number(revisions?.revoke_epoch ?? installedCatalog.revoke_epoch),
      };
    }
    await approveSmokeConnections(page, sessionHeaders, config, pluginResponses, installedCatalog.plugin_instance_id);
    const enabled = await waitFor(async () => {
      const response = await queryCatalog();
      if (response.status !== 200) return null;
      const catalog = response.body?.data ?? response.body;
      const active = enabledPlugins(catalog);
      return active.some((plugin) => plugin.plugin_instance_id === installed.plugin_instance_id
        && plugin.action_state?.can_open === true) ? catalog : null;
    }, 120_000, 'v9 plugin activation');
    return { ...installed, enabledCount: enabledPlugins(enabled).length };
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

export function createSmokeTransportGate(config, execute = promisify(execFile)) {
  const target = config.linuxTarget;
  const available = config.mode !== 'attach' && Boolean(target);
  let paused = false;
  const container = target?.container_id;
  const pid = target?.local_ui_pid;
  async function signal(name) {
    await execute('docker', ['exec', container, 'sh', '-ceu',
      'test "$(cat /proc/$1/comm)" = redeven; kill -' + name + ' "$1"', 'sh', String(pid)], { timeout: 10000 });
  }
  return {
    available,
    async pause() {
      if (!available || paused) return;
      assertIsolatedSmokeConfiguration(config);
      if (!/^[0-9a-f]{64}$/u.test(container ?? '') || !Number.isInteger(pid) || pid <= 1) {
        throw new Error('Transport gate requires the exact task-owned Linux host');
      }
      const { stdout } = await execute('docker', ['inspect', '--format', '{{.Name}}', container], { timeout: 10000 });
      if (!stdout.trim().startsWith('/redeven-plugin-smoke-')) throw new Error('Transport gate refuses an unrelated container');
      // Mark first: a lost STOP acknowledgement still requires a CONT attempt.
      paused = true;
      await signal('STOP');
    },
    async resume() {
      if (!paused) return;
      await signal('CONT');
      paused = false;
    },
  };
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
  const transportGate = createSmokeTransportGate(config);
  try {
    await runConnectedBrowserSmoke(config, browser, startedAt, connectBrowser, transportGate);
  } finally {
    try { await transportGate.resume(); }
    finally { await Promise.all([...browsers].map((connected) => connected.close().catch(() => {}))); }
  }
}

async function runConnectedBrowserSmoke(config, browser, startedAt, reconnectBrowser, transportGate) {
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
  const existingEnvPage = browserPages(browser).find((candidate) => isEnvAppPage(candidate, config.externalLocalUIURL)) ?? null;
  let opening;
  if (!existingEnvPage) {
    if (config.mode === 'attach') {
      throw new Error('attached Desktop has no open Env App target');
    }
    if (!config.externalLocalUIURL) throw new Error('isolated Desktop smoke requires an external Linux Local UI URL');
    opening = initialPage.evaluate(async (url) => {
      if (!window.redevenDesktopLauncher?.performAction) throw new Error('Desktop preload launcher bridge is unavailable');
      return window.redevenDesktopLauncher.performAction({
        kind: 'open_remote_environment',
        external_local_ui_url: url,
        environment_id: 'linux-io-smoke',
        label: 'Linux I/O smoke',
      });
    }, config.externalLocalUIURL);
    // The launcher waits for app readiness, which may require the password
    // form in the new window. Observe that window while the action is pending.
    opening.catch(() => undefined);
  }
  let page;
  try {
    page = await waitFor(async () => {
      browser = await reconnectBrowser();
      return browserPages(browser).find((candidate) => isEnvAppPage(candidate, config.externalLocalUIURL)) ?? null;
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
  // Observe the product-issued credential for this active document only.
  // Platform calls travel over encrypted session streams, not native fetch.
  let activeSessionCredential;
  const earlyErrors = [];
  page.on("console", (message) => { if (message.type() === "error") earlyErrors.push(message.text()); });
  page.on("pageerror", (error) => earlyErrors.push(error.message));
  page.on("requestfailed", (request) => earlyErrors.push({ url: new URL(request.url()).origin + new URL(request.url()).pathname, error: request.failure() }));
  page.on('request', (request) => void (async () => {
    if (new URL(request.url()).pathname === '/api/local/plugin/session/ready') {
      const headers = await request.allHeaders();
      activeSessionCredential = headers['x-redeven-plugin-session'];
    }
  })());
  // Observe acquisition before loading the same document generation.
  // Credentials never enter persisted evidence.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  if (config.externalLocalUIURL) {
    const accessPassword = page.locator('#redeven-access-password');
    await waitFor(async () => await accessPassword.isVisible() || Boolean(activeSessionCredential), 30_000, 'Local UI access gate or authenticated session');
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
  const inventorySnapshot = async () => {
    const center = page.locator('[data-plugin-center-view]');
    const refresh = center.locator('[data-plugin-center-refresh]');
    const centerItems = center.locator('[data-plugin-center-item]');
    const panelTiles = page.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])');
    return {
      centerVisible: await center.isVisible().catch(() => false),
      refreshDisabled: await refresh.isDisabled().catch(() => null),
      centerItemKeys: await centerItems.evaluateAll((items) => items.map((item) => item.getAttribute('data-plugin-center-item'))),
      panelTileKeys: await panelTiles.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-plugin-panel-tile'))),
    };
  };
  const guestOutcomes = [];
  const pluginRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.text().startsWith('redevplugin-io-smoke:')) {
      try { guestOutcomes.push(JSON.parse(message.text().slice('redevplugin-io-smoke:'.length))); }
      catch { pageErrors.push('Invalid fixture outcome'); }
    }
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
  if (opening) {
    await fs.writeFile(path.join(config.reportRoot, config.phase + '-early-diagnostics.json'), JSON.stringify({ url: page.url(), errors: earlyErrors, text: await page.locator('body').innerText() }, null, 2));
    const launcherResult = await opening;
    await fs.writeFile(path.join(config.reportRoot, config.phase + '-external-open.json'), JSON.stringify(launcherResult, null, 2));
    if (launcherResult?.ok === false) throw new Error('external Linux Local UI open failed: ' + JSON.stringify(launcherResult));
  }
  mark('shell_ready_ms');
  await waitFor(() => activeSessionCredential, 30_000, 'connected plugin session');
  phase = 'panel_open';
  const initialPanel = page.locator('#redeven-plugin-switcher').first();
  if (config.mode === 'attach' && await initialPanel.count() > 0) {
    const initialClose = initialPanel.locator(
      '[aria-label="Close plugins"], [aria-label="关闭插件"]',
    ).first();
    await initialClose.click();
    await initialPanel.waitFor({ state: 'detached', timeout: 10_000 });
  }
  const activityMode = page.getByRole('tab', { name: 'Activity', exact: true });
  await activityMode.click();
  await waitFor(() => activityMode.getAttribute('aria-selected').then((selected) => selected === 'true'), 10_000, 'Activity mode');
  const visiblePluginTrigger = () => page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first();
  await visiblePluginTrigger().waitFor({ state: 'visible', timeout: 30_000 });
  if (config.mode === 'attach' && await visiblePluginTrigger().getAttribute('aria-expanded') === 'true') {
    await visiblePluginTrigger().click();
    await page.locator('#redeven-plugin-switcher').first().waitFor({ state: 'detached', timeout: 10_000 });
  }
  phase = 'panel_open';
  const firstPanelOpenStartedAt = performance.now();
  if (!await page.locator('#redeven-plugin-switcher').first().isVisible().catch(() => false)) await visiblePluginTrigger().click();
  try {
    await page.locator('#redeven-plugin-switcher').first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, config.phase + '-panel-failure.png') });
    await fs.writeFile(path.join(config.reportRoot, config.phase + '-panel-failure.html'), await page.content());
    throw error;
  }
  const firstPanelOpenMS = Number((performance.now() - firstPanelOpenStartedAt).toFixed(1));
  phase = 'session_credentials';
  const credential = await waitFor(() => activeSessionCredential, 30_000, 'active plugin session credential');
  const sessionHeaders = {
    'x-redeven-plugin-session': credential,
    'x-redevplugin-csrf': 'redeven-env-v1',
  };
  phase = 'plugin_bootstrap';
  let bootstrap;
  try {
    bootstrap = await ensureInitialEnabledPlugin(page, sessionHeaders, config, pluginResponses);
  } catch (error) {
    await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-bootstrap-failure.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-bootstrap-failure.html`), await page.content()).catch(() => {});
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-bootstrap-diagnostics.json`), JSON.stringify({
      inventorySnapshot: await inventorySnapshot(),
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
    const pluginCenterRefresh = pluginCenter.locator('[data-plugin-center-refresh]');
    if (config.ioPackagePath) {
      try {
        if (!await pluginCenter.isVisible().catch(() => false)) {
          await page.locator('#redeven-plugin-switcher [data-plugin-center-market-action]').click();
          await pluginCenter.waitFor({ state: 'visible', timeout: 10_000 });
        }
        await pluginCenterRefresh.click();
        const centerItems = pluginCenter.locator('[data-plugin-center-item^="instance:"]');
        await waitFor(async () => {
          return await centerItems.count() === bootstrap.enabledCount
            && !(await pluginCenterRefresh.isDisabled()) ? true : null;
        }, 30_000, 'Plugin Center projection after direct smoke install');
      } catch (error) {
        await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-direct-install-projection-failure.png`), fullPage: true }).catch(() => {});
        await fs.writeFile(path.join(config.reportRoot, `${config.phase}-direct-install-projection-failure.html`), await page.content()).catch(() => {});
        await fs.writeFile(path.join(config.reportRoot, `${config.phase}-direct-install-projection-diagnostics.json`), JSON.stringify({
          expectedEnabledCount: bootstrap.enabledCount,
          inventorySnapshot: await inventorySnapshot(),
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
    const pluginPanel = page.locator('#redeven-plugin-switcher').first();
    try {
      if (!await pluginPanel.isVisible().catch(() => false)) {
        await activityPluginTrigger.waitFor({ state: 'visible', timeout: 10_000 });
        await activityPluginTrigger.click();
      }
      await pluginPanel.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(config.reportRoot, `${config.phase}-panel-after-install-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-after-install-failure.html`), await page.content()).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-after-install-diagnostics.json`), JSON.stringify({
        trigger: await activityPluginTrigger.evaluate((node) => ({
          ariaExpanded: node.getAttribute('aria-expanded'),
          ariaPressed: node.getAttribute('aria-pressed'),
          className: node.getAttribute('class'),
        })).catch(() => null),
        panelCount: await page.locator('#redeven-plugin-switcher').count(),
        panelVisible: await pluginPanel.isVisible().catch(() => false),
        motionStates: await page.locator('[data-plugin-panel-motion-state]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-plugin-panel-motion-state'))),
        workbenchSelected: await page.getByRole('tab', { name: 'Workbench', exact: true }).getAttribute('aria-selected'),
        inventorySnapshot: await inventorySnapshot(),
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
  }
  phase = 'panel_close_reopen';
  const panelDismissal = {};
  const closePanel = page.locator('#redeven-plugin-switcher [aria-label="Close plugins"], #redeven-plugin-switcher [aria-label="关闭插件"]').first();
  await closePanel.click();
  try {
    await page.locator('#redeven-plugin-switcher').first().waitFor({ state: 'detached', timeout: 10_000 });
  } catch (error) {
    const panels = page.locator('#redeven-plugin-switcher');
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-panel-close-diagnostics.json`), JSON.stringify({
      trigger: await visiblePluginTrigger().evaluate((node) => ({
        ariaExpanded: node.getAttribute('aria-expanded'),
        ariaPressed: node.getAttribute('aria-pressed'),
      })).catch(() => null),
      panels: await Promise.all(Array.from({ length: await panels.count() }, async (_, index) => {
        const panel = panels.nth(index);
        const dialog = panel;
        return {
          visible: await panel.isVisible(),
          motionState: await dialog.getAttribute('data-plugin-panel-motion-state'),
          ariaModal: await dialog.getAttribute('aria-modal'),
          text: (await dialog.innerText().catch(() => '')).slice(0, 500),
        };
      })),
      inventorySnapshot: await inventorySnapshot(),
      error: String(error),
    }, null, 2)).catch(() => {});
    throw error;
  }
  panelDismissal.close_button = { closed: true, panel_count: 0 };
  await visiblePluginTrigger().click();
  await page.locator('#redeven-plugin-switcher').first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.locator('#redeven-plugin-switcher').first().waitFor({ state: 'detached', timeout: 10_000 });
  panelDismissal.escape = { closed: true, panel_count: 0 };
  await visiblePluginTrigger().click();
  const panel = page.locator('#redeven-plugin-switcher').first();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await activityMode.click();
  await panel.waitFor({ state: 'detached', timeout: 10_000 });
  panelDismissal.outside_pointer = { closed: true, panel_count: 0 };
  await transportGate.pause();
  const panelReopenCycles = [];
  let expectedTileKeys = null;
  for (let index = 0; index < 5; index += 1) {
    const openStartedAt = performance.now();
    await visiblePluginTrigger().click();
    const reopenedPanel = page.locator('#redeven-plugin-switcher').first();
    await reopenedPanel.waitFor({ state: 'visible', timeout: 10_000 });
    const openDurationMS = Number((performance.now() - openStartedAt).toFixed(1));
    const installedTiles = reopenedPanel.locator('[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])');
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
        panelText: (await reopenedPanel.innerText().catch(() => '')).slice(0, 4000),
        inventorySnapshot: await inventorySnapshot(),
        pluginResponses,
        pluginRequests,
        failedResponses,
        consoleErrors,
        pageErrors,
        error: String(error),
      }, null, 2)).catch(() => {});
      throw error;
    }
    const panelText = await reopenedPanel.innerText();
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
      const cycleClose = reopenedPanel.locator(
        '[aria-label="Close plugins"], [aria-label="关闭插件"]',
      ).first();
      await cycleClose.click();
      await reopenedPanel.waitFor({ state: 'detached', timeout: 10_000 });
    }
  }
  await transportGate.resume();
  const finalPanel = page.locator('#redeven-plugin-switcher').first();
  await finalPanel.locator('[data-plugin-center-market-action]').click();
  const pluginCenter = page.locator('[data-plugin-center-view]');
  const pluginCenterRefresh = pluginCenter.locator('[data-plugin-center-refresh]');
  await pluginCenter.waitFor({ state: 'visible', timeout: 10_000 });
  let backgroundRefreshEvidence = { delayed: false, reason: 'attached target is not suspended' };
  if (transportGate.available) {
    await transportGate.pause();
    await pluginCenterRefresh.click();
    await waitFor(async () => (
      await pluginCenterRefresh.isDisabled() ? true : null
    ), 10_000, 'background refresh control pending');
    let backgroundRefreshTileKeys;
    try {
      await visiblePluginTrigger().click();
      const pendingRefreshPanel = page.locator('#redeven-plugin-switcher').first();
      await pendingRefreshPanel.waitFor({ state: 'visible', timeout: 10_000 });
      const pendingRefreshTiles = pendingRefreshPanel.locator(
        '[data-plugin-panel-tile]:not([data-plugin-panel-tile="plugin-center"])',
      );
      await waitFor(async () => (
        await pendingRefreshTiles.count() === bootstrap.enabledCount ? true : null
      ), 10_000, 'Plugin Panel snapshot during background refresh');
      const pendingRefreshText = await pendingRefreshPanel.innerText();
      if (/Loading plugins|正在加载插件/u.test(pendingRefreshText)) {
        throw new Error('Plugin Panel exposed a loading banner during a background refresh');
      }
      backgroundRefreshTileKeys = await pendingRefreshTiles.evaluateAll((tiles) => tiles.map(
        (tile) => tile.getAttribute('data-plugin-panel-tile'),
      ));
    } finally {
      await transportGate.resume();
    }
    await waitFor(async () => (
      !(await pluginCenterRefresh.isDisabled()) ? true : null
    ), 30_000, 'background inventory refresh completion');
    backgroundRefreshEvidence = {
      delayed: true,
      transport: 'task_owned_linux_host_suspended',
      snapshot_visible_while_pending: true,
      loading_text_visible: false,
      background_refresh_tile_keys: backgroundRefreshTileKeys,
    };
  }
  panelDismissal.final_reopen = { open: true, panel_count: 1, cycles: 5 };
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
    inventorySnapshot: await inventorySnapshot(),
  });
  const recovery = recoveryEntry.body;
  const catalog = catalogEntry.body?.data ?? catalogEntry.body;
  let runtimePreparation = null;
  if (config.ioPackagePath) {
    runtimePreparation = await ensureEnabledWorkerRuntime({
      plugins: installedPlugins(catalog),
      request: async (pathname, body) => {
        const response = await requestPluginJSON(page, pathname, body, sessionHeaders);
        pluginResponses.push({ method: 'POST', pathname, ...response });
        return response;
      },
    });
  }
  const enabledCount = Array.isArray(catalog?.plugins)
    ? catalog.plugins.filter((plugin) => plugin?.enable_state === 'enabled').length
    : 0;
  await fs.writeFile(path.join(config.reportRoot, `${config.phase}-catalog-checkpoint.json`), JSON.stringify({
    recovery,
    runtimePreparation,
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
      inventorySnapshot: await inventorySnapshot(),
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
  let frame = null;
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
    const installedForIcon = installedPlugins(catalog).find((candidate) =>
      candidate.plugin_id === 'dev.redeven.smoke.io') ?? installedPlugins(catalog)[0];
    const iconPath = installedForIcon?.presentation?.icon?.path ?? installedForIcon?.manifest?.presentation?.icon?.path;
    const iconEntry = installedForIcon?.package_entries?.find((entry) => entry.path === iconPath);
    const iconDigest = iconEntry?.sha256?.replace(/^sha256:/u, '');
    const renderedIconDigest = icon[0]?.src ? await page.evaluate(async (url) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((value) => value.toString(16).padStart(2, '0')).join('');
    }, icon[0].src) : null;
    if (icon.length !== 1 || !icon[0]?.src?.startsWith('blob:') || !icon[0].complete
      || icon[0].naturalWidth <= 0 || iconFallbackCount !== 0 || !iconDigest || renderedIconDigest !== iconDigest) {
      throw new Error(`installed plugin icon is not locally preloaded: ${JSON.stringify({ icon, iconFallbackCount, pluginIconResponses })}`);
    }
    const iconEvidence = { image: icon[0], fallback_count: iconFallbackCount, verified_package_sha256: iconDigest, rendered_sha256: renderedIconDigest };
    const tileBeforeOpen = {
      key: await firstTile.getAttribute('data-plugin-panel-tile'),
      text: (await firstTile.innerText()).trim(),
      describedBy: await firstTile.getAttribute('aria-describedby'),
    };
    await firstTile.click();
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
        inventorySnapshot: await inventorySnapshot(),
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
    let rpcEntry;
    try {
      rpcEntry = await waitFor(
        () => guestOutcomes.find((entry) => entry.method === 'smoke.run' && entry.ok === true),
        180_000,
        'plugin RPC',
      );
    } catch (error) {
      const matchesV9RPC = (entry) => entry.pathname.endsWith('/plugins/rpc')
        && entry.rpc_plugin_instance_id === v9Plugin?.plugin_instance_id
        && entry.rpc_method === 'smoke.run';
      const [fixtureState, diagnosticResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${config.fixturePorts.http}/state`)
          .then(async (response) => ({ status: response.status, body: await response.json() }))
          .catch((stateError) => ({ error: String(stateError) })),
        requestPluginJSON(page, '/_redevplugin/api/plugins/diagnostics/query', {
          plugin_instance_id: v9Plugin?.plugin_instance_id,
          limit: 100,
        }, sessionHeaders).catch((diagnosticError) => ({ error: String(diagnosticError) })),
      ]);
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-rpc-diagnostics.json`), `${JSON.stringify({
        guestOutcomes,
        matchingRequests: pluginRequests.filter(matchesV9RPC),
        matchingResponses: pluginResponses.filter(matchesV9RPC),
        fixtureState,
        diagnosticResponse,
        iframeURL: frame.url(),
        iframeBody: (await frame.locator('body').innerText().catch(() => '')).slice(0, 8_000),
        consoleErrors,
        pageErrors,
        failedResponses,
        error: String(error),
      }, null, 2)}\n`);
      throw error;
    }
    const renderedResult = JSON.parse(await frame.locator('#result').innerText());
    if (JSON.stringify(renderedResult) !== JSON.stringify(rpcEntry.result)) {
      throw new Error('Guest outcome does not match the rendered plugin result');
    }
    rpc = { ok: true, method: rpcEntry.method, source: 'guest_bridge_and_rendered_result',
      result: { ok: true, data: { data: renderedResult } } };
    surface.icon = iconEvidence;
    mark('surface_ready_ms');
  }

  const assessment = assessPluginSmoke({ recovery, catalog, panelInstalledCount, surface, rpc });
  let disabledUpdateIntent = null;
  if (config.mode !== 'attach' && config.phase === 'initial' && config.ioPackagePath) {
    phase = 'disabled_revoke';
    const v9Plugin = installedPlugins(catalog).find((candidate) => candidate.plugin_id === 'dev.redeven.smoke.io');
    disabledUpdateIntent = await verifyIOSmokeRevoke(page, frame, sessionHeaders, catalog, config, pluginResponses, v9Plugin?.plugin_instance_id, guestOutcomes);
  } else if (config.mode !== 'attach' && config.phase === 'initial') {
    phase = 'disabled_update_intent';
    disabledUpdateIntent = await verifyDisabledUpdateIntent(page, sessionHeaders, catalog, pluginResponses);
  }
  let ioEvidence = null;
  let uninstallEvidence = null;
  if (config.ioPackagePath) {
    const workerResult = workerResultFromRPCResponse(rpc.result);
    const initialEvidence = config.phase === 'cold_restart' && config.initialOutput
      ? JSON.parse(await fs.readFile(config.initialOutput, 'utf8')).io_evidence
      : null;
    ioEvidence = {
      linux_target: {
        os: config.linuxTarget?.os,
        arch: config.linuxTarget?.arch,
        container_id: config.linuxTarget?.container_id,
        commit: config.commit,
        runtime_pid: runtimePreparation?.runtimePID,
        previous_runtime_pid: initialEvidence?.linux_target?.runtime_pid,
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
      revoke: disabledUpdateIntent,
      cold_restart: config.phase === 'cold_restart' ? {
        runtime_restarted: true,
        state_root_reused: config.linuxTarget?.state_root === initialEvidence?.linux_target?.state_root,
        enabled_after_restart: bootstrap.enabledCount > 0,
      } : null,
    };
    assertExtensionIOEvidence(ioEvidence, {
      requireRevoke: config.phase === 'initial',
      requireColdRestart: config.phase === 'cold_restart',
    });
    if (config.phase === 'cold_restart') {
      uninstallEvidence = await verifyUninstall(page, sessionHeaders, catalog, pluginResponses);
    }
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
    pids: config.pids,
    timings,
    first_panel_open: {
      completed_after_session_ready: true,
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
      snapshot_independent_of_network: transportGate.available,
      inventory_request_count: null,
      inventory_observation: 'encrypted stream; request counts covered by inventory controller tests',
      background_refresh: backgroundRefreshEvidence,
      icon_responses: pluginIconResponses,
    },
    surface,
    rpc,
    disabled_update_intent: disabledUpdateIntent,
    uninstall: uninstallEvidence,
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
