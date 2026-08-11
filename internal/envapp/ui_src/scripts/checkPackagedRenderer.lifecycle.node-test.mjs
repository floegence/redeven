import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createBuiltDistServer, createBuiltDistTLS } from './checkPackagedRenderer.mjs';

function pendingAcceptAcceptor() {
  let resolveAccept;
  let rejectAccept;
  let closeCalls = 0;
  let signal;
  const acceptor = {
    address: () => ({ host: '127.0.0.1', port: 45678 }),
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
      address: () => ({ host: '127.0.0.1', port: 45678 }),
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
