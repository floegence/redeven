import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/main.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  write: false,
  plugins: [{
    name: 'containers-test-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^@floegence\/redevplugin-ui\/plugin$/ }, () => ({ path: 'bridge', namespace: 'test' }));
      builder.onResolve({ filter: /redeven\.container_resources\.v2\.client$/ }, () => ({ path: 'client', namespace: 'test' }));
      builder.onLoad({ filter: /^bridge$/, namespace: 'test' }, () => ({
        contents: `
          export class PluginBridgeClient {
            constructor() { return globalThis.__containersFixture.bridge; }
          }
        `,
        loader: 'js',
      }));
      builder.onLoad({ filter: /^client$/, namespace: 'test' }, () => ({
        contents: `
          export class RedevenContainerResourcesClient {
            status(request) { return globalThis.__containersFixture.client.status(request); }
            list(request) { return globalThis.__containersFixture.client.list(request); }
            start(request) { return globalThis.__containersFixture.client.start(request); }
            stop(request) { return globalThis.__containersFixture.client.stop(request); }
            restart(request) { return globalThis.__containersFixture.client.restart(request); }
            remove(request) { return globalThis.__containersFixture.client.remove(request); }
            tailLogs(request) { return globalThis.__containersFixture.client.tailLogs(request); }
          }
          export function isRedevenContainerResourcesBusinessError() { return false; }
        `,
        loader: 'js',
      }));
    },
  }],
});
const bundledSource = Buffer.from(bundle.outputFiles[0].contents).toString('utf8');
let moduleGeneration = 0;

test('serializes one container while allowing another container to run', { concurrency: false }, async () => {
  const first = operation('operation-a');
  const second = operation('operation-b');
  const fixture = await loadFixture({
    start: async ({ container_id: containerID }) => containerID === 'container-a' ? first.handle : second.handle,
  });

  fixture.action('start-container', 'container-a');
  fixture.action('start-container', 'container-a');
  fixture.action('start-container', 'container-b');
  await eventually(() => assert.deepEqual(fixture.startCalls, ['container-a', 'container-b']));
  await eventually(() => assert.match(fixture.renderedText(), /2 operations active/u));

  first.resolve('completed');
  second.resolve('completed');
  await eventually(() => assert.doesNotMatch(fixture.renderedText(), /operations active/u));
});

test('keeps an unknown submission locked and allows a proven not-committed retry', { concurrency: false }, async () => {
  let attempt = 0;
  const fixture = await loadFixture({
    start: async () => {
      attempt += 1;
      throw Object.assign(new Error('transport'), { mutationOutcome: attempt === 1 ? 'unknown' : 'not_committed' });
    },
  });

  fixture.action('start-container', 'container-a');
  await eventually(() => assert.match(fixture.renderedText(), /Submission uncertain/u));
  fixture.action('start-container', 'container-a');
  await settle();
  assert.equal(attempt, 1);

  const retryFixture = await loadFixture({
    start: async () => {
      throw Object.assign(new Error('not sent'), { mutationOutcome: 'not_committed' });
    },
  });
  retryFixture.action('start-container', 'container-a');
  await eventually(() => assert.equal(retryFixture.startCalls.length, 1));
  retryFixture.action('start-container', 'container-a');
  await eventually(() => assert.equal(retryFixture.startCalls.length, 2));
});

test('dispose aborts local observation without sending Host cancellation', { concurrency: false }, async () => {
  const active = operation('operation-dispose');
  const fixture = await loadFixture({ start: async () => active.handle });
  fixture.action('start-container', 'container-a');
  await eventually(() => assert.equal(fixture.startCalls.length, 1));
  fixture.dispose();
  await eventually(() => assert.equal(active.aborted(), true));
  assert.equal(active.cancelCalls(), 0);
});

test('dispose before submission returns never starts local observation or Host cancellation', { concurrency: false }, async () => {
  const active = operation('operation-late');
  let resolveSubmission;
  const submission = new Promise((resolve) => { resolveSubmission = resolve; });
  const fixture = await loadFixture({ start: async () => submission });
  fixture.action('start-container', 'container-a');
  await eventually(() => assert.equal(fixture.startCalls.length, 1));
  fixture.dispose();
  resolveSubmission(active.handle);
  await settle();
  await settle();
  assert.equal(active.waitCalls(), 0);
  assert.equal(active.cancelCalls(), 0);
});

test('keeps active operation details visible while inventory refreshes', { concurrency: false }, async () => {
  const active = operation('operation-refresh');
  const fixture = await loadFixture({ start: async () => active.handle });
  fixture.action('start-container', 'container-a');
  await eventually(() => assert.match(fixture.renderedText(), /Start · Running/u));
  fixture.action('refresh-containers');
  await eventually(() => {
    const rendered = fixture.renderedText();
    assert.match(rendered, /Active operations/u);
    assert.match(rendered, /Start · Running/u);
    assert.match(rendered, /Loading container resources/u);
  });
});

test('never repeats cancellation when the Host outcome is unknown', { concurrency: false }, async () => {
  const active = operation('operation-cancel', {
    cancelError: Object.assign(new Error('transport'), { mutationOutcome: 'unknown' }),
  });
  const fixture = await loadFixture({ start: async () => active.handle });
  fixture.action('start-container', 'container-a');
  await eventually(() => assert.match(fixture.renderedText(), /Start · Running/u));
  fixture.action('cancel-container-operation', 'container-a');
  await eventually(() => assert.match(fixture.renderedText(), /Cancellation uncertain/u));
  fixture.action('cancel-container-operation', 'container-a');
  await settle();
  assert.equal(active.cancelCalls(), 1);
});

test('resume retries terminal reconciliation and clears the recovered error', { concurrency: false }, async () => {
  const active = operation('operation-reconcile');
  let listCalls = 0;
  const fixture = await loadFixture({
    start: async () => active.handle,
    list: async ({ engine }, containers) => {
      listCalls += 1;
      if (listCalls === 2) throw new Error('inventory unavailable');
      return { engine, containers };
    },
  });
  fixture.action('start-container', 'container-a');
  await eventually(() => assert.match(fixture.renderedText(), /Start · Running/u));
  active.resolve('completed');
  await eventually(() => {
    const rendered = fixture.renderedText();
    assert.match(rendered, /Observation paused/u);
    assert.match(rendered, /operation finished, but the container state could not be reconciled/u);
  });
  fixture.action('resume-container-observation', 'container-a');
  await eventually(() => {
    const rendered = fixture.renderedText();
    assert.match(rendered, /authoritative state reconciled/u);
    assert.doesNotMatch(rendered, /could not be reconciled/u);
    assert.doesNotMatch(rendered, /operations active/u);
  });
});

async function loadFixture(overrides = {}) {
  const actions = new Map();
  const lifecycle = [];
  const renders = [];
  const startCalls = [];
  const containers = [container('container-a'), container('container-b')];
  const bridge = {
    ready: async () => undefined,
    onAction: (name, callback) => actions.set(name, callback),
    onLifecycle: (callback) => lifecycle.push(callback),
    render: async (tree) => { renders.push(tree); },
  };
  const client = {
    status: async ({ engine }) => ({ engine, available: true, engine_version: 'test' }),
    list: async (request) => overrides.list
      ? overrides.list(request, containers)
      : { engine: request.engine, containers },
    start: async (request) => {
      startCalls.push(request.container_id);
      return overrides.start(request);
    },
    stop: async () => { throw new Error('unexpected stop'); },
    restart: async () => { throw new Error('unexpected restart'); },
    remove: async () => { throw new Error('unexpected remove'); },
    tailLogs: async () => { throw new Error('unexpected logs'); },
  };
  globalThis.__containersFixture = { bridge, client };
  const source = `${bundledSource}\n//# sourceURL=containers-test-${++moduleGeneration}.mjs`;
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  await eventually(() => assert.equal(renders.length > 0, true));
  return {
    startCalls,
    action(name, value) {
      const callback = actions.get(name);
      assert.ok(callback, `missing action ${name}`);
      callback({ value });
    },
    dispose() {
      for (const callback of lifecycle) callback({ type: 'dispose' });
    },
    renderedText() {
      return textContent(renders.at(-1));
    },
  };
}

function operation(operationID, options = {}) {
  let resolveWait;
  let aborted = false;
  let cancelCalls = 0;
  let waitCalls = 0;
  const terminal = new Promise((resolve) => { resolveWait = resolve; });
  const handle = {
    operation_id: operationID,
    snapshot: async () => ({ operation_id: operationID, status: 'running' }),
    wait: ({ signal }) => new Promise((resolve, reject) => {
      waitCalls += 1;
      const onAbort = () => {
        aborted = true;
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      terminal.then(resolve, reject);
    }),
    cancel: async () => {
      cancelCalls += 1;
      if (options.cancelError) throw options.cancelError;
    },
  };
  return {
    handle,
    resolve(status) { resolveWait({ status, snapshot: { operation_id: operationID, status } }); },
    aborted: () => aborted,
    waitCalls: () => waitCalls,
    cancelCalls: () => cancelCalls,
  };
}

function container(containerID) {
  return {
    container_id: containerID,
    name: containerID,
    image: { reference: 'example:test', digest_pinned: false },
    state: 'stopped',
  };
}

function textContent(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text;
  return (node.children ?? []).map(textContent).join(' ');
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function eventually(assertion) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await settle();
    }
  }
  throw lastError;
}
