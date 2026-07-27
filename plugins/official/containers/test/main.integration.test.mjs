import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build, stop } from 'esbuild';
import { validatePluginUITree } from '../node_modules/@floegence/redevplugin-ui/dist/ui-patch-validator.js';

const bundle = await build({
  entryPoints: [new URL('../src/main.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  write: false,
  plugins: [{
    name: 'containers-v3-test-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^@floegence\/redevplugin-ui\/plugin$/ }, () => ({ path: 'bridge', namespace: 'test' }));
      builder.onResolve({ filter: /redeven\.container_resources\.v3\.client$/ }, () => ({ path: 'client', namespace: 'test' }));
      builder.onLoad({ filter: /^bridge$/, namespace: 'test' }, () => ({
        contents: `export class PluginBridgeClient { constructor() { return globalThis.__containersFixture.bridge; } }`,
        loader: 'js',
      }));
      builder.onLoad({ filter: /^client$/, namespace: 'test' }, () => ({
        contents: `
          export class RedevenContainerResourcesV3Client {
            constructor() { return globalThis.__containersFixture.client; }
          }
          export function isRedevenContainerResourcesV3BusinessError() { return false; }
        `,
        loader: 'js',
      }));
    },
  }],
});
const bundledSource = Buffer.from(bundle.outputFiles[0].contents).toString('utf8');
let moduleGeneration = 0;

after(() => stop());

test('switches across Containers, Images, and Volumes with local search', { concurrency: false }, async (t) => {
  const fixture = await loadFixture();
  t.after(() => fixture.dispose());
  assert.match(fixture.text(), /container-a/u);

  fixture.action('select-view', { value: 'images' });
  await eventually(() => assert.match(fixture.text(), /ghcr\.io\/example\/api:latest/u));
  fixture.action('filter-resources', { value: 'missing' });
  await eventually(() => assert.match(fixture.text(), /No matching images/u));

  fixture.action('select-view', { value: 'volumes' });
  await eventually(() => assert.match(fixture.text(), /app-data/u));
  assert.deepEqual(fixture.calls.listImages, ['docker']);
  assert.deepEqual(fixture.calls.listVolumes, ['docker']);
});

test('matches only the current localized container state', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    list: async ({ engine }) => ({ engine, containers: [
      { ...container('container-a-running'), state: 'running' },
      { ...container('container-b-paused'), state: 'paused' },
      { ...container('container-c-stopped'), state: 'stopped' },
    ] }),
  });
  t.after(() => fixture.dispose());
  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 2,
    appearance: { color_scheme: 'light', colors: contextColors() },
    locale: { language_tag: 'zh-CN', direction: 'ltr' },
  });

  for (const [query, expected, excluded] of [
    ['运行中', 'container-a-running', ['container-b-paused', 'container-c-stopped']],
    ['已暂停', 'container-b-paused', ['container-a-running', 'container-c-stopped']],
    ['已停止', 'container-c-stopped', ['container-a-running', 'container-b-paused']],
  ]) {
    fixture.action('filter-resources', { value: query });
    await eventually(() => {
      const text = fixture.text();
      assert.match(text, new RegExp(expected, 'u'));
      for (const name of excluded) assert.doesNotMatch(text, new RegExp(name, 'u'));
    });
  }
});

test('creates a container only after exact preflight plan review', { concurrency: false }, async (t) => {
  const active = pendingOperation('create-operation');
  const fixture = await loadFixture({ createOperation: active.handle });
  t.after(() => fixture.dispose());
  fixture.action('open-create-container');
  fixture.action('submit-create-container', { form_data: { name: 'api', image: 'ghcr.io/example/api:latest', command_1: 'serve', env_key_1: 'MODE', env_value_1: 'prod', restart_policy: 'unless-stopped', network_mode: 'bridge' } });
  await eventually(() => {
    assert.match(fixture.text(), /Review container creation/u);
    assert.match(fixture.text(), /sha256:create-plan/u);
    assert.equal(fixture.calls.create.length, 0);
  });
  fixture.action('confirm-plan');
  await eventually(() => assert.equal(fixture.calls.create.length, 1));
  assert.deepEqual(fixture.calls.create[0], {
    engine: 'docker', image: 'ghcr.io/example/api:latest', name: 'api', command: ['serve'],
    env: ['MODE=prod'], restart_policy: 'unless-stopped', network_mode: 'bridge', privileged: false,
  });
  await eventually(() => assert.match(fixture.text(), /Pulling layers|Running/u));
});

test('previews authoritative prune plans without injecting display digests into execution params', { concurrency: false }, async (t) => {
  const imageOperation = pendingOperation('prune-images-operation');
  const volumeOperation = pendingOperation('prune-volumes-operation');
  const fixture = await loadFixture({ pruneImagesOperation: imageOperation.handle, pruneVolumesOperation: volumeOperation.handle });
  t.after(() => fixture.dispose());

  fixture.action('select-view', { value: 'images' });
  await eventually(() => assert.match(fixture.text(), /Pull image/u));
  fixture.action('prune-images');
  await eventually(() => assert.match(fixture.text(), /sha256:image-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => assert.deepEqual(fixture.calls.pruneImages, [{ engine: 'docker', resource_identities: ['sha256:image-a'] }]));

  fixture.action('select-view', { value: 'volumes' });
  await eventually(() => assert.match(fixture.text(), /Create volume/u));
  fixture.action('prune-volumes');
  await eventually(() => assert.match(fixture.text(), /sha256:volume-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => assert.deepEqual(fixture.calls.pruneVolumes, [{ engine: 'docker', resource_identities: ['cache-data'] }]));
});

test('builds structured repeatable container fields without private text syntax', { concurrency: false }, async (t) => {
  const fixture = await loadFixture();
  t.after(() => fixture.dispose());
  fixture.action('open-create-container');
  await eventually(() => {
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'env_key_1'));
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'ports_container_port_1'));
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'mounts_target_1'));
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'devices_host_1'));
    assert.equal(findNodes(fixture.tree(), (node) => node.tag === 'textarea' && ['env', 'ports', 'mounts', 'devices'].includes(node.attributes?.name)).length, 0);
  });
  fixture.action('add-form-row', { value: 'command' });
  fixture.action('add-form-row', { value: 'env' });
  await eventually(() => {
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'command_2'));
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.name === 'env_key_3'));
  });
  fixture.action('submit-create-container', { form_data: {
    name: 'api', image: 'ghcr.io/example/api:latest', command_1: 'serve', command_2: '--message=hello world',
    env_key_1: 'MODE', env_value_1: 'prod', env_key_3: 'EMPTY_VALUE', env_value_3: '',
    ports_host_ip_1: '127.0.0.1', ports_host_port_1: '8080', ports_container_port_1: '80', ports_protocol_1: 'tcp',
    mounts_type_1: 'volume', mounts_source_1: 'app-data', mounts_target_1: '/var/lib/app', mounts_readonly_1: 'on',
    devices_host_1: '/dev/dri', devices_container_1: '/dev/dri', devices_permissions_1: 'rw',
  } });
  await eventually(() => {
    assert.match(fixture.text(), /Review container creation/u);
    const confirm = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'confirm-plan');
    assert.equal(confirm.attributes.disabled, false);
  });
  fixture.action('confirm-plan');
  await eventually(() => assert.equal(fixture.calls.create.length, 1));
  assert.deepEqual(fixture.calls.create[0].command, ['serve', '--message=hello world']);
  assert.deepEqual(fixture.calls.create[0].env, ['MODE=prod', 'EMPTY_VALUE=']);
  assert.deepEqual(fixture.calls.create[0].ports, [{ host_ip: '127.0.0.1', host_port: 8080, container_port: 80, protocol: 'tcp' }]);
  assert.deepEqual(fixture.calls.create[0].mounts, [{ type: 'volume', source: 'app-data', target: '/var/lib/app', read_only: true }]);
  assert.deepEqual(fixture.calls.create[0].devices, [{ host_path: '/dev/dri', container_path: '/dev/dri', permissions: 'rw' }]);
});

test('marks partial references unverified and disables destructive image actions', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({ listImages: async ({ engine }) => ({ engine, images: [{ ...image('sha256:image-a'), referenced_containers: 0 }], partial_failure_count: 1 }) });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  await eventually(() => {
    assert.match(fixture.text(), /Not verified/u);
    const remove = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'image-remove');
    const prune = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'prune-images');
    assert.equal(remove.attributes.disabled, true);
    assert.equal(prune.attributes.disabled, true);
  });
});

test('keeps a prune locked when failed terminal reconciliation is partial', { concurrency: false }, async (t) => {
  const planned = ['sha256:image-a', 'sha256:image-b'];
  const fixture = await loadFixture({
    listImages: async ({ engine, call }) => ({ engine, images: call === 1 ? [image(planned[0]), image(planned[1])] : [image(planned[1])], partial_failure_count: 0 }),
    pruneImagesPlan: { ...plan('images.prune', 'sha256:image-prune'), target: { resource_identities: planned, resource_count: 2 } },
    pruneImagesOperation: terminalOperation('failed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('prune-images');
  await eventually(() => assert.match(fixture.text(), /sha256:image-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => {
    assert.match(fixture.text(), /Reconciliation found 1 removed and 1 still present/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'));
  });
});

test('unlocks a failed prune when exact inventory proves no mutation', { concurrency: false }, async (t) => {
  const planned = ['sha256:image-a', 'sha256:image-b'];
  const fixture = await loadFixture({
    listImages: async ({ engine }) => ({ engine, images: planned.map(image), partial_failure_count: 0 }),
    pruneImagesPlan: { ...plan('images.prune', 'sha256:image-prune'), target: { resource_identities: planned, resource_count: 2 } },
    pruneImagesOperation: terminalOperation('failed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('prune-images');
  await eventually(() => assert.match(fixture.text(), /sha256:image-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => assert.match(fixture.text(), /Reconciliation found 0 removed and 2 still present/u));
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'), undefined));
});

test('unlocks a failed prune when exact inventory proves every planned image was removed', { concurrency: false }, async (t) => {
  const planned = ['sha256:image-a', 'sha256:image-b'];
  const fixture = await loadFixture({
    listImages: async ({ engine, call }) => ({ engine, images: call === 1 ? planned.map((identity) => image(identity)) : [], partial_failure_count: 0 }),
    pruneImagesPlan: { ...plan('images.prune', 'sha256:image-prune'), target: { resource_identities: planned, resource_count: 2 } },
    pruneImagesOperation: terminalOperation('failed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('prune-images');
  await eventually(() => assert.match(fixture.text(), /sha256:image-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => assert.match(fixture.text(), /Reconciliation found 2 removed and 0 still present/u));
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'), undefined));
});

test('keeps a mutation locked when terminal refresh cannot replace stale inventory', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    status: async ({ engine, call }) => {
      if (call > 1) throw new Error('status unavailable');
      return { engine, available: true, engine_version: 'test' };
    },
    pullOperation: terminalOperation('completed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/api:latest' } });
  await eventually(() => {
    assert.match(fixture.text(), /The operation ended, but authoritative inventory could not be refreshed/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'));
  });
});

test('resumes exact reconciliation after a transient inventory failure', { concurrency: false }, async (t) => {
  const target = 'ghcr.io/example/recovered:latest';
  const fixture = await loadFixture({
    status: async ({ engine, call }) => {
      if (call === 2) throw new Error('status temporarily unavailable');
      return { engine, available: true, engine_version: 'test' };
    },
    listImages: async ({ engine, call }) => ({
      engine,
      images: call === 1 ? [image()] : [image(), { ...image('sha256:recovered'), reference: target }],
    }),
    pullOperation: terminalOperation('completed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: target } });
  await eventually(() => {
    assert.match(fixture.text(), /authoritative inventory could not be refreshed/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'resume-operation'));
  });
  fixture.action('resume-operation', { value: `pull:docker:${target}` });
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'), undefined));
  assert.equal(fixture.calls.status.length, 3);
});

test('keeps a mutation locked when terminal refresh is superseded in flight', { concurrency: false }, async (t) => {
  let resolveTerminalStatus;
  const fixture = await loadFixture({
    status: async ({ engine, call }) => {
      if (call === 1) return { engine, available: true, engine_version: 'test' };
      if (call === 2) return new Promise((resolve) => { resolveTerminalStatus = () => resolve({ engine, available: true, engine_version: 'terminal' }); });
      return new Promise(() => undefined);
    },
    pullOperation: terminalOperation('completed'),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/api:latest' } });
  await eventually(() => assert.equal(fixture.calls.status.length, 2));
  fixture.action('refresh-resources');
  await eventually(() => assert.equal(fixture.calls.status.length, 3));
  resolveTerminalStatus();
  await eventually(() => {
    assert.match(fixture.text(), /The operation ended, but authoritative inventory could not be refreshed/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.class === 'operations'));
  });
});

test('rerenders localized copy and search on context revisions with fallback', { concurrency: false }, async (t) => {
  const fixture = await loadFixture();
  t.after(() => fixture.dispose());
  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 2,
    appearance: { color_scheme: 'dark', colors: contextColors() },
    locale: { language_tag: 'zh-CN', direction: 'ltr' },
  });
  await eventually(() => {
    const root = fixture.tree();
    assert.equal(root.attributes.lang, 'zh-CN');
    assert.match(fixture.text(), /运行时资源/u);
    assert.match(fixture.text(), /创建容器/u);
  });
  fixture.action('filter-resources', { value: '容器' });
  await eventually(() => assert.match(fixture.text(), /container-a/u));

  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 3,
    appearance: { color_scheme: 'dark', colors: contextColors() },
    locale: { language_tag: 'ar-SA', direction: 'rtl' },
  });
  await eventually(() => {
    const root = fixture.tree();
    assert.equal(root.attributes.lang, 'ar-SA');
    assert.equal(root.attributes.dir, 'rtl');
    assert.match(fixture.text(), /Runtime resources/u);
  });
});

test('rerenders open plans and active operations without leaking known Host English', { concurrency: false }, async (t) => {
  const active = pendingOperation('localized-operation', 'running');
  const finalizing = pendingOperation('finalizing-operation', 'finalizing');
  const fixture = await loadFixture({ pullOperation: active.handle, createPlan: { ...plan('containers.create', 'sha256:create-plan'), risk_flags: knownRiskFlags() } });
  t.after(() => fixture.dispose());

  fixture.action('open-create-container');
  fixture.action('submit-create-container', { form_data: { name: 'api', image: 'ghcr.io/example/api:latest' } });
  await eventually(() => assert.match(fixture.text(), /Review container creation/u));
  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 2,
    appearance: { color_scheme: 'light', colors: contextColors() },
    locale: { language_tag: 'zh-CN', direction: 'ltr' },
  });
  await eventually(() => {
    const text = fixture.text();
    assert.match(text, /核对容器创建方案/u);
    assert.match(text, /使用已核对的配置创建容器/u);
    assert.match(text, /特权容器/u);
    assert.match(text, /广泛的主机级权限/u);
    assert.equal(findNodes(fixture.tree(), (node) => node.tag === 'li' && String(node.attributes?.class ?? '').startsWith('risk-')).length, 13);
    assert.doesNotMatch(text, /Create the container with the reviewed configuration|Privileged container|Host network namespace|Host PID namespace|Host IPC namespace|Host device access|Added Linux capabilities|Container engine socket mount|Host bind mount|Sensitive mount path|Secret-like|Persistent restart policy|Image is not digest-pinned|broad host-level privileges/u);
  });

  fixture.action('close-dialog');
  fixture.action('select-view', { value: 'images' });
  await eventually(() => assert.match(fixture.text(), /拉取镜像/u));
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/new:latest' } });
  await eventually(() => assert.match(fixture.text(), /正在执行操作/u));
  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 3,
    appearance: { color_scheme: 'dark', colors: contextColors() },
    locale: { language_tag: 'de-DE', direction: 'ltr' },
  });
  await eventually(() => {
    const text = fixture.text();
    assert.match(text, /Vorgang wird ausgeführt/u);
    assert.match(text, /ghcr\.io\/example\/new:latest herunterladen/u);
    assert.doesNotMatch(text, /Running operation|Pull ghcr\.io/u);
  });

  fixture.setPullOperation(finalizing.handle);
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/final:latest' } });
  await eventually(() => {
    assert.match(fixture.text(), /Änderungen werden abgeschlossen/u);
    assert.doesNotMatch(fixture.text(), /Finalizing changes/u);
  });
});

test('keeps Host title and detail for an unknown risk flag', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    createPlan: {
      ...plan('containers.create', 'sha256:unknown-risk'),
      risk_flags: [{ id: 'future_host_risk', severity: 'medium', title: 'Future Host risk', detail: 'Future Host detail.' }],
    },
  });
  t.after(() => fixture.dispose());
  fixture.context({
    schema_version: 'redevplugin.surface_context.v1', revision: 2,
    appearance: { color_scheme: 'light', colors: contextColors() },
    locale: { language_tag: 'zh-CN', direction: 'ltr' },
  });
  fixture.action('open-create-container');
  fixture.action('submit-create-container', { form_data: { name: 'api', image: 'ghcr.io/example/api:latest' } });
  await eventually(() => {
    assert.match(fixture.text(), /Future Host risk/u);
    assert.match(fixture.text(), /Future Host detail\./u);
  });
});

test('renders released operation progress without resizing resource rows', { concurrency: false }, async (t) => {
  const active = pendingOperation('pull-operation');
  const fixture = await loadFixture({ pullOperation: active.handle });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  await eventually(() => assert.match(fixture.text(), /Pull image/u));
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/new:latest' } });
  await eventually(() => {
    assert.match(fixture.text(), /Pull ghcr\.io\/example\/new:latest/u);
    assert.match(fixture.text(), /Pulling layers/u);
    const progress = findNode(fixture.tree(), (node) => node.tag === 'progress');
    assert.equal(progress.attributes.value, 2);
    assert.equal(progress.attributes.max, 5);
  });
  const cancel = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'cancel-operation');
  assert.equal(cancel.attributes.value, 'pull:docker:ghcr.io/example/new:latest');
  fixture.action('cancel-operation', { value: cancel.attributes.value });
  await eventually(() => assert.equal(active.cancelCalls(), 1));
});

test('aborts local observation without canceling Host work on surface disposal', { concurrency: false }, async () => {
  let waitSignal;
  let snapshotSignal;
  let cancelCalls = 0;
  const operation = {
    operation_id: 'dispose-operation', data: {},
    snapshot: async ({ signal }) => {
      snapshotSignal = signal;
      return { operation_id: 'dispose-operation', status: 'running', cancelable: true, created_at: '', updated_at: '', retry_after_ms: 500 };
    },
    wait: async ({ signal }) => {
      waitSignal = signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('observation aborted')), { once: true }));
    },
    cancel: async () => { cancelCalls += 1; },
  };
  const fixture = await loadFixture({ pullOperation: operation });
  fixture.action('select-view', { value: 'images' });
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/dispose:latest' } });
  await eventually(() => {
    assert.ok(waitSignal);
    assert.ok(snapshotSignal);
  });
  fixture.dispose();
  await eventually(() => {
    assert.equal(waitSignal.aborted, true);
    assert.equal(snapshotSignal.aborted, true);
  });
  assert.equal(cancelCalls, 0);
});

async function loadFixture(overrides = {}) {
  const actions = new Map();
  const lifecycle = [];
  const contexts = [];
  const renders = [];
  const renderErrors = [];
  let surfaceContext = defaultContext();
  let currentPullOperation = overrides.pullOperation;
  const calls = { status: [], listImages: [], listVolumes: [], create: [], pruneImages: [], pruneVolumes: [] };
  const bridge = {
    ready: async () => undefined,
    context: () => surfaceContext,
    onContext: (callback) => { contexts.push(callback); return () => undefined; },
    onAction: (name, callback) => { actions.set(name, callback); return () => undefined; },
    onLifecycle: (callback) => { lifecycle.push(callback); return () => undefined; },
    render: async (tree) => {
      try { renders.push(validatePluginUITree(tree)); }
      catch (error) { renderErrors.push(error); throw error; }
    },
  };
  const client = {
    status: async ({ engine }) => { calls.status.push(engine); return overrides.status ? overrides.status({ engine, call: calls.status.length }) : { engine, available: true, engine_version: 'test' }; },
    list: async ({ engine }) => overrides.list ? overrides.list({ engine }) : ({ engine, containers: [container('container-a'), container('container-b')] }),
    listImages: async ({ engine }) => { calls.listImages.push(engine); return overrides.listImages ? overrides.listImages({ engine, call: calls.listImages.length }) : { engine, images: [image()] }; },
    listVolumes: async ({ engine }) => { calls.listVolumes.push(engine); return overrides.listVolumes ? overrides.listVolumes({ engine, call: calls.listVolumes.length }) : { engine, volumes: [volume()] }; },
    createPreflight: async () => overrides.createPlan ?? plan('containers.create', 'sha256:create-plan'),
    create: async (request) => { calls.create.push(request); return overrides.createOperation ?? pendingOperation('default-create').handle; },
    pruneImagesPreflight: async () => overrides.pruneImagesPlan ?? ({ ...plan('images.prune', 'sha256:image-prune'), target: { resource_identities: ['sha256:image-a'], resource_count: 1 } }),
    pruneImages: async (request) => { calls.pruneImages.push(request); return overrides.pruneImagesOperation ?? pendingOperation('default-images').handle; },
    pruneVolumesPreflight: async () => ({ ...plan('volumes.prune', 'sha256:volume-prune'), target: { resource_identities: ['cache-data'], resource_count: 1 } }),
    pruneVolumes: async (request) => { calls.pruneVolumes.push(request); return overrides.pruneVolumesOperation ?? pendingOperation('default-volumes').handle; },
    pullImage: async () => currentPullOperation ?? pendingOperation('default-pull').handle,
    startPreflight: async () => plan('containers.start', 'sha256:start'),
    removePreflight: async () => plan('containers.remove', 'sha256:remove'),
    createVolumePreflight: async () => plan('volumes.create', 'sha256:create-volume'),
    removeVolumePreflight: async () => plan('volumes.remove', 'sha256:remove-volume'),
    start: unexpected('start'), stop: unexpected('stop'), restart: unexpected('restart'), pause: unexpected('pause'), unpause: unexpected('unpause'), kill: unexpected('kill'), remove: unexpected('remove'),
    createVolume: unexpected('createVolume'), removeVolume: unexpected('removeVolume'), tagImage: unexpected('tagImage'), removeImage: unexpected('removeImage'),
    inspect: async () => ({ engine: 'docker', container: container('container-a') }),
    statsSnapshot: async () => ({ engine: 'docker', stats: { container_id: 'container-a', cpu_percent: 4, memory_bytes: 1000, memory_limit: 2000, network_rx_bytes: 10, network_tx_bytes: 20 } }),
    tailLogs: unexpected('tailLogs'), inspectImage: async () => ({ engine: 'docker', image: image() }), imageHistory: async () => ({ engine: 'docker', image: 'example', history: [] }), inspectVolume: async () => ({ engine: 'docker', volume: volume() }),
  };
  globalThis.__containersFixture = { bridge, client, renderErrors };
  await import(`data:text/javascript;base64,${Buffer.from(`${bundledSource}\n//# sourceURL=containers-v3-test-${++moduleGeneration}.mjs`).toString('base64')}`);
  await eventually(() => {
    if (renderErrors.length > 0) throw renderErrors[0];
    assert.match(textContent(renders.at(-1)), /container-a/u);
  });
  return {
    calls,
    setPullOperation(operation) { currentPullOperation = operation; },
    action(name, event = {}) { const callback = actions.get(name); assert.ok(callback, `missing action ${name}`); callback({ action: name, event: 'click', targetKey: name, editRevision: 1, isComposing: false, ...event }); },
    context(next) { surfaceContext = next; for (const callback of contexts) callback(next); },
    dispose() { for (const callback of lifecycle) callback({ type: 'dispose' }); },
    text: () => textContent(renders.at(-1)), tree: () => renders.at(-1),
  };
}

function pendingOperation(operationID, phase = 'Pulling layers') {
  let cancelCalls = 0;
  return {
    handle: {
      operation_id: operationID,
      data: {},
      snapshot: async () => ({ operation_id: operationID, status: 'running', cancelable: true, created_at: '', updated_at: '', retry_after_ms: 500, progress: { revision: 1, phase, completed_units: 2, total_units: 5, unit: 'layers' } }),
      wait: async () => new Promise((resolve) => setTimeout(() => resolve({ status: 'completed', snapshot: { operation_id: operationID, status: 'completed' } }), 300)),
      cancel: async () => { cancelCalls += 1; },
    },
    cancelCalls: () => cancelCalls,
  };
}

function terminalOperation(status) {
  return {
    operation_id: `terminal-${status}`,
    data: {},
    snapshot: async () => ({ operation_id: `terminal-${status}`, status, cancelable: false, created_at: '', updated_at: '', retry_after_ms: 0 }),
    wait: async () => ({ status, snapshot: { operation_id: `terminal-${status}`, status } }),
    cancel: async () => undefined,
  };
}

function plan(method, digest) { return { method, plan_digest: digest, risk_level: 'critical', risk_flags: [{ id: 'container_privileged', severity: 'critical', title: 'Privileged container', detail: 'The container can receive broad host-level privileges.' }], requires_admin: true, summary: ['The Host computed this exact resource plan.'] }; }
function knownRiskFlags() {
  return [
    ['container_privileged', 'Privileged container'], ['host_network', 'Host network namespace'], ['host_pid_namespace', 'Host PID namespace'],
    ['host_ipc_namespace', 'Host IPC namespace'], ['host_device', 'Host device access'], ['added_linux_capability', 'Added Linux capabilities'],
    ['container_socket_mount', 'Container engine socket mount'], ['host_bind_mount', 'Host bind mount'], ['sensitive_mount_path', 'Sensitive mount path'],
    ['secret_environment', 'Secret-like environment variables'], ['secret_labels', 'Secret-like labels'], ['persistent_restart_policy', 'Persistent restart policy'],
    ['image_not_digest_pinned', 'Image is not digest-pinned'],
  ].map(([id, title]) => ({ id, severity: 'high', title, detail: `${title} Host detail.` }));
}
function container(id) { return { container_id: id, name: id, image: { reference: 'example:test', digest_pinned: false }, state: id.endsWith('a') ? 'stopped' : 'running', ports: [] }; }
function image(id = 'sha256:image') { return { id, reference: 'ghcr.io/example/api:latest', digest: id, referenced_containers: 1, size_bytes: 120000000 }; }
function volume() { return { name: 'app-data', driver: 'local', scope: 'local', referenced_containers: 0 }; }
function unexpected(name) { return async () => { throw new Error(`unexpected ${name}`); }; }
function defaultContext() { return { schema_version: 'redevplugin.surface_context.v1', revision: 1, appearance: { color_scheme: 'light', colors: contextColors() }, locale: { language_tag: 'en-US', direction: 'ltr' } }; }
function contextColors() { return { canvas: '#f4f5f7', surface: '#ffffff', surface_elevated: '#ffffff', text: '#20252c', text_muted: '#687383', border: '#d9dde3', accent: '#3166d5', accent_text: '#ffffff', success: '#16784b', warning: '#946317', danger: '#b13e4b', focus: '#4b7de0' }; }
function textContent(node) { if (!node || typeof node !== 'object') return ''; if (node.type === 'text') return node.text; return (node.children ?? []).map(textContent).join(' '); }
function findNode(node, predicate) { if (!node || typeof node !== 'object') return undefined; if (predicate(node)) return node; for (const child of node.children ?? []) { const found = findNode(child, predicate); if (found) return found; } return undefined; }
function findNodes(node, predicate, found = []) { if (!node || typeof node !== 'object') return found; if (predicate(node)) found.push(node); for (const child of node.children ?? []) findNodes(child, predicate, found); return found; }
async function settle() { await new Promise((resolve) => setTimeout(resolve, 5)); }
async function eventually(assertion) {
  const deadline = Date.now() + 2_000;
  let lastError;
  while (Date.now() < deadline) {
    try { assertion(); return; }
    catch (error) { lastError = error; await settle(); }
  }
  throw lastError;
}
