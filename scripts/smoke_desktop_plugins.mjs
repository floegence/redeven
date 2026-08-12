import fs from 'node:fs/promises';
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

export function assessPluginSmoke({ refresh, catalog, panelInstalledCount, surface, rpc }) {
  const results = Array.isArray(refresh?.data?.results) ? refresh.data.results : [];
  if (!refresh?.ok || results.some((result) => result?.status === 'failed')) {
    return { ok: false, failure: 'refresh_failed', refresh };
  }
  const plugins = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
  const catalogEnabledCount = plugins.filter((plugin) => plugin?.enable_state === 'enabled').length;
  if (catalogEnabledCount === 0) {
    return { ok: false, failure: 'enabled_plugin_missing', refresh, catalogEnabledCount };
  }
  if (catalogEnabledCount !== Number(panelInstalledCount)) {
    return {
      ok: false,
      failure: 'inventory_count_mismatch',
      refresh,
      catalogEnabledCount,
      panelInstalledCount: Number(panelInstalledCount),
    };
  }
  if (catalogEnabledCount > 0 && !surface?.ready) {
    return { ok: false, failure: 'surface_not_ready', refresh, catalogEnabledCount, panelInstalledCount };
  }
  if (catalogEnabledCount > 0 && !rpc?.ok) {
    return { ok: false, failure: 'rpc_failed', refresh, catalogEnabledCount, panelInstalledCount, surface, rpc };
  }
  return { ok: true, refresh, catalogEnabledCount, panelInstalledCount, surface, rpc };
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
  if (config.phase !== 'initial') {
    throw new Error('cold restart started without an enabled plugin');
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
    return enabledPlugins(catalog).length > 0 ? catalog : null;
  }, 120_000, 'official plugin installation');
  return { performed: true, enabledCount: enabledPlugins(installed).length };
}

async function runBrowserSmoke(config) {
  assertIsolatedSmokeConfiguration(config);
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
    const open = initialPage.getByRole('button', { name: /^(?:Open|打开)$/u }).last();
    try {
      await open.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
      await initialPage.screenshot({ path: path.join(config.reportRoot, `${config.phase}-welcome-failure.png`), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(config.reportRoot, `${config.phase}-welcome-failure.html`), await initialPage.content()).catch(() => {});
      throw error;
    }
    await open.click();
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
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const pluginResponses = [];
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
      pluginRequests.push({ method: request.method(), pathname });
      pluginRequestHeaders.set(pathname, await request.allHeaders());
    }
  })().catch((error) => pageErrors.push(`request observation failed: ${String(error)}`)));
  page.on('response', (response) => void (async () => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400) failedResponses.push({ method: request.method(), pathname, status: response.status() });
    if (pathname.includes('/_redevplugin/api/plugins/') || pathname.includes('/_redeven_proxy/api/plugins/market')) {
      pluginResponses.push({ method: request.method(), pathname, status: response.status(), body: await responseJSON(response) });
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
  const sessionHeaders = await waitFor(() => {
    for (const headers of pluginRequestHeaders.values()) {
      if (headers['x-redeven-plugin-session'] && headers['x-redevplugin-csrf']) return headers;
    }
    return null;
  }, 30_000, 'plugin session credential');
  phase = 'panel_open';
  const activityMode = page.getByRole('tab', { name: 'Activity', exact: true });
  await activityMode.click();
  await waitFor(() => activityMode.getAttribute('aria-selected').then((selected) => selected === 'true'), 10_000, 'Activity mode');
  const visiblePluginTrigger = () => page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first();
  await visiblePluginTrigger().waitFor({ state: 'visible', timeout: 30_000 });
  await visiblePluginTrigger().click();
  await waitFor(() => page.locator('[data-plugin-launcher-grid]').count(), 10_000, 'Plugin Panel');
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
    const closeCenter = page.locator('[data-plugin-center-toolbar-primary] button[aria-label]').last();
    await closeCenter.click();
    await page.locator('[data-plugin-center-view]').waitFor({ state: 'detached', timeout: 10_000 });
    const activityPluginTrigger = page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first();
    await activityPluginTrigger.waitFor({ state: 'visible', timeout: 10_000 });
    await activityPluginTrigger.click();
    try {
      await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'visible', timeout: 10_000 });
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
  await visiblePluginTrigger().click();
  await page.locator('[data-plugin-launcher-backdrop]').first().waitFor({ state: 'visible', timeout: 10_000 });
  panelDismissal.final_reopen = { open: true, backdrop_count: 1 };
  mark('panel_ready_ms');

  phase = 'inventory';
  const refreshResponse = await waitFor(async () => {
    const response = await requestPluginJSON(page, '/_redevplugin/api/plugins/runtime/refresh-enabled', {}, sessionHeaders);
    return response.status === 200 ? response : null;
  }, 30_000, 'refresh-enabled response');
  const refreshEntry = { method: 'POST', pathname: '/_redevplugin/api/plugins/runtime/refresh-enabled', ...refreshResponse };
  pluginResponses.push(refreshEntry);
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
  const refresh = refreshEntry.body;
  const catalog = catalogEntry.body?.data ?? catalogEntry.body;
  const enabledCount = Array.isArray(catalog?.plugins)
    ? catalog.plugins.filter((plugin) => plugin?.enable_state === 'enabled').length
    : 0;
  await fs.writeFile(path.join(config.reportRoot, `${config.phase}-catalog-checkpoint.json`), JSON.stringify({
    refresh,
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
      refresh,
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
    refresh,
    catalog,
    panelInstalledCount,
    surface: { ready: true },
    rpc: { ok: true },
  });
  if (inventoryAssessment.ok && enabledCount > 0) {
    const firstTile = page.locator('[data-plugin-panel-tile]').first();
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
    const rpcEntry = await waitFor(
      () => pluginResponses.find((entry) => entry.pathname.endsWith('/plugins/rpc') && entry.status === 200),
      30_000,
      'plugin RPC',
    );
    rpc = { ok: true, method: rpcEntry.body?.data?.method ?? 'observed_plugin_rpc', result: rpcEntry.body };
    mark('surface_ready_ms');
  }

  const assessment = assessPluginSmoke({ refresh, catalog, panelInstalledCount, surface, rpc });
  const summary = {
    schema_version: 1,
    phase: config.phase,
    commit: config.commit,
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
    bootstrap,
    refresh,
    catalog,
    panel: {
      installed_count: panelInstalledCount,
      needs_attention: await page.locator('[data-plugin-runtime-recovery]').count(),
      dismissal: panelDismissal,
    },
    surface,
    rpc,
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
