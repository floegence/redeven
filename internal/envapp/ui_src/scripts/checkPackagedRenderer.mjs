#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const distDir = path.resolve(scriptDir, '../../ui/dist/env');
const terminalAgentIconManifestPath = path.join(repoRoot, 'assets/terminal_agent_icons.json');
const entryPath = '/_redeven_proxy/env/';
const assetPrefix = `${entryPath}assets/`;
const hashedAssetPattern = /-[A-Za-z0-9_-]{8,}\.(?:css|js|wasm)$/;

function parseReportPath(args) {
  const index = args.indexOf('--report');
  if (index === -1) return '';
  const value = String(args[index + 1] ?? '').trim();
  if (!value) throw new Error('--report requires a file path');
  return path.resolve(value);
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.wasm': return 'application/wasm';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

async function readExpectedTerminalAgentIconFiles() {
  const manifest = JSON.parse(await readFile(terminalAgentIconManifestPath, 'utf8'));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('terminal Agent CLI icon manifest is invalid');
  }
  const files = manifest.assets.flatMap((asset) => [asset.file, asset.light_file, asset.dark_file]
    .filter((file) => file != null)
    .map((file) => String(file)));
  if (files.some((file) => !/^[a-z-]+\.svg$/u.test(file)) || new Set(files).size !== files.length) {
    throw new Error('terminal Agent CLI icon manifest contains invalid or duplicate files');
  }
  return files.sort();
}

function jsonResponse(response, value) {
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

async function createBuiltDistServer({ accessReady = false } = {}) {
  let baseURL = '';
  const server = createServer(async (request, response) => {
    try {
      const requestURL = new URL(request.url ?? '/', baseURL || 'http://127.0.0.1');
      if (requestURL.pathname === '/api/local/access/status') {
        jsonResponse(response, { password_required: !accessReady, unlocked: accessReady });
        return;
      }
      if (requestURL.pathname === '/api/local/runtime') {
        jsonResponse(response, {
          env_public_id: 'env_built_dist_shell',
          desktop_managed: true,
          effective_run_mode: 'local',
          direct_ws_url: baseURL.replace(/^http/, 'ws') + '_redeven_direct/ws',
        });
        return;
      }
      if (accessReady && requestURL.pathname === '/api/local/environment') {
        jsonResponse(response, {
          public_id: 'env_built_dist_shell',
          name: 'Built dist shell',
          namespace_public_id: 'ns_built_dist_shell',
          status: 'online',
          lifecycle_status: 'running',
          permissions: {
            can_read: true,
            can_write: true,
            can_execute: true,
            can_admin: true,
            is_owner: true,
          },
        });
        return;
      }
      if (accessReady && requestURL.pathname === '/api/local/direct/connect_artifact') {
        jsonResponse(response, {
          transport: 'direct',
          direct_info: {
            ws_url: baseURL.replace(/^http/, 'ws') + '_redeven_direct/ws',
            channel_id: 'built-dist-shell',
            e2ee_psk_b64u: 'built-dist-shell',
            channel_init_expire_at_unix_s: 4_102_444_800,
            default_suite: 1,
          },
        });
        return;
      }
      if (accessReady && requestURL.pathname === '/_redeven_proxy/api/ai/threads') {
        jsonResponse(response, { threads: [] });
        return;
      }
      if (accessReady && (
        requestURL.pathname.startsWith('/api/')
        || requestURL.pathname.startsWith('/_redeven_proxy/api/')
      )) {
        jsonResponse(response, {});
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/catalog/query') {
        jsonResponse(response, { ok: true, data: { plugins: [] } });
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/permissions/query') {
        jsonResponse(response, { ok: true, data: { permissions: [] } });
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/security-policies/query') {
        jsonResponse(response, { ok: true, data: { security_policies: [] } });
        return;
      }

      if (!requestURL.pathname.startsWith(entryPath)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }

      const relativeURLPath = requestURL.pathname === entryPath
        ? 'index.html'
        : decodeURIComponent(requestURL.pathname.slice(entryPath.length));
      const normalizedRelativePath = path.posix.normalize(relativeURLPath);
      if (normalizedRelativePath.startsWith('../') || path.isAbsolute(normalizedRelativePath)) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('invalid path');
        return;
      }
      const filePath = path.join(distDir, normalizedRelativePath);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error(`not a file: ${normalizedRelativePath}`);
      const data = await readFile(filePath);
      response.writeHead(200, {
        'cache-control': normalizedRelativePath === 'index.html'
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
        'content-length': String(data.byteLength),
        'content-type': contentType(filePath),
      });
      response.end(data);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('built Env App dist server did not bind a TCP port');
  baseURL = `http://127.0.0.1:${address.port}/`;
  return {
    baseURL,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function verifyBuiltFlowerLifecycle(browser) {
  const server = await createBuiltDistServer({ accessReady: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const entryURL = new URL(entryPath.slice(1), server.baseURL).toString();
    await page.goto(entryURL, { waitUntil: 'load', timeout: 30_000 });

    const companion = page.locator('#redeven-activity-flower-companion');
    const product = page.locator('#redeven-activity-flower-product');
    const surface = page.locator('#redeven-flower-surface');
    const composer = page.locator('.flower-composer textarea');
    await surface.waitFor({ state: 'attached', timeout: 15_000 });
    await composer.waitFor({ state: 'attached', timeout: 15_000 });

    for (const [name, locator] of Object.entries({ companion, product, surface, composer })) {
      const count = await locator.count();
      if (count !== 1) throw new Error(`built Flower ${name} count = ${count}, expected 1`);
    }

    const collapsedBox = await companion.boundingBox();
    if (!collapsedBox || collapsedBox.width <= 0 || collapsedBox.height <= 0) {
      throw new Error(`built Flower collapsed companion has invalid geometry: ${JSON.stringify(collapsedBox)}`);
    }
    await page.evaluate(() => {
      globalThis.__redevenBuiltFlowerIdentity = {
        surface: globalThis.document.querySelector('#redeven-flower-surface'),
        composer: globalThis.document.querySelector('.flower-composer textarea'),
      };
    });

    await companion.click();
    await page.waitForFunction(() => (
      globalThis.document
        .querySelector('#redeven-activity-flower-product')
        ?.getAttribute('data-presentation') === 'expanded'
    ));
    await page.waitForFunction(() => (
      globalThis.document
        .querySelector('#redeven-activity-flower-companion')
        ?.getAttribute('data-companion-phase') === 'expanded'
    ));
    const expandedCompanionBox = await companion.boundingBox();
    const expandedComposerBox = await page.locator('.flower-composer').boundingBox();
    const expandedTextareaBox = await composer.boundingBox();
    if (!expandedCompanionBox || !expandedComposerBox || !expandedTextareaBox) {
      throw new Error(`built Flower expanded companion is missing geometry: ${JSON.stringify({
        companion: expandedCompanionBox,
        composer: expandedComposerBox,
        textarea: expandedTextareaBox,
      })}`);
    }
    const expandedBottom = expandedCompanionBox.y + expandedCompanionBox.height;
    const composerBottom = expandedComposerBox.y + expandedComposerBox.height;
    const textareaBottom = expandedTextareaBox.y + expandedTextareaBox.height;
    if (
      expandedComposerBox.width <= 0
      || expandedComposerBox.height <= 0
      || expandedTextareaBox.width <= 0
      || expandedTextareaBox.height <= 0
      || expandedComposerBox.y < expandedCompanionBox.y
      || expandedTextareaBox.y < expandedCompanionBox.y
      || composerBottom > expandedBottom + 1
      || textareaBottom > expandedBottom + 1
    ) {
      throw new Error(`built Flower composer is outside the expanded companion: ${JSON.stringify({
        companion: expandedCompanionBox,
        composer: expandedComposerBox,
        textarea: expandedTextareaBox,
      })}`);
    }

    const flowerEntry = page.getByRole('button', { name: 'Flower', exact: true });
    await flowerEntry.click();
    await page.waitForFunction(() => (
      globalThis.document
        .querySelector('#redeven-activity-flower-product')
        ?.getAttribute('data-presentation') === 'full_page'
    ));

    const fullPageHost = page.locator('[data-activity-flower-full-page-host]');
    const fullPageBox = await fullPageHost.boundingBox();
    const fullPageProductBox = await product.boundingBox();
    const fullPageSurfaceBox = await surface.boundingBox();
    const fullPageIdentity = await page.evaluate(() => ({
      sameSurface: globalThis.__redevenBuiltFlowerIdentity?.surface === globalThis.document.querySelector('#redeven-flower-surface'),
      sameComposer: globalThis.__redevenBuiltFlowerIdentity?.composer === globalThis.document.querySelector('.flower-composer textarea'),
      presentation: globalThis.document.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-presentation'),
    }));
    if (!fullPageBox || fullPageBox.width <= 0 || fullPageBox.height <= 0) {
      throw new Error(`built Flower full-page host has invalid geometry: ${JSON.stringify(fullPageBox)}`);
    }
    if (!fullPageProductBox || fullPageProductBox.width <= 0 || fullPageProductBox.height <= 0) {
      throw new Error(`built Flower full-page product has invalid geometry: ${JSON.stringify(fullPageProductBox)}`);
    }
    if (!fullPageSurfaceBox || fullPageSurfaceBox.width <= 0 || fullPageSurfaceBox.height <= 0) {
      throw new Error(`built Flower full-page surface has invalid geometry: ${JSON.stringify(fullPageSurfaceBox)}`);
    }
    if (!fullPageIdentity.sameSurface || !fullPageIdentity.sameComposer || fullPageIdentity.presentation !== 'full') {
      throw new Error(`built Flower did not preserve its full-page identity: ${JSON.stringify(fullPageIdentity)}`);
    }

    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Flower', exact: true }).click();
    await page.waitForFunction(() => (
      globalThis.document.querySelector('#redeven-activity-flower-product')?.getAttribute('data-presentation') === 'full_page'
    ));
    const restoredIdentity = await page.evaluate(() => ({
      sameSurface: globalThis.__redevenBuiltFlowerIdentity?.surface === globalThis.document.querySelector('#redeven-flower-surface'),
      sameComposer: globalThis.__redevenBuiltFlowerIdentity?.composer === globalThis.document.querySelector('.flower-composer textarea'),
      surfaceCount: globalThis.document.querySelectorAll('#redeven-flower-surface').length,
      composerCount: globalThis.document.querySelectorAll('.flower-composer textarea').length,
    }));
    if (!restoredIdentity.sameSurface || !restoredIdentity.sameComposer
      || restoredIdentity.surfaceCount !== 1 || restoredIdentity.composerCount !== 1) {
      throw new Error(`built Flower did not preserve one restored instance: ${JSON.stringify(restoredIdentity)}`);
    }
    if (pageErrors.length > 0) throw new Error(`built Flower page errors: ${JSON.stringify(pageErrors)}`);

    return {
      companion_count: 1,
      surface_count: restoredIdentity.surfaceCount,
      composer_count: restoredIdentity.composerCount,
      collapsed_width: collapsedBox.width,
      collapsed_height: collapsedBox.height,
      expanded_composer_bottom_gap: expandedBottom - composerBottom,
      full_page_width: fullPageSurfaceBox.width,
      full_page_height: fullPageSurfaceBox.height,
      identity_preserved: true,
    };
  } finally {
    await page.close();
    await server.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reportPath = parseReportPath(args);
  const indexHTML = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const initialAssetPaths = Array.from(indexHTML.matchAll(/(?:src|href)="(\/_redeven_proxy\/env\/assets\/[^"]+)"/g))
    .map((match) => match[1]);
  if (initialAssetPaths.length === 0) throw new Error('built Env App index does not reference any assets');
  for (const assetPath of initialAssetPaths.filter((value) => /\.(?:css|js)$/.test(value))) {
    if (!hashedAssetPattern.test(path.basename(assetPath))) {
      throw new Error(`initial production asset is not content hashed: ${assetPath}`);
    }
  }

  const wasmFile = (await readdir(path.join(distDir, 'assets'))).find((entry) => entry.endsWith('.wasm'));
  if (!wasmFile || !hashedAssetPattern.test(wasmFile)) {
    throw new Error('built Env App dist does not contain a content-hashed WASM renderer');
  }
  const expectedTerminalAgentIconFiles = await readExpectedTerminalAgentIconFiles();
  const terminalAgentIconFiles = (await readdir(path.join(distDir, 'agent-cli-icons')))
    .filter((entry) => entry.endsWith('.svg'))
    .sort();
  if (JSON.stringify(terminalAgentIconFiles) !== JSON.stringify(expectedTerminalAgentIconFiles)) {
    throw new Error(`built Env App terminal Agent CLI icons do not match the audited manifest: ${JSON.stringify({
      expected: expectedTerminalAgentIconFiles,
      actual: terminalAgentIconFiles,
    })}`);
  }

  const server = await createBuiltDistServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
  });
  const consoleProblems = [];
  const pageErrors = [];
  const requestFailures = [];
  const badResponses = [];
  const loadedAssets = new Map();
  const pluginRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleProblems.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    requestFailures.push({
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText ?? 'request failed',
    });
  });
  page.on('request', (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (requestPath.startsWith('/_redevplugin/api/plugins')) {
      pluginRequests.push({ method: request.method(), path: requestPath });
    }
  });
  page.on('response', (response) => {
    const responseURL = new URL(response.url());
    if (responseURL.origin !== new URL(server.baseURL).origin) return;
    if (responseURL.pathname.startsWith(assetPrefix) && response.status() === 200) {
      loadedAssets.set(responseURL.pathname, response.status());
    }
    if (response.status() >= 400) {
      badResponses.push({ path: responseURL.pathname, status: response.status() });
    }
  });

  let report;
  try {
    const entryURL = new URL(entryPath.slice(1), server.baseURL).toString();
    await page.goto(entryURL, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(250);

    const title = await page.title();
    if (title !== 'Redeven Env App') throw new Error(`unexpected built Env App title: ${title}`);
    const rootSnapshot = await page.locator('#root').evaluate((element) => ({
      childElementCount: element.childElementCount,
      textLength: (element.textContent ?? '').trim().length,
    }));
    if (rootSnapshot.childElementCount === 0 || rootSnapshot.textLength === 0) {
      throw new Error(`built Env App root is blank: ${JSON.stringify(rootSnapshot)}`);
    }

    const lockedFlowerSurfaceCount = await page.locator([
      '[data-activity-flower-companion-anchor]',
      '#redeven-activity-flower-companion',
      '#redeven-activity-flower-product',
      '#redeven-flower-surface',
      '.flower-composer textarea',
    ].join(',')).count();
    if (lockedFlowerSurfaceCount !== 0) {
      throw new Error(`locked built Env App Flower surface count = ${lockedFlowerSurfaceCount}, expected 0`);
    }

    const pluginEntry = page.getByRole('button', { name: 'Plugins', exact: true });
    const pluginEntryCount = await pluginEntry.count();
    if (pluginEntryCount !== 1) {
      throw new Error(`built Plugin entry count = ${pluginEntryCount}, expected 1`);
    }
    await pluginEntry.click();
    const pluginCenterTile = page.locator('[data-plugin-panel-tile="plugin-center"]');
    try {
      await pluginCenterTile.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (error) {
      const bodyText = (await page.locator('body').innerText()).slice(0, 2_000);
      throw new Error(`built Plugin panel did not become visible: ${JSON.stringify({
        pluginRequests,
        pageErrors,
        consoleProblems,
        bodyText,
      })}`, { cause: error });
    }
    const pluginPanelTileCount = await pluginCenterTile.count();
    const expectedPluginRequests = [
      { method: 'POST', path: '/_redevplugin/api/plugins/catalog/query' },
      { method: 'POST', path: '/_redevplugin/api/plugins/permissions/query' },
      { method: 'POST', path: '/_redevplugin/api/plugins/security-policies/query' },
    ];
    if (JSON.stringify(pluginRequests) !== JSON.stringify(expectedPluginRequests)) {
      throw new Error(`built Plugin request contract mismatch: ${JSON.stringify({
        expected: expectedPluginRequests,
        actual: pluginRequests,
      })}`);
    }

    const overlayCount = await page.locator([
      'vite-error-overlay',
      'nextjs-portal',
      '#webpack-dev-server-client-overlay',
      '[data-nextjs-dialog-overlay]',
    ].join(',')).count();
    if (overlayCount !== 0) throw new Error(`framework error overlay count = ${overlayCount}`);

    const wasmResult = await page.evaluate(async (wasmURL) => {
      const response = await fetch(wasmURL);
      const bytes = await response.arrayBuffer();
      await WebAssembly.compile(bytes);
      return { status: response.status, byteLength: bytes.byteLength };
    }, new URL(`${assetPrefix.slice(1)}${wasmFile}`, server.baseURL).toString());
    if (wasmResult.status !== 200 || wasmResult.byteLength === 0) {
      throw new Error(`WASM renderer load failed: ${JSON.stringify(wasmResult)}`);
    }

    const terminalAgentIconResults = await page.evaluate(async ({ iconFiles, iconPrefix }) => Promise.all(
      iconFiles.map(async (file) => {
        const response = await fetch(`${iconPrefix}${file}`);
        const blob = await response.blob();
        const objectURL = URL.createObjectURL(blob);
        const image = new globalThis.Image();
        image.src = objectURL;
        try {
          await image.decode();
          return {
            file,
            status: response.status,
            contentType: response.headers.get('content-type'),
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        } finally {
          URL.revokeObjectURL(objectURL);
        }
      }),
    ), {
      iconFiles: terminalAgentIconFiles,
      iconPrefix: `${entryPath}agent-cli-icons/`,
    });
    const invalidTerminalAgentIcons = terminalAgentIconResults.filter((result) => (
      result.status !== 200
      || result.contentType !== 'image/svg+xml'
      || result.width <= 0
      || result.height <= 0
    ));
    if (invalidTerminalAgentIcons.length > 0) {
      throw new Error(`terminal Agent CLI icon load failed: ${JSON.stringify(invalidTerminalAgentIcons)}`);
    }

    const loadedKinds = {
      css: Array.from(loadedAssets.keys()).filter((value) => value.endsWith('.css')),
      js: Array.from(loadedAssets.keys()).filter((value) => value.endsWith('.js')),
      wasm: Array.from(loadedAssets.keys()).filter((value) => value.endsWith('.wasm')),
    };
    for (const [kind, assets] of Object.entries(loadedKinds)) {
      if (assets.length === 0) throw new Error(`no built-dist ${kind.toUpperCase()} asset completed successfully`);
      if (assets.some((value) => !hashedAssetPattern.test(path.basename(value)))) {
        throw new Error(`non-hashed built-dist ${kind.toUpperCase()} asset loaded: ${assets.join(', ')}`);
      }
    }
    if (consoleProblems.length > 0) throw new Error(`renderer console problems: ${JSON.stringify(consoleProblems)}`);
    if (pageErrors.length > 0) throw new Error(`renderer page errors: ${JSON.stringify(pageErrors)}`);
    if (requestFailures.length > 0) throw new Error(`renderer request failures: ${JSON.stringify(requestFailures)}`);
    if (badResponses.length > 0) throw new Error(`renderer HTTP failures: ${JSON.stringify(badResponses)}`);

    const flowerLifecycle = await verifyBuiltFlowerLifecycle(browser);

    report = {
      schema_version: 1,
      entry_path: entryPath,
      title,
      root: rootSnapshot,
      framework_overlay_count: overlayCount,
      plugin_ui: {
        entry_count: pluginEntryCount,
        panel_center_tile_count: pluginPanelTileCount,
        request_count: pluginRequests.length,
      },
      assets: {
        css: loadedKinds.css.map((value) => path.basename(value)),
        js: loadedKinds.js.map((value) => path.basename(value)),
        wasm: loadedKinds.wasm.map((value) => path.basename(value)),
        wasm_bytes: wasmResult.byteLength,
        terminal_agent_icons: {
          count: terminalAgentIconResults.length,
          files: terminalAgentIconResults.map((result) => result.file),
        },
      },
      console_problem_count: 0,
      page_error_count: 0,
      request_failure_count: 0,
      flower_lifecycle: flowerLifecycle,
      status: 'passed',
    };
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch(async (error) => {
  const failure = {
    schema_version: 1,
    entry_path: entryPath,
    status: 'failed',
    error_code: 'built_dist_shell_smoke_failed',
  };
  try {
    const reportPath = parseReportPath(process.argv.slice(2));
    if (reportPath) {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    }
  } catch {
    // Keep the original renderer failure as the command result.
  }
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
