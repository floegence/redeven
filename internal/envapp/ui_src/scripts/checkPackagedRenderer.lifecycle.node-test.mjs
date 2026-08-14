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

test('unlocked packaged renderer uses the Flowersec 2.4.1 WebSocket Acceptor contract', () => {
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
