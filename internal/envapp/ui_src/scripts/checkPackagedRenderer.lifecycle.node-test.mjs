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

test('packaged renderer close terminates its published Flowersec Go v3 peer', async () => {
  const tls = await createBuiltDistTLS();
  const server = await createBuiltDistServer({ accessReady: true, tls });
  try {
    await server.close();
    await assert.rejects(fetch(server.baseURL));
  } finally {
    await tls.cleanup();
  }
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

test('packaged renderer fixture submits the market preview directly to the install Execution', async () => {
  const server = await createBuiltDistServer({ pluginInstallFlow: true });
  const releaseRef = {
    source_id: 'redeven_official',
    channel: 'stable',
    release_metadata_ref: 'plugins/com.redeven.official/com.redeven.official.containers/4.4.9/release.json',
    release_metadata_sha256: '7f36244ce5fe5f80751051f1aa2adcb49d049eab2f748d751ae7021cbf074a15',
    publisher_id: 'com.redeven.official',
    plugin_id: 'com.redeven.official.containers',
    version: '4.4.9',
    expected_hashes: {
      package_sha256: 'sha256:954894fbc63c3490fe011c9a6baf8985258a3c9c98a16827ed8342aaf438ed32',
      manifest_sha256: 'sha256:ab8c23c53758bba5165fd4d50c7972e94791dd1ccff75de02c51c554767fb12b',
      entries_sha256: 'sha256:8b043db413f20ae08be6252f74bbd82fc17a82592192d40c9947a5fcb9983c0f',
    },
  };
  const installPreview = {
    release_ref: releaseRef,
    release_identity_digest: 'sha256:824e51f410a597845d546835e61271b8a530044c51e2d14a098eb847adf1e181',
    manifest_sha256: releaseRef.expected_hashes.manifest_sha256,
    contract_set_sha256: 'sha256:9229d7b5a76273a40818deb9fedb64ee83146cf11ec66edda20743c38eebd9ab',
    summary_sha256: 'sha256:ef067082e92647c5e5ab73787bc2f5e6d83ce9a60be56daf738293103e9d9673',
  };

  try {
    const response = await fetch(new URL('/_redevplugin/api/plugins/executions/release-installs', server.baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '00000000-0000-4000-8000-000000000001',
        plugin_instance_id: 'catalog_com.redeven.official_com.redeven.official.containers',
        ...installPreview,
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.data.execution_id, 'release_install_built_renderer');

    const mismatchedResponse = await fetch(new URL('/_redevplugin/api/plugins/executions/release-installs', server.baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '00000000-0000-4000-8000-000000000002',
        plugin_instance_id: 'catalog_com.redeven.official_com.redeven.official.containers',
        ...installPreview,
        release_ref: { ...releaseRef, version: '4.4.6' },
      }),
    });
    assert.notEqual(mismatchedResponse.status, 200);
  } finally {
    await server.close();
  }
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

test('unlocked packaged renderer starts the published Flowersec Go v3 WSS peer', () => {
  assert.match(packagedRendererSource, /flowersec-v3-smoke-peer/u);
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

test('unlocked packaged renderer exercises current Host recovery and Execution Event routes only', () => {
  assert.match(packagedRendererSource, /\/_redevplugin\/api\/plugins\/runtime\/recover-enabled/u);
  assert.match(packagedRendererSource, /\/_redevplugin\/api\/plugins\/executions\/release-installs/u);
  assert.match(packagedRendererSource, /\/executions\/release_install_built_renderer\/query/u);
  assert.match(packagedRendererSource, /\/executions\/release_install_built_renderer\/events\/query/u);
  assert.doesNotMatch(packagedRendererSource, /runtime\/refresh-enabled/u);
  assert.doesNotMatch(packagedRendererSource, /release-install-operations/u);
});
