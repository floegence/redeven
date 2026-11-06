import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { request as requestHTTPS } from 'node:https';
import test from 'node:test';
import { parseArtifact } from '@floegence/flowersec-core';
import { assertProxyRuntimeScope } from '@floegence/flowersec-core/proxy';
import { createBuiltDistServer, createBuiltDistTLS } from './checkPackagedRenderer.mjs';

const packagedRendererSource = await readFile(new URL('./checkPackagedRenderer.mjs', import.meta.url), 'utf8');

function sha256Base64URL(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function requestTrustedJSON(url, certificate, body) {
  return new Promise((resolve, reject) => {
    const request = requestHTTPS(url, {
      method: 'POST',
      ca: certificate,
      headers: {
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('packaged renderer close terminates its published Flowersec Go peer', async () => {
  const tls = await createBuiltDistTLS();
  const server = await createBuiltDistServer({ accessReady: true, tls });
  try {
    await server.close();
    await assert.rejects(fetch(server.baseURL));
  } finally {
    await tls.cleanup();
  }
});

test('concurrent reconnect artifacts retire every owned smoke peer', async () => {
  const tls = await createBuiltDistTLS();
  const active = new Set();
  let nextID = 0;
  const server = await createBuiltDistServer({ accessReady: true, tls, renewPeerOnConnect: true,
    flowersecPeerFactory: async () => {
      const id = ++nextID;
      active.add(id);
      return { artifact: JSON.stringify({ session: { channel_id: `channel-${id}` } }), expires_at: '2099-01-01T00:00:00Z',
        close: async () => { await new Promise(resolve => setTimeout(resolve, 10)); active.delete(id); },
      };
    },
  });
  try {
    const request = () => requestTrustedJSON(new URL('/api/local/direct/connect_artifact', server.baseURL), tls.certificate, '{}');
    await request();
    await Promise.all([request(), request()]);
    assert.equal(active.size, 1, 'only the current peer remains owned');
  } finally { await server.close(); await tls.cleanup(); }
  assert.equal(active.size, 0, 'server cleanup retires all peers');
});

test('packaged renderer TLS cleanup removes its temporary credentials', async () => {
  const tls = await createBuiltDistTLS();
  await access(tls.directory);

  await tls.cleanup();

  await assert.rejects(access(tls.directory));
});

test('unlocked packaged renderer emits a current validated Floe acquisition envelope', async () => {
  const tls = await createBuiltDistTLS();
  const server = await createBuiltDistServer({ accessReady: true, tls });

  try {
    const response = await requestTrustedJSON(
      new URL('/api/local/direct/connect_artifact', server.baseURL),
      tls.certificate,
      '{}',
    );
    assert.equal(response.status, 200);
    const envelope = response.json();
    const origin = new URL(server.baseURL).origin;
    assert.equal(envelope.v, 1);
    assert.equal(envelope.channel_id, 'channel-1');
    assert.equal(envelope.spend_scope.launcher_origin, origin);
    assert.equal(envelope.spend_scope.runtime_origin, origin);
    assert.equal(envelope.spend_scope.app_origin, origin);
    assert.equal(envelope.spend_scope.artifact_digest_b64u, sha256Base64URL(envelope.connect_artifact));
    assert.equal(
      envelope.spend_scope.projection_digest_b64u,
      sha256Base64URL(envelope.critical_scope_projection_json),
    );
    assert.doesNotThrow(() => parseArtifact(envelope.connect_artifact));

    const projection = JSON.parse(envelope.critical_scope_projection_json);
    assert.deepEqual({
      scope: projection.scope,
      scope_version: projection.scope_version,
      critical: projection.critical,
    }, {
      scope: 'proxy.runtime',
      scope_version: 2,
      critical: true,
    });
    assert.deepEqual(assertProxyRuntimeScope(projection.payload), {
      mode: 'service_worker',
      appBasePath: '/_redeven_proxy/env/',
      http: {
        additionalPathPrefixes: ['/_redeven_proxy/api/', '/_redevplugin/api/plugins'],
        extraRequestHeaders: ['x-redevplugin-csrf', 'x-redevplugin-expected-management-revision'],
      },
      limits: { maxBodyBytes: 256 * 1024 * 1024 },
      serviceWorker: {
        scriptUrl: '/_redeven_proxy/env/_redeven_sw.js',
        scope: '/_redeven_proxy/env/',
      },
    });
  } finally {
    await server.close();
    await tls.cleanup();
  }
});

test('packaged renderer fixture uses repository-bound inspection and durable installation', async () => {
  const server = await createBuiltDistServer({ pluginInstallFlow: true });
  const post = async (route, body) => fetch(new URL(route, server.baseURL), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const snapshot = await (await fetch(new URL('/_redeven_proxy/api/plugins/market/catalog', server.baseURL))).json();
    const plugin = snapshot.data.plugins[0];
    assert.equal(plugin.plugin_id, 'github.repo.1289352675.metrics');
    assert.equal(plugin.publisher_id, 'github.repo.1289352675');
    assert.equal(plugin.source_kind, 'official');
    const preview = plugin.latest.install_preview;
    assert.equal(preview.release.source.repository_id, 1289352675);
    assert.equal(preview.release.publisher_id, plugin.publisher_id);
    assert.equal(preview.release.plugin_id, plugin.plugin_id);
    assert.equal(preview.release_ref, undefined);
    const request = {
      intent: { action: 'install' },
      expected_plugin_id: plugin.plugin_id,
      expected_publisher_id: plugin.publisher_id,
      expected_version: preview.release.version,
      expected_package_sha256: `sha256:${preview.release.package_sha256}`,
      expected_security_summary_sha256: preview.summary_sha256,
      expected_contract_set_sha256: preview.contract_set_sha256,
      source: { kind: 'github_repository', url: 'https://github.com/floegence/redeven-official-plugins',
        host: 'redeven', tag: 'metrics-v4.4.9', plugin_id: plugin.plugin_id,
        repository_id: '1289352675', release_id: '21', asset_id: '22' },
    };
    const badSource = await post('/_redevplugin/api/plugins/external-packages/inspect', {
      ...request, source: { ...request.source, repository_id: '42' },
    });
    assert.notEqual(badSource.status, 200);
    const inspected = await post('/_redevplugin/api/plugins/external-packages/inspect', request);
    assert.equal(inspected.status, 200);
    const inspection = (await inspected.json()).data;
    assert.equal(inspection.source_provenance.repository_id, '1289352675');
    const install = { request_id: '00000000-0000-4000-8000-000000000001',
      inspection_id: inspection.inspection_id, expected_package_sha256: inspection.inspected_hashes.package_sha256 };
    const wrongHash = await post('/_redevplugin/api/plugins/external-packages/install-operations', {
      ...install, expected_package_sha256: `sha256:${'0'.repeat(64)}`,
    });
    assert.notEqual(wrongHash.status, 200);
    const response = await post('/_redevplugin/api/plugins/external-packages/install-operations', install);
    assert.equal(response.status, 200);
    const result = (await response.json()).data;
    assert.equal(result.execution.execution_id, 'install_built_renderer');
    assert.equal(result.request_id, install.request_id);
    const recovered = await post('/_redevplugin/api/plugins/external-packages/install-operations/query', { request_id: install.request_id });
    const receipt = (await recovered.json()).data;
    assert.equal(receipt.mutation_outcome, 'committed');
    const catalog = await post('/_redevplugin/api/plugins/catalog/query', {});
    const record = (await catalog.json()).data.plugins[0];
    assert.equal(record.plugin_id, plugin.plugin_id);
    assert.equal(record.publisher_id, plugin.publisher_id);
    assert.equal(record.source_provenance.repository_id, '1289352675');
    assert.equal(record.trust_state, undefined);
  } finally { await server.close(); }
});

test('locked packaged renderer verifies the access gate without opening privileged plugin UI', () => {
  const lockedCheck = packagedRendererSource.slice(
    packagedRendererSource.indexOf('const lockedFlowerSurfaceCount'),
    packagedRendererSource.indexOf('const overlayCount'),
  );
  assert.match(lockedCheck, /getByRole\('heading', \{ name: 'Unlock local runtime'/u);
  assert.match(lockedCheck, /\[data-plugin-panel-tile\]/u);
  assert.doesNotMatch(lockedCheck, /pluginEntry\.click\(\)/u);
  assert.match(lockedCheck, /const expectedPluginRequests = \[\]/u);
  assert.doesNotMatch(packagedRendererSource, /pluginEntryCount/u);
});

test('unlocked packaged renderer starts the published Flowersec Go WSS peer', () => {
  assert.match(packagedRendererSource, /flowersec-smoke-peer/u);
  assert.match(packagedRendererSource, /GOWORK: 'off'/u);
  assert.match(packagedRendererSource, /--ignore-certificate-errors-spki-list/u);
  assert.doesNotMatch(packagedRendererSource, /@floegence\/flowersec-core\/node/u);
  assert.doesNotMatch(packagedRendererSource, /createAcceptor|new Issuer|authorizeRuntime/u);
});

test('unlocked packaged renderer opens Plugin Center through the empty launcher action', () => {
  const pluginInstallCheck = packagedRendererSource.slice(
    packagedRendererSource.indexOf('async function verifyBuiltPluginInstallRouting'),
    packagedRendererSource.indexOf('async function verifyBuiltPluginPresentation'),
  );
  assert.match(pluginInstallCheck, /\[data-plugin-center-market-action\]/u);
  assert.doesNotMatch(pluginInstallCheck, /\[data-plugin-panel-tile="plugin-center"\]/u);
  assert.match(pluginInstallCheck, /requiredPluginRequests/u);
  assert.match(pluginInstallCheck, /exactRequestCounts/u);
  assert.doesNotMatch(pluginInstallCheck, /JSON\.stringify\(normalizedPluginRequests\)\s*!==/u);
});

test('unlocked packaged renderer exercises current inspection and install receipt routes only', () => {
  assert.match(packagedRendererSource, /\/_redevplugin\/api\/plugins\/runtime\/recover-enabled/u);
  assert.match(packagedRendererSource, /external-packages\/inspect/u);
  assert.match(packagedRendererSource, /external-packages\/install-operations\/query/u);
  assert.match(packagedRendererSource, /external-packages\/install-operations\/list/u);
  assert.doesNotMatch(packagedRendererSource, /runtime\/refresh-enabled|executions\/release-installs|release_metadata_ref|signer_key_id|trust_assessment/u);
});
