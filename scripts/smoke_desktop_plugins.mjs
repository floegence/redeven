import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SHARED_PORTS = new Set([23998, 9222, 9230]);
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

async function waitFor(check, timeoutMS, label) {
  const deadline = Date.now() + timeoutMS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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

async function runBrowserSmoke(config) {
  assertIsolatedSmokeConfiguration(config);
  const playwrightRoot = config.playwrightRoot;
  if (!playwrightRoot) throw new Error('plugin smoke requires an explicit task-owned Playwright package root');
  const { chromium } = require(path.join(playwrightRoot, 'playwright'));
  const startedAt = performance.now();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
  try {
    await runConnectedBrowserSmoke(config, browser, startedAt);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runConnectedBrowserSmoke(config, browser, startedAt) {
  const context = browser.contexts()[0];
  if (!context) throw new Error('Desktop CDP context is unavailable');
  const initialPage = await waitFor(
    () => context.pages().find((candidate) => !candidate.url().startsWith('devtools://') && candidate.url() !== 'about:blank'),
    30_000,
    'Desktop page',
  );
  const existingEnvPage = await Promise.any(context.pages().map(async (candidate) => (
    await candidate.locator('#redeven-plugin-switcher').count() ? candidate : Promise.reject()
  ))).catch(() => null);
  if (!existingEnvPage) {
    const open = initialPage.getByRole('button', { name: /^(?:Open|打开)$/u }).first();
    await open.waitFor({ state: 'visible', timeout: 30_000 });
    await open.click();
  }
  let page;
  try {
    page = await waitFor(async () => {
      for (const candidate of context.pages()) {
        if (await candidate.locator('#redeven-plugin-switcher').count()) return candidate;
      }
      return null;
    }, 60_000, 'Env App page');
  } catch (error) {
    await initialPage.screenshot({ path: path.join(config.reportRoot, `${config.phase}-welcome-failure.png`), fullPage: true });
    await fs.writeFile(path.join(config.reportRoot, `${config.phase}-welcome-failure.html`), await initialPage.content());
    throw error;
  }
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const pluginResponses = [];
  const pluginRequestHeaders = new Map();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', async (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/_redevplugin/api/plugins/')) {
      pluginRequestHeaders.set(pathname, await request.allHeaders());
    }
  });
  page.on('response', async (response) => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400) failedResponses.push({ method: request.method(), pathname, status: response.status() });
    if (pathname.includes('/_redevplugin/api/plugins/')) {
      pluginResponses.push({ method: request.method(), pathname, status: response.status(), body: await responseJSON(response) });
    }
  });

  const timings = {};
  const mark = (name) => { timings[name] = Number((performance.now() - startedAt).toFixed(1)); };
  await page.reload({ waitUntil: 'domcontentloaded' });
  mark('document_ready_ms');
  await waitFor(() => page.locator('#redeven-plugin-switcher').count(), 60_000, 'Plugin Panel trigger');
  mark('shell_ready_ms');
  const sessionHeaders = await waitFor(() => {
    for (const headers of pluginRequestHeaders.values()) {
      if (headers['x-redeven-plugin-session'] && headers['x-redevplugin-csrf']) return headers;
    }
    return null;
  }, 30_000, 'plugin session credential');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => page.locator('#redeven-plugin-switcher').count(), 30_000, 'Plugin Panel trigger after session');
  await page.locator('#redeven-plugin-switcher').click();
  await waitFor(() => page.locator('[data-plugin-launcher-grid]').count(), 10_000, 'Plugin Panel');
  mark('panel_ready_ms');

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
      pluginResponses,
      failedResponses,
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
    await firstTile.click();
    const frame = await waitFor(
      () => page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url() === 'about:blank'),
      30_000,
      'plugin surface iframe',
    );
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
    pids: config.pids,
    timings,
    refresh,
    catalog,
    panel: { installed_count: panelInstalledCount, needs_attention: await page.locator('[data-plugin-runtime-recovery]').count() },
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
