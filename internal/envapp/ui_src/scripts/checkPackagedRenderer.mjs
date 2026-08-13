#!/usr/bin/env node

import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createAcceptor, SessionHandlers } from '@floegence/flowersec-core/node';
import { parseArtifact } from '@floegence/flowersec-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const distDir = path.resolve(scriptDir, '../../ui/dist/env');
const terminalAgentIconManifestPath = path.join(repoRoot, 'assets/terminal_agent_icons.json');
const entryPath = '/_redeven_proxy/env/';
const assetPrefix = `${entryPath}assets/`;
const pluginMarketCatalogPath = '/_redeven_proxy/api/plugins/market/catalog';
const hashedAssetPattern = /-[A-Za-z0-9_-]{8,}\.(?:css|js|wasm)$/;
const builtPluginPackageHashes = Object.freeze({
  package_sha256: 'sha256:4dde36627e17753c4cf145f3baebd0223c9219a471be75d1c25d8e858f609f69',
  manifest_sha256: 'sha256:fe038b3c44bf44b8dcfd7c6e94ffe80ccee15daf258e0a11518e307ebf9e2312',
  entries_sha256: 'sha256:4bec0de1afb29a56a89d4b51a62c8d6487f5d88a5c06bf7b1026856f7b20103a',
});
const builtPluginReleaseRef = Object.freeze({
  source_id: 'redeven_official',
  channel: 'stable',
  release_metadata_ref: 'plugins/com.redeven.official/com.redeven.official.containers/4.4.3/release.json',
  release_metadata_sha256: '2e00303ab686c4d0ae9862895f949c6286828c8496e64846012f3ca39c152be3',
  publisher_id: 'com.redeven.official',
  plugin_id: 'com.redeven.official.containers',
  version: '4.4.3',
  expected_hashes: builtPluginPackageHashes,
});
const builtPluginInstanceID = `catalog_${builtPluginReleaseRef.publisher_id}_${builtPluginReleaseRef.plugin_id}`;
const builtPluginPresentationSHA256 = `sha256:${'1'.repeat(64)}`;
const pluginMarketDetailPath = `/_redeven_proxy/api/plugins/market/plugins/${builtPluginReleaseRef.plugin_id}`;
const builtPluginPackageURL = 'https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.3/containers-4.4.3.redevplugin';

function builtDistArtifact(webSocketURL) {
  return {
    v: 2,
    profile: 'flowersec/2',
    session: {
      channel_id: 'channel-1',
      init_expire_at_unix_s: 4_102_444_800,
      idle_timeout_seconds: 60,
      establish_timeout_seconds: 30,
      rekey_prepare_timeout_seconds: 10,
      rekey_completion_timeout_seconds: 30,
      max_inbound_streams: 64,
      e2ee_psk_b64u: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
      allowed_suites: [1, 2],
      default_suite: 1,
      selected_features: 0,
      contract_hash_b64u: 'ioBJP5DPhg471caMR-huV5I9RlNKY2Pr9fs2GkP8CmA',
    },
    path: {
      kind: 'direct',
      rendezvous_group_id: 'group-1',
      listener_audience: 'listener-1',
      routing_token: 'routing-token',
      candidates: [{
        id: 'w1',
        carrier: 'websocket',
        url: webSocketURL,
        wire_profile: 'flowersec-direct/2',
      }],
    },
    scoped: [],
    correlation: { v: 2, tags: [] },
  };
}

async function createBuiltDistTLS() {
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-built-dist-flowersec-'));
  const certificatePath = path.join(directory, 'certificate.pem');
  const privateKeyPath = path.join(directory, 'private-key.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '1', '-sha256', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', privateKeyPath, '-out', certificatePath,
  ], { stdio: 'ignore' });
  const certificate = await readFile(certificatePath, 'utf8');
  const privateKey = await readFile(privateKeyPath, 'utf8');
  const certificateHash = createHash('sha256').update(new X509Certificate(certificate).raw).digest('base64');
  return {
    directory,
    certificate,
    privateKey,
    certificateHash,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function trustBuiltDistWebTransport(page, tls) {
  await page.addInitScript(({ certificateHash }) => {
    const NativeWebTransport = globalThis.WebTransport;
    if (typeof NativeWebTransport !== 'function') return;
    const certificateBytes = Uint8Array.from(atob(certificateHash), (character) => character.charCodeAt(0));
    globalThis.WebTransport = class BuiltDistWebTransport extends NativeWebTransport {
      constructor(url, options = {}) {
        super(url, {
          ...options,
          serverCertificateHashes: [{ algorithm: 'sha-256', value: certificateBytes }],
        });
      }
    };
  }, { certificateHash: tls.certificateHash });
}

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
  if (manifest.schema_version !== 2 || !Array.isArray(manifest.assets)) {
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

async function readJSONRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function browserRequestPayload(request) {
  const data = request.postData();
  if (data == null) return null;
  try {
    return request.postDataJSON();
  } catch {
    return data;
  }
}

function builtPluginMarketSnapshot() {
  return {
    schema_version: 'redeven.plugin_market_snapshot.v2',
    generation: 1,
    etag: '"catalog-g1"',
    cached_at: '2026-08-01T10:00:00Z',
    stale: false,
    source: 'remote',
    plugins: [{
      plugin_id: builtPluginReleaseRef.plugin_id,
      publisher_id: builtPluginReleaseRef.publisher_id,
      presentation: {
        default_locale: 'en-US',
        locales: [{
          locale: 'en-US',
          name: 'Fixture Plugin',
          publisher_name: 'Fixture Publisher',
          summary: 'A signed plugin fixture for renderer verification.',
          keywords: ['fixture'],
        }],
      },
      categories: ['containers', 'development'],
      channels: ['stable'],
      latest: { channel: 'stable', version: builtPluginReleaseRef.version, availability_status: 'visible' },
      release: {
        plugin_id: builtPluginReleaseRef.plugin_id,
        channel: 'stable',
        version: builtPluginReleaseRef.version,
        asset: { url: builtPluginPackageURL },
        publisher_release_ref: { release_ref: builtPluginReleaseRef },
        signer_key_id: 'redeven_official_signing_2026',
        compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '0.7.16' },
      },
    }],
  };
}

function builtPluginPresentationCatalog() {
  return {
    default_locale: 'en-US',
    locales: [{
      locale: 'en-US',
      plugin_name: 'Fixture Plugin',
      publisher_name: 'Fixture Publisher',
      summary: 'A signed plugin fixture for renderer verification.',
      description: ['This fixture exercises the signed plugin presentation path.'],
      highlights: ['Provides deterministic renderer verification data.'],
      keywords: ['fixture'],
      surfaces: [{ surface_id: 'plugin.primary', label: 'Fixture Surface' }],
      settings: [],
    }],
  };
}

function builtPluginMarketDetail() {
  const presentation = builtPluginPresentationCatalog();
  return {
    plugin_id: builtPluginReleaseRef.plugin_id,
    publisher_id: builtPluginReleaseRef.publisher_id,
    presentation: {
      default_locale: presentation.default_locale,
      locales: presentation.locales.map(({ plugin_name: name, ...locale }) => ({ ...locale, name })),
    },
    categories: ['development'],
    channels: ['stable'],
    repository: {
      provider: 'github',
      repository_id: 1,
      owner: 'fixture',
      name: 'plugin',
      url: 'https://github.com/fixture/plugin',
    },
    compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '0.7.1' },
    status: 'visible',
    latest: [{ channel: 'stable', version: builtPluginReleaseRef.version, availability_status: 'visible' }],
  };
}

function builtPluginInstalledPlugin() {
  return {
    plugin_instance_id: builtPluginInstanceID,
    publisher_id: builtPluginReleaseRef.publisher_id,
    plugin_id: builtPluginReleaseRef.plugin_id,
    version: builtPluginReleaseRef.version,
    active_fingerprint: builtPluginPackageHashes.package_sha256,
    package_hash: builtPluginPackageHashes.package_sha256,
    manifest_hash: builtPluginPackageHashes.manifest_sha256,
    entries_hash: builtPluginPackageHashes.entries_sha256,
    trust_state: 'verified',
    trust_assessment: { trust_state: 'verified', verified_hashes: builtPluginPackageHashes },
    enable_state: 'disabled',
    policy_revision: 1,
    management_revision: 1,
    revoke_epoch: 0,
    manifest: {
      schema_version: 'redevplugin.manifest.v8',
      publisher: { publisher_id: builtPluginReleaseRef.publisher_id, display_name: 'Fixture Publisher' },
      plugin: {
        plugin_id: builtPluginReleaseRef.plugin_id,
        display_name: 'Fixture Plugin',
        version: builtPluginReleaseRef.version,
        api_version: 'plugin-v1',
        min_runtime_version: '0.7.1',
        ui_protocol_version: 'plugin-ui-v7',
      },
      presentation: {
        default_locale: 'en-US',
        summary: 'A signed plugin fixture for renderer verification.',
        description: ['This fixture exercises the signed plugin presentation path.'],
        highlights: ['Provides deterministic renderer verification data.'],
        keywords: ['fixture'],
        localizations: [],
      },
      surfaces: [{
        surface_id: 'plugin.primary',
        kind: 'view',
        intent: 'primary',
        label: 'Fixture Surface',
        entry: 'ui/index.html',
      }],
    },
    presentation: builtPluginPresentationCatalog(),
    presentation_sha256: builtPluginPresentationSHA256,
    package_entries: [],
    installed_at: '2026-07-24T10:01:00Z',
    updated_at: '2026-07-24T10:01:00Z',
  };
}

async function createBuiltDistServer({ accessReady = false, pluginInstallFlow = false, acceptorFactory = createAcceptor } = {}) {
  let baseURL = '';
  let installedPlugin = null;
  let releaseInstallOperation = null;
  let directArtifact = null;
  let acceptor = null;
  let acceptorFailure = null;
  let accepting = true;
  let acceptController = null;
  const acceptedSessions = new Set();
  const acceptedSessionTasks = new Set();
  let acceptingTask = Promise.resolve();
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
          plugin_session_credential: 'built-dist-plugin-session',
          channel_id: directArtifact.session.channel_id,
          connect_artifact: directArtifact,
        });
        return;
      }
      if (accessReady && requestURL.pathname === '/_redeven_proxy/api/ai/threads') {
        jsonResponse(response, { threads: [] });
        return;
      }
      if (accessReady && requestURL.pathname === '/_redeven_proxy/api/ai/readiness') {
        jsonResponse(response, {
          state: 'ready',
          reason_code: '',
          retryable: false,
          safe_to_retry: false,
          committed: false,
          rolled_back: false,
        });
        return;
      }
      if (requestURL.pathname === pluginMarketCatalogPath) {
        jsonResponse(response, { ok: true, data: builtPluginMarketSnapshot() });
        return;
      }
      if (requestURL.pathname === pluginMarketDetailPath) {
        jsonResponse(response, { ok: true, meta: { generation: 1 }, data: builtPluginMarketDetail() });
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
        jsonResponse(response, { ok: true, data: { plugins: installedPlugin ? [installedPlugin] : [] } });
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/permissions/query') {
        const body = await readJSONRequest(request);
        const expected = { active_only: true };
        if (JSON.stringify(body) !== JSON.stringify(expected)) {
          throw new Error(`unexpected active permissions request: ${JSON.stringify({ expected, actual: body })}`);
        }
        jsonResponse(response, { ok: true, data: { permissions: [] } });
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/security-policies/query') {
        jsonResponse(response, { ok: true, data: { security_policies: [] } });
        return;
      }
      if (requestURL.pathname === '/_redevplugin/api/plugins/permissions/requirements/query') {
        const body = await readJSONRequest(request);
        const expected = { plugin_instance_id: builtPluginInstanceID };
        if (JSON.stringify(body) !== JSON.stringify(expected)) {
          throw new Error(`unexpected permission requirements request: ${JSON.stringify({ expected, actual: body })}`);
        }
        jsonResponse(response, {
          ok: true,
          data: {
            plugin_instance_id: expected.plugin_instance_id,
            plugin_version: builtPluginReleaseRef.version,
            active_fingerprint: builtPluginPackageHashes.package_sha256,
            management_revision: 1,
            required_permissions: ['containers.read'],
            contracts: [],
          },
        });
        return;
      }
      if (pluginInstallFlow && requestURL.pathname === '/_redevplugin/api/plugins/release-install-operations') {
        const body = await readJSONRequest(request);
        const expected = {
          request_id: body.request_id,
          plugin_instance_id: builtPluginInstanceID,
          release_ref: builtPluginReleaseRef,
          activate_after_install: true,
        };
        if (!/^[0-9a-f-]{36}$/u.test(body.request_id)
          || JSON.stringify(body) !== JSON.stringify(expected)) {
          throw new Error(`unexpected plugin release install request: ${JSON.stringify({ expected, actual: body })}`);
        }
        releaseInstallOperation = {
          request_id: body.request_id,
          operation_id: 'release_install_built_renderer',
          plugin_instance_id: builtPluginInstanceID,
          request_sha256: 'a'.repeat(64),
          status: 'running',
          phase: 'download_package',
          progress: { kind: 'bytes', completed: 262144, total: 524288 },
          attempt: 1,
          retry_after_ms: 250,
          mutation_outcome: 'not_committed',
          activation: { status: 'pending' },
          phase_diagnostics: [],
          created_at: '2026-08-05T08:00:00Z',
          updated_at: '2026-08-05T08:00:01Z',
        };
        jsonResponse(response, { ok: true, data: releaseInstallOperation });
        return;
      }
      if (pluginInstallFlow
        && requestURL.pathname === '/_redevplugin/api/plugins/release-install-operations/release_install_built_renderer') {
        installedPlugin = builtPluginInstalledPlugin();
        releaseInstallOperation = {
          ...releaseInstallOperation,
          status: 'succeeded',
          phase: 'complete',
          progress: { kind: 'items', completed: 1, total: 1 },
          mutation_outcome: 'committed',
          plugin_record: installedPlugin,
          activation: {
            status: 'needs_attention',
            missing_permission_ids: ['containers.read'],
            next_action: 'approve_permissions',
          },
          updated_at: '2026-08-05T08:00:02Z',
          terminal_at: '2026-08-05T08:00:02Z',
        };
        jsonResponse(response, { ok: true, data: releaseInstallOperation });
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
      const fileHandle = await open(filePath, 'r');
      let data;
      try {
        const fileStat = await fileHandle.stat();
        if (!fileStat.isFile()) throw new Error(`not a file: ${normalizedRelativePath}`);
        data = await fileHandle.readFile();
      } finally {
        await fileHandle.close();
      }
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
  if (accessReady) {
    acceptor = await acceptorFactory({
      listeners: [{
        carrier: 'websocket',
        path: 'direct',
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: [new URL(baseURL).origin],
      }],
      maxInboundStreams: 64,
      authorize: async () => ({
        decision: 'allow',
        artifact: parseArtifact(JSON.stringify(directArtifact)),
      }),
      resolveHandlers: () => {
        const handlers = new SessionHandlers();
        handlers.handleRPC(4001, async () => ({ payload: { server_time_ms: Date.now() } }));
        handlers.handleRPC(4501, async () => ({ payload: { password_required: false, unlocked: true } }));
        handlers.handleRPC(4502, async () => ({ payload: { unlocked: true } }));
        handlers.handleRPC(5001, async () => ({ payload: { sessions: [] } }));
        handlers.handleRPC(2002, async () => ({ payload: { sessions: [] } }));
        return handlers;
      },
    });
    const acceptorAddress = acceptor.addresses()[0];
    if (!acceptorAddress) throw new Error('built Env App direct server did not publish an address');
    directArtifact = builtDistArtifact(
      `ws://127.0.0.1:${acceptorAddress.port}/flowersec/v2/direct`,
    );
    acceptController = new AbortController();
    acceptingTask = (async () => {
      while (accepting) {
        const accepted = await acceptor.accept({ signal: acceptController.signal });
        acceptedSessions.add(accepted);
        const acceptedSessionTask = accepted.serve()
          .catch(() => undefined)
          .finally(() => {
            acceptedSessions.delete(accepted);
            acceptedSessionTasks.delete(acceptedSessionTask);
          });
        acceptedSessionTasks.add(acceptedSessionTask);
      }
    })().catch((error) => {
      if (accepting) acceptorFailure = error;
    });
  }
  return {
    baseURL,
    close: async () => {
      accepting = false;
      acceptController?.abort();
      await acceptor?.close().catch(() => undefined);
      await acceptingTask;
      await Promise.all([...acceptedSessions].map((accepted) => accepted.close().catch(() => undefined)));
      await Promise.all([...acceptedSessionTasks]);
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (acceptorFailure) throw acceptorFailure;
    },
  };
}

async function verifyBuiltFlowerLifecycle(browser, tls) {
  const server = await createBuiltDistServer({ accessReady: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
  });
  await trustBuiltDistWebTransport(page, tls);
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
    const collapsedComposerBox = await composer.boundingBox();
    if (!collapsedComposerBox || collapsedComposerBox.width <= 0 || collapsedComposerBox.height <= 0) {
      throw new Error(`built Flower collapsed composer has invalid geometry: ${JSON.stringify(collapsedComposerBox)}`);
    }
    await page.evaluate(() => {
      globalThis.__redevenBuiltFlowerIdentity = {
        surface: globalThis.document.querySelector('#redeven-flower-surface'),
        composer: globalThis.document.querySelector('.flower-composer textarea'),
      };
    });

    await composer.click();
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
      collapsed_composer_width: collapsedComposerBox.width,
      collapsed_composer_height: collapsedComposerBox.height,
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

async function verifyBuiltPluginInstallRouting(browser, tls) {
  const server = await createBuiltDistServer({ accessReady: true, pluginInstallFlow: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
  });
  await trustBuiltDistWebTransport(page, tls);
  const pluginRequests = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (requestPath.startsWith('/_redevplugin/api/plugins')) {
      pluginRequests.push({
        method: request.method(),
        path: requestPath,
        payload: browserRequestPayload(request),
      });
    }
  });

  try {
    const entryURL = new URL(entryPath.slice(1), server.baseURL).toString();
    const runtimeRefreshResponse = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === 'POST'
        && new URL(request.url()).pathname === '/_redevplugin/api/plugins/runtime/refresh-enabled';
    }, { timeout: 10_000 });
    await page.goto(entryURL, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 10_000 });
    await runtimeRefreshResponse;

    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    const pluginCenterAction = page.locator('[data-plugin-center-market-action]');
    try {
      await pluginCenterAction.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (error) {
      throw new Error(`unlocked built Plugin Center action did not become visible: ${JSON.stringify({
        bodyText: (await page.locator('body').innerText()).slice(0, 2_000),
        pageErrors,
        pluginRequests,
      })}`, { cause: error });
    }
    await pluginCenterAction.click();

    const pluginCenter = page.locator('[data-plugin-center-view]');
    await pluginCenter.waitFor({ state: 'visible', timeout: 10_000 });
    await pluginCenter.locator('[data-plugin-center-list][aria-busy="false"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    const pluginItems = pluginCenter.locator('[data-plugin-center-item]');
    const pluginItemCount = await pluginItems.count();
    if (pluginItemCount !== 1) {
      throw new Error(`built plugin catalog item count = ${pluginItemCount}, expected 1`);
    }
    const pluginItem = pluginItems.first();
    await pluginItem.press('Enter');
    const pluginDetails = pluginCenter.locator('[data-plugin-center-details]');
    await pluginDetails.waitFor({ state: 'visible', timeout: 10_000 });
    await pluginDetails.getByText('This fixture exercises the signed plugin presentation path.', { exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 });
    const pluginInstall = pluginCenter.locator('[data-plugin-action="install"]');
    if (await pluginInstall.count() !== 1) {
      throw new Error(`built plugin Install action count = ${await pluginInstall.count()}, expected 1`);
    }
    // This static HTTP harness cannot complete the encrypted direct WebSocket
    // handshake, so management controls remain disabled even with admin access.
    // Enable only the located control to exercise the production click route.
    await pluginInstall.evaluate((button) => { button.disabled = false; });
    await pluginInstall.click();

    const installReview = page.locator('[data-plugin-install-review-dialog]');
    await installReview.waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-plugin-install-review-confirm]').click();
    await installReview.waitFor({ state: 'detached', timeout: 10_000 });
    await pluginCenter.locator('[data-plugin-center-list][aria-busy="false"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await pluginCenter.locator('#plugin-center-tab-installed').click();
    await pluginCenter.locator('[data-plugin-center-list][aria-busy="false"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    const installedPluginItem = pluginCenter.locator('[data-plugin-center-item]').first();
    try {
      await installedPluginItem.waitFor({ state: 'visible', timeout: 10_000 });
    } catch (error) {
      throw new Error(`built signed plugin install did not refresh inventory: ${JSON.stringify({
        pluginRequests,
        pluginCenterText: (await pluginCenter.innerText()).slice(0, 2_000),
        pageErrors,
      })}`, { cause: error });
    }
    await installedPluginItem.getByText('Needs attention', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await installedPluginItem.press('Enter');
    const installedDetails = pluginCenter.locator('[data-plugin-center-details]');
    await installedDetails.getByText('Official', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
    if (pluginRequests.some((request) => request.path.includes('/external-packages/'))) {
      throw new Error(`built plugin Install used external-package admission: ${JSON.stringify(pluginRequests)}`);
    }
    const normalizedPluginRequests = pluginRequests.map((request) => {
      const payload = request.payload != null
        && typeof request.payload === 'object'
        && !Array.isArray(request.payload)
        && typeof request.payload.request_id === 'string'
        && /^[0-9a-f-]{36}$/u.test(request.payload.request_id)
        ? { ...request.payload, request_id: ':requestID' }
        : request.payload;
      return {
        ...request,
        path: request.path.replace(
          /\/release-install-operations\/by-request\/[0-9a-f-]{36}$/u,
          '/release-install-operations/by-request/:requestID',
        ),
        payload,
      };
    });
    const requiredPluginRequests = [
      { method: 'POST', path: '/_redevplugin/api/plugins/runtime/refresh-enabled', payload: {} },
      { method: 'GET', path: '/_redevplugin/api/plugins/release-install-operations', payload: null },
      { method: 'POST', path: '/_redevplugin/api/plugins/catalog/query', payload: {} },
      {
        method: 'POST',
        path: '/_redevplugin/api/plugins/release-install-operations',
        payload: {
          request_id: ':requestID',
          plugin_instance_id: builtPluginInstanceID,
          release_ref: builtPluginReleaseRef,
          activate_after_install: true,
        },
      },
      {
        method: 'GET',
        path: '/_redevplugin/api/plugins/release-install-operations/release_install_built_renderer',
        payload: null,
      },
      { method: 'POST', path: '/_redevplugin/api/plugins/catalog/query', payload: {} },
      {
        method: 'POST',
        path: '/_redevplugin/api/plugins/permissions/requirements/query',
        payload: { plugin_instance_id: builtPluginInstanceID },
      },
      {
        method: 'POST',
        path: '/_redevplugin/api/plugins/permissions/grant',
        payload: {
          plugin_instance_id: builtPluginInstanceID,
          permission_id: 'containers.read',
          expected_policy_revision: 1,
          expected_management_revision: 1,
          expected_revoke_epoch: 0,
        },
      },
      { method: 'POST', path: '/_redevplugin/api/plugins/catalog/query', payload: {} },
      { method: 'POST', path: '/_redevplugin/api/plugins/permissions/query', payload: { active_only: true } },
      { method: 'POST', path: '/_redevplugin/api/plugins/security-policies/query', payload: {} },
      {
        method: 'POST',
        path: '/_redevplugin/api/plugins/permissions/requirements/query',
        payload: { plugin_instance_id: builtPluginInstanceID },
      },
      {
        method: 'GET',
        path: '/_redevplugin/api/plugins/release-install-operations/by-request/:requestID',
        payload: null,
      },
    ];
    let requestCursor = 0;
    for (const requiredRequest of requiredPluginRequests) {
      const requiredJSON = JSON.stringify(requiredRequest);
      const nextIndex = normalizedPluginRequests.findIndex(
        (request, index) => index >= requestCursor && JSON.stringify(request) === requiredJSON,
      );
      if (nextIndex < 0) {
        throw new Error(`built plugin Install omitted or reordered a required plugin request: ${JSON.stringify({
          missing: requiredRequest,
          after_index: requestCursor - 1,
          actual: normalizedPluginRequests,
        })}`);
      }
      requestCursor = nextIndex + 1;
    }
    const exactlyOnceRequests = new Set([
      'GET /_redevplugin/api/plugins/release-install-operations',
      'POST /_redevplugin/api/plugins/release-install-operations',
      'GET /_redevplugin/api/plugins/release-install-operations/release_install_built_renderer',
      'POST /_redevplugin/api/plugins/permissions/grant',
      'GET /_redevplugin/api/plugins/release-install-operations/by-request/:requestID',
    ]);
    for (const requestIdentity of exactlyOnceRequests) {
      const count = normalizedPluginRequests.filter(
        (request) => `${request.method} ${request.path}` === requestIdentity,
      ).length;
      if (count !== 1) {
        throw new Error(`built plugin Install request ${requestIdentity} count = ${count}, expected 1`);
      }
    }
    if (pageErrors.length > 0) throw new Error(`built plugin install page errors: ${JSON.stringify(pageErrors)}`);

    return {
      market_snapshot_loaded: true,
      installed_state: 'needs_attention_verified_after_permission_review',
      package_url: builtPluginPackageURL,
      release_install_operation_called: true,
      request_count: pluginRequests.length,
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

  const tls = await createBuiltDistTLS();
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

    await page.getByRole('heading', { name: 'Unlock local runtime', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 });
    const pluginPanelTileCount = await page.locator('[data-plugin-panel-tile]').count();
    if (pluginPanelTileCount !== 0) {
      throw new Error(`locked built Plugin panel tile count = ${pluginPanelTileCount}, expected 0`);
    }
    // Locked local sessions must not issue privileged plugin inventory requests.
    const expectedPluginRequests = [];
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
    const genericResourceConsoleProblems = consoleProblems.filter(({ type, text: messageText }) => (
      type === 'error'
      && messageText === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
    ));
    const unexpectedConsoleProblems = consoleProblems.filter((problem) => (
      !genericResourceConsoleProblems.includes(problem)
    ));
    const unexpectedBadResponses = badResponses;
    if (unexpectedConsoleProblems.length > 0) {
      throw new Error(`renderer console problems: ${JSON.stringify({
        consoleProblems: unexpectedConsoleProblems,
        badResponses: unexpectedBadResponses,
      })}`);
    }
    if (pageErrors.length > 0) throw new Error(`renderer page errors: ${JSON.stringify(pageErrors)}`);
    if (requestFailures.length > 0) throw new Error(`renderer request failures: ${JSON.stringify(requestFailures)}`);
    if (unexpectedBadResponses.length > 0) {
      throw new Error(`renderer HTTP failures: ${JSON.stringify(unexpectedBadResponses)}`);
    }

    const pluginInstall = await verifyBuiltPluginInstallRouting(browser, tls);
    const flowerLifecycle = await verifyBuiltFlowerLifecycle(browser, tls);

    report = {
      schema_version: 1,
      entry_path: entryPath,
      title,
      root: rootSnapshot,
      framework_overlay_count: overlayCount,
      plugin_ui: {
        locked_access_gate_visible: true,
        locked_panel_tile_count: pluginPanelTileCount,
        request_count: pluginRequests.length,
        plugin_install: pluginInstall,
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
    await tls.cleanup();
  }

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

export { createBuiltDistServer, createBuiltDistTLS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
