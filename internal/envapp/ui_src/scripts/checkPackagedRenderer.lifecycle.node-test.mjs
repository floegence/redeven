import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createBuiltDistServer, createBuiltDistTLS } from './checkPackagedRenderer.mjs';

const packagedRendererSource = await readFile(new URL('./checkPackagedRenderer.mjs', import.meta.url), 'utf8');

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

test('packaged renderer fixture inspects the exact official release before install confirmation', async () => {
  const server = await createBuiltDistServer({ pluginInstallFlow: true });
  const releaseRef = {
    source_id: 'redeven_official',
    channel: 'stable',
    release_metadata_ref: 'plugins/com.redeven.official/com.redeven.official.containers/4.4.4/release.json',
    release_metadata_sha256: 'a1c0c9391816a04ea9269664f86fc00d8814c401f8a1bcbf4c4a14472d783577',
    publisher_id: 'com.redeven.official',
    plugin_id: 'com.redeven.official.containers',
    version: '4.4.4',
    expected_hashes: {
      package_sha256: 'sha256:fdb81d456a11219fa3e5060b15ea55ad824790020c949dc17728ee8af18281a8',
      manifest_sha256: 'sha256:28c0e3c9548b9528c068605e34d26ffbc73ab6543b62dc8ad98078855d39cf1f',
      entries_sha256: 'sha256:33480ae1405e6ec1098cbeba1a559b83a021dae738de9da0fe5c9344fde3b177',
    },
  };

  try {
    const response = await fetch(new URL('/_redevplugin/api/plugins/release-packages/inspect', server.baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plugin_instance_id: 'catalog_com.redeven.official_com.redeven.official.containers',
        release_ref: releaseRef,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      data: {
        plugin_instance_id: 'catalog_com.redeven.official_com.redeven.official.containers',
        release_ref: releaseRef,
        inspected_hashes: releaseRef.expected_hashes,
        presentation: {
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
        },
        presentation_sha256: `sha256:${'1'.repeat(64)}`,
        security_summary: {
          summary_sha256: `sha256:${'2'.repeat(64)}`,
          permissions: [{ permission_id: 'containers.read', methods: ['containers.list'] }],
          methods: [],
          capability_contracts: [],
          workers: [],
          network: [],
          storage: [],
          secret_refs: [],
          core_actions: [],
          intents: [],
          surfaces: [],
        },
      },
    });

    const mismatchedResponse = await fetch(new URL('/_redevplugin/api/plugins/release-packages/inspect', server.baseURL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plugin_instance_id: 'catalog_com.redeven.official_com.redeven.official.containers',
        release_ref: { ...releaseRef, version: '4.4.3' },
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

test('unlocked packaged renderer uses the Flowersec 2.5.0 WebSocket Acceptor contract', () => {
  assert.match(packagedRendererSource, /listeners: \[\{[\s\S]*?carrier: 'websocket',[\s\S]*?path: 'direct'/u);
  assert.match(packagedRendererSource, /acceptor\.addresses\(\)\[0\]/u);
  assert.doesNotMatch(packagedRendererSource, /acceptor\.address\(\)/u);
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
  assert.match(pluginInstallCheck, /exactlyOnceRequests/u);
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
