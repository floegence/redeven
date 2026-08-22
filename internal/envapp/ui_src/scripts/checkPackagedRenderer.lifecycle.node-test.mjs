import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseArtifact } from '@floegence/flowersec-core';
import { assertProxyRuntimeScope } from '@floegence/flowersec-core/proxy';
import { createBuiltDistServer, createBuiltDistTLS } from './checkPackagedRenderer.mjs';

const packagedRendererSource = await readFile(new URL('./checkPackagedRenderer.mjs', import.meta.url), 'utf8');

function sha256Base64URL(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function pendingAcceptAcceptor() {
  let resolveAccept;
  let rejectAccept;
  let closeCalls = 0;
  let signal;
  const acceptor = {
    addresses: () => [{ host: '127.0.0.1', port: 45678 }],
    accept(options = {}) {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        resolveAccept = resolve;
        rejectAccept = reject;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    async close() {
      closeCalls += 1;
    },
  };
  return {
    acceptor,
    get signal() { return signal; },
    get closeCalls() { return closeCalls; },
    release() {
      resolveAccept?.({
        close: async () => undefined,
        serve: async () => undefined,
      });
    },
    abort(reason = new Error('test abort')) {
      rejectAccept?.(reason);
    },
  };
}

function resolvedAcceptAcceptor() {
  let acceptCalls = 0;
  let closeCalls = 0;
  let sessionCloseCalls = 0;
  let resolveAccept;
  let resolveServe;
  const accepted = {
    async close() {
      sessionCloseCalls += 1;
      resolveServe();
    },
    serve() {
      return new Promise((resolve) => {
        resolveServe = resolve;
      });
    },
  };
  return {
    acceptor: {
      addresses: () => [{ host: '127.0.0.1', port: 45678 }],
      accept(options = {}) {
        acceptCalls += 1;
        return new Promise((resolve, reject) => {
          if (acceptCalls === 1) resolveAccept = () => resolve(accepted);
          options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      },
      async close() {
        closeCalls += 1;
      },
    },
    releaseAccepted() { resolveAccept(); },
    get acceptCalls() { return acceptCalls; },
    get closeCalls() { return closeCalls; },
    get sessionCloseCalls() { return sessionCloseCalls; },
  };
}

test('packaged renderer close aborts a pending Flowersec accept loop and releases all resources', async () => {
  const pending = pendingAcceptAcceptor();
  const server = await createBuiltDistServer({
    accessReady: true,
    tls: { certificate: 'test-certificate', privateKey: 'test-private-key' },
    acceptorFactory: async () => pending.acceptor,
  });

  const closePromise = server.close();
  let timer;
  const closeResult = await Promise.race([
    closePromise.then(() => 'closed'),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve('timed_out'), 100);
    }),
  ]);
  clearTimeout(timer);

  try {
    assert.equal(closeResult, 'closed');
    assert.ok(pending.signal, 'close must provide an abort signal to accept');
    assert.equal(pending.signal.aborted, true);
    assert.equal(pending.closeCalls, 1);
    await assert.rejects(fetch(server.baseURL));
  } finally {
    pending.release();
    pending.abort();
    await closePromise;
  }
});

test('packaged renderer close releases a session accepted during shutdown', async () => {
  const resolved = resolvedAcceptAcceptor();
  const server = await createBuiltDistServer({
    accessReady: true,
    tls: { certificate: 'test-certificate', privateKey: 'test-private-key' },
    acceptorFactory: async () => resolved.acceptor,
  });

  resolved.releaseAccepted();
  await server.close();

  assert.equal(resolved.closeCalls, 1);
  assert.equal(resolved.acceptCalls, 1);
  assert.equal(resolved.sessionCloseCalls, 1);
  await assert.rejects(fetch(server.baseURL));
});

test('packaged renderer TLS cleanup removes its temporary credentials', async () => {
  const tls = await createBuiltDistTLS();
  await access(tls.directory);

  await tls.cleanup();

  await assert.rejects(access(tls.directory));
});

test('unlocked packaged renderer emits a current validated Floe acquisition envelope', async () => {
  const server = await createBuiltDistServer({ accessReady: true });

  try {
    const response = await fetch(new URL('/api/local/direct/connect_artifact', server.baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    const envelope = await response.json();
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
  }
});

test('packaged renderer fixture submits the market preview directly to the install Execution', async () => {
  const server = await createBuiltDistServer({ pluginInstallFlow: true });
  const releaseRef = {
    source_id: 'redeven_official',
    channel: 'stable',
    release_metadata_ref: 'plugins/com.redeven.official/com.redeven.official.containers/4.4.7/release.json',
    release_metadata_sha256: '5128bda8747edf7936a16c643beb55fc84f8627f5bb1bcb185a0fc1d68dd0011',
    publisher_id: 'com.redeven.official',
    plugin_id: 'com.redeven.official.containers',
    version: '4.4.7',
    expected_hashes: {
      package_sha256: 'sha256:5d7295d070cc4eff4054ec5f241d7977f0a0a7841b2f984d5d0fff8192eba86d',
      manifest_sha256: 'sha256:20b785d6455a7d16d35304ad6026259a39f5f0fa75890bcd0e1db470c8b3fdb4',
      entries_sha256: 'sha256:79d852072629b98eafbfc6787ab97535fbd6b9f3fe7c32db06893e3fd40e463c',
    },
  };
  const installPreview = {
    release_ref: releaseRef,
    release_identity_digest: 'sha256:81e99dfc0d9e79690ce3b8ade87dd4f609b43f6159e3b2d1f4735e2f7788827a',
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

test('unlocked packaged renderer uses the Flowersec 2.5.2 WebSocket Acceptor contract', () => {
  assert.match(packagedRendererSource, /listeners: \[\{[\s\S]*?carrier: 'websocket',[\s\S]*?path: 'direct'/u);
  assert.match(packagedRendererSource, /acceptor\.addresses\(\)\[0\]/u);
  assert.match(packagedRendererSource, /new Issuer\(\)\.issueDirect/u);
  assert.match(packagedRendererSource, /authorizeRuntime\(request, directAuthorizationRecord/u);
  assert.doesNotMatch(packagedRendererSource, /acceptor\.address\(\)/u);
  assert.doesNotMatch(packagedRendererSource, /contract_hash_b64u/u);
  assert.doesNotMatch(packagedRendererSource, /flowersec\/webtransport\/v2\/direct/u);
  assert.doesNotMatch(packagedRendererSource, /createBuiltDistServer\(\{[^}]*\btls\b/u);
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
