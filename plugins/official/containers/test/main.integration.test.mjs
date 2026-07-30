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
    name: 'containers-v4-test-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^@floegence\/redevplugin-ui\/plugin$/ }, () => ({ path: 'bridge', namespace: 'test' }));
      builder.onResolve({ filter: /redeven\.container_resources\.v4\.client$/ }, () => ({ path: 'client', namespace: 'test' }));
      builder.onLoad({ filter: /^bridge$/, namespace: 'test' }, () => ({
        contents: `export class PluginBridgeClient { constructor() { return globalThis.__containersFixture.bridge; } }`,
        loader: 'js',
      }));
      builder.onLoad({ filter: /^client$/, namespace: 'test' }, () => ({
        contents: `
          export class RedevenContainerResourcesV4Client {
            constructor() { return globalThis.__containersFixture.client; }
          }
          export function isRedevenContainerResourcesV4BusinessError() { return false; }
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
  assert.match(fixture.text(), /Operational summary for Docker/u);

  fixture.action('select-view', { value: 'containers' });
  await eventually(() => {
    if (fixture.errors().length) throw fixture.errors().at(-1);
    assert.match(fixture.text(), /container-a/u);
  });

  fixture.action('select-view', { value: 'images' });
  await eventually(() => assert.match(fixture.text(), /ghcr\.io\/example\/api:latest/u));
  fixture.action('filter-resources', { value: 'missing' });
  await eventually(() => assert.match(fixture.text(), /No matching images/u));

  fixture.action('select-view', { value: 'volumes' });
  await eventually(() => assert.match(fixture.text(), /app-data/u));
  assert.deepEqual(fixture.calls.listImages, ['docker']);
  assert.deepEqual(fixture.calls.listVolumes, ['docker']);
});

test('renders separate tagged references that share one Docker image id', { concurrency: false }, async (t) => {
  const sharedID = 'sha256:shared-image';
  const fixture = await loadFixture({
    listImages: async ({ engine }) => ({
      engine,
      images: [
        { ...image(sharedID), reference: 'ghcr.io/example/api:latest' },
        { ...image(sharedID), reference: 'ghcr.io/example/api:stable' },
      ],
    }),
  });
  t.after(() => fixture.dispose());

  fixture.action('select-view', { value: 'images' });
  await eventually(() => {
    if (fixture.errors().length) throw fixture.errors().at(-1);
    assert.match(fixture.text(), /ghcr\.io\/example\/api:latest/u);
    assert.match(fixture.text(), /ghcr\.io\/example\/api:stable/u);
    const rows = findNodes(fixture.tree(), (node) => node.attributes?.class === 'resource-row image-row');
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.key)).size, 2);
  });
});

test('defaults to Overview and exposes only the selected engine workspace', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    listEndpoints: async ({ engine }) => ({ engine, endpoints: engine === 'docker'
      ? [endpoint(engine), { ...endpoint(engine, 'endpoint-docker-build'), display_name: 'build' }]
      : [endpoint(engine)] }),
  });
  t.after(() => fixture.dispose());
  assert.match(fixture.text(), /Operational summary for Docker/u);
  assert.match(fixture.text(), /Runtime target/u);
  assert.ok(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'select-endpoint'));
  assert.ok(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'select-view' && node.attributes?.value === 'projects'));

  fixture.action('select-endpoint', { value: 'endpoint-docker-build' });
  await eventually(() => assert.equal(fixture.calls.endpointStatus.at(-1), 'endpoint-docker-build'));
  fixture.action('select-view', { value: 'projects' });
  await eventually(() => assert.match(fixture.text(), /application/u));

  fixture.action('select-engine', { value: 'podman' });
  await eventually(() => {
    assert.match(fixture.text(), /Operational summary for Podman/u);
    assert.match(fixture.text(), /Rootless/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'select-view' && node.attributes?.value === 'pods'));
    assert.equal(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'select-view' && node.attributes?.value === 'projects'), undefined);
  });
  fixture.action('select-view', { value: 'pods' });
  await eventually(() => {
    assert.match(fixture.text(), /application-pod/u);
    assert.match(fixture.text(), /8080:80\/tcp/u);
  });
});

test('keeps a single runtime target quiet while preserving its exact identity', { concurrency: false }, async (t) => {
  const fixture = await loadFixture();
  t.after(() => fixture.dispose());
  assert.equal(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'select-endpoint'), undefined);
  assert.doesNotMatch(fixture.text(), /Docker context|Runtime target/u);
  assert.match(fixture.text(), /default/u);

  fixture.action('select-view', { value: 'containers' });
  await eventually(() => {
    const icon = findNode(fixture.tree(), (node) => node.attributes?.class?.includes('lucide-box resource-icon'));
    assert.ok(icon);
    const created = findNode(fixture.tree(), (node) => node.attributes?.class === 'table-cell cell-created');
    assert.ok(created);
  });
});

test('partitions search and refinements by exact endpoint workspace', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    listEndpoints: async ({ engine }) => ({ engine, endpoints: [endpoint(engine), { ...endpoint(engine, 'endpoint-docker-build'), display_name: 'build', default: false }] }),
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'containers' });
  fixture.action('filter-resources', { value: 'container-a' });
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.type === 'search').attributes.value, 'container-a'));

  fixture.action('select-endpoint', { value: 'endpoint-docker-build' });
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.type === 'search').attributes.value, ''));
  fixture.action('filter-resources', { value: 'container-b' });
  fixture.action('select-endpoint', { value: 'endpoint-docker-default' });
  await eventually(() => assert.equal(findNode(fixture.tree(), (node) => node.attributes?.type === 'search').attributes.value, 'container-a'));
});

test('marks an endpoint offline when status refresh fails', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    status: async ({ engine, call }) => {
      if (call > 1) throw new Error('endpoint unreachable');
      return { engine, available: true, engine_version: 'test' };
    },
  });
  t.after(() => fixture.dispose());
  fixture.action('refresh-resources');
  await eventually(() => {
    assert.match(fixture.text(), /Disconnected/u);
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.class === 'engine-unavailable-workspace'));
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'refresh-resources'));
    assert.equal(findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'open-create-container'), undefined);
  });
});

test('cancels an exact detail stream when the endpoint changes', { concurrency: false }, async (t) => {
  let canceled = 0;
  let finish;
  const stream = {
    cancel: async () => { canceled += 1; finish?.({ done: true }); },
    [Symbol.asyncIterator]() { return this; },
    next: () => new Promise((resolve) => { finish = resolve; }),
  };
  const fixture = await loadFixture({
    listEndpoints: async ({ engine }) => ({ engine, endpoints: [endpoint(engine), { ...endpoint(engine, 'endpoint-docker-build'), display_name: 'build', default: false }] }),
    statsWatch: async () => stream,
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'containers' });
  fixture.action('container-stats', { value: 'container-b' });
  await eventually(() => assert.match(fixture.text(), /Usage/u));
  fixture.action('select-endpoint', { value: 'endpoint-docker-build' });
  await eventually(() => assert.equal(canceled, 1));
});

test('does not reopen a stale preflight after an endpoint change', { concurrency: false }, async (t) => {
  let resolvePlan;
  const fixture = await loadFixture({
    listEndpoints: async ({ engine }) => ({ engine, endpoints: [endpoint(engine), { ...endpoint(engine, 'endpoint-docker-build'), display_name: 'build', default: false }] }),
    createPreflight: async () => new Promise((resolve) => { resolvePlan = resolve; }),
  });
  t.after(() => fixture.dispose());
  fixture.action('open-create-container');
  fixture.action('submit-create-container', { form_data: { name: 'api', image: 'ghcr.io/example/api:latest' } });
  await eventually(() => assert.ok(resolvePlan));
  fixture.action('select-endpoint', { value: 'endpoint-docker-build' });
  resolvePlan(plan('containers.create', 'sha256:stale-plan'));
  await eventually(() => {
    assert.match(fixture.text(), /Operational summary for Docker/u);
    assert.doesNotMatch(fixture.text(), /sha256:stale-plan/u);
  });
});

test('does not reconcile an operation against a different endpoint', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    listEndpoints: async ({ engine }) => ({ engine, endpoints: [endpoint(engine), { ...endpoint(engine, 'endpoint-docker-build'), display_name: 'build', default: false }] }),
    pullOperation: pendingOperation('cross-endpoint').handle,
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'images' });
  fixture.action('open-pull-image');
  fixture.action('submit-pull-image', { form_data: { image_ref: 'ghcr.io/example/cross:latest' } });
  fixture.action('select-endpoint', { value: 'endpoint-docker-build' });
  await eventually(() => {
    const resume = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'resume-operation');
    assert.equal(resume.attributes.disabled, true);
  });
  assert.equal(fixture.calls.status.length, 2);
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
  fixture.action('select-view', { value: 'containers' });
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
    engine: 'docker', endpoint_id: 'endpoint-docker-default', image: 'ghcr.io/example/api:latest', name: 'api', command: ['serve'],
    env: ['MODE=prod'], restart_policy: 'unless-stopped', network_mode: 'bridge', privileged: false,
  });
  await eventually(() => assert.match(fixture.text(), /Pulling layers|Running/u));
});

test('accepts the released start risk plan without inventing a digest field', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({
    startPlan: {
      method: 'containers.start',
      request: { engine: 'docker', endpoint_id: 'endpoint-docker-default', container_id: 'container-a' },
      target: { engine: 'docker', endpoint_id: 'endpoint-docker-default', resource_kind: 'container', container_id: 'container-a' },
      risk_level: 'low', risk_flags: [], requires_admin: false,
    },
  });
  t.after(() => fixture.dispose());
  fixture.action('select-view', { value: 'containers' });
  fixture.action('container-action', { value: 'start|container-a' });
  await eventually(() => {
    const confirm = findNode(fixture.tree(), (node) => node.attributes?.['data-redevplugin-action'] === 'confirm-plan');
    assert.equal(confirm.attributes.disabled, false);
  });
});

test('provides resource-specific inspector tabs for containers, images, and volumes', { concurrency: false }, async (t) => {
  const fixture = await loadFixture();
  t.after(() => fixture.dispose());

  fixture.action('select-view', { value: 'containers' });
  fixture.action('container-details', { value: 'container-a' });
  await eventually(() => {
    assert.ok(findNode(fixture.tree(), (node) => node.attributes?.value === 'technical|container-a'));
    const inspector = findNode(fixture.tree(), (node) => node.attributes?.class === 'dialog-panel inspector-panel');
    assert.ok(inspector);
    assert.equal(inspector.attributes.role, 'complementary');
    assert.equal(inspector.attributes['aria-modal'], false);
  });
  fixture.action('select-inspector-tab', { value: 'technical|container-a' });
  await eventually(() => assert.match(fixture.text(), /Technical information/u));

  fixture.action('close-dialog');
  fixture.action('select-view', { value: 'images' });
  fixture.action('image-details', { value: 'ghcr.io/example/api:latest' });
  await eventually(() => assert.ok(findNode(fixture.tree(), (node) => node.attributes?.value === 'image|history|ghcr.io/example/api:latest')));
  fixture.action('select-resource-inspector-tab', { value: 'image|usage|ghcr.io/example/api:latest' });
  await eventually(() => assert.match(fixture.text(), /Usage/u));

  fixture.action('close-dialog');
  fixture.action('select-view', { value: 'volumes' });
  fixture.action('volume-details', { value: 'app-data' });
  await eventually(() => assert.ok(findNode(fixture.tree(), (node) => node.attributes?.value === 'volume|technical|app-data')));
});

test('renders a dedicated recovery workspace when the selected engine is unavailable', { concurrency: false }, async (t) => {
  const fixture = await loadFixture({ status: async ({ engine }) => ({ engine, available: false, engine_version: '' }) }, { expectAvailable: false });
  t.after(() => fixture.dispose());

  const root = fixture.tree();
  assert.ok(findNode(root, (node) => node.attributes?.class === 'engine-unavailable-workspace'));
  assert.ok(findNode(root, (node) => node.attributes?.class === 'application-shell unavailable-shell'));
  assert.equal(findNode(root, (node) => node.attributes?.class === 'resource-navigation'), undefined);
  assert.ok(findNode(root, (node) => node.attributes?.class === 'brand-mark plugin-brand-icon'));
  assert.ok(findNode(root, (node) => node.attributes?.['data-redevplugin-action'] === 'refresh-resources'));
  assert.equal(findNode(root, (node) => node.key === 'overview-metrics'), undefined);
  assert.equal(findNode(root, (node) => node.attributes?.['data-redevplugin-action'] === 'open-create-container'), undefined);
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
  await eventually(() => assert.deepEqual(fixture.calls.pruneImages, [{ engine: 'docker', endpoint_id: 'endpoint-docker-default', resource_identities: ['sha256:image-a'] }]));

  fixture.action('select-view', { value: 'volumes' });
  await eventually(() => assert.match(fixture.text(), /Create volume/u));
  fixture.action('prune-volumes');
  await eventually(() => assert.match(fixture.text(), /sha256:volume-prune/u));
  fixture.action('confirm-plan');
  await eventually(() => assert.deepEqual(fixture.calls.pruneVolumes, [{ engine: 'docker', endpoint_id: 'endpoint-docker-default', resource_identities: ['cache-data'] }]));
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
  fixture.action('resume-operation', { value: `pull:docker:endpoint-docker-default:${target}` });
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
  fixture.action('select-view', { value: 'containers' });
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
  assert.equal(cancel.attributes.value, 'pull:docker:endpoint-docker-default:ghcr.io/example/new:latest');
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

async function loadFixture(overrides = {}, options = {}) {
  const actions = new Map();
  const lifecycle = [];
  const contexts = [];
  const renders = [];
  const renderErrors = [];
  let surfaceContext = defaultContext();
  let currentPullOperation = overrides.pullOperation;
  const calls = { status: [], endpointStatus: [], endpoints: [], listImages: [], listVolumes: [], create: [], pruneImages: [], pruneVolumes: [] };
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
    listEndpoints: async ({ engine }) => {
      calls.endpoints.push(engine);
      return overrides.listEndpoints ? overrides.listEndpoints({ engine, call: calls.endpoints.length }) : { engine, endpoints: [endpoint(engine)] };
    },
    endpointStatus: async ({ engine, endpoint_id }) => {
      calls.status.push(engine);
      calls.endpointStatus.push(endpoint_id);
      const result = overrides.status ? await overrides.status({ engine, endpoint_id, call: calls.status.length }) : { engine, available: true, engine_version: 'test' };
      return { endpoint: { ...endpoint(engine, endpoint_id), ...result, endpoint_id } };
    },
    list: async ({ engine }) => overrides.list ? overrides.list({ engine }) : ({ engine, containers: [container('container-a'), container('container-b')] }),
    listImages: async ({ engine }) => { calls.listImages.push(engine); return overrides.listImages ? overrides.listImages({ engine, call: calls.listImages.length }) : { engine, images: [image()] }; },
    listVolumes: async ({ engine }) => { calls.listVolumes.push(engine); return overrides.listVolumes ? overrides.listVolumes({ engine, call: calls.listVolumes.length }) : { engine, volumes: [volume()] }; },
    listComposeProjects: async ({ engine }) => overrides.listComposeProjects ? overrides.listComposeProjects({ engine }) : ({ engine, projects: [composeProject()] }),
    listPods: async ({ engine }) => overrides.listPods ? overrides.listPods({ engine }) : ({ engine, pods: [pod()] }),
    inspectComposeProject: async ({ engine }) => ({ engine, project: { ...composeProject(), containers: [] } }),
    inspectPod: async ({ engine }) => ({ engine, pod: { ...pod(), infra_id: 'infra-a', containers: [] } }),
    createPreflight: async () => overrides.createPreflight ? overrides.createPreflight() : overrides.createPlan ?? plan('containers.create', 'sha256:create-plan'),
    create: async (request) => { calls.create.push(request); return overrides.createOperation ?? pendingOperation('default-create').handle; },
    pruneImagesPreflight: async () => overrides.pruneImagesPlan ?? ({ ...plan('images.prune', 'sha256:image-prune'), target: { resource_identities: ['sha256:image-a'], resource_count: 1 } }),
    pruneImages: async (request) => { calls.pruneImages.push(request); return overrides.pruneImagesOperation ?? pendingOperation('default-images').handle; },
    pruneVolumesPreflight: async () => ({ ...plan('volumes.prune', 'sha256:volume-prune'), target: { resource_identities: ['cache-data'], resource_count: 1 } }),
    pruneVolumes: async (request) => { calls.pruneVolumes.push(request); return overrides.pruneVolumesOperation ?? pendingOperation('default-volumes').handle; },
    pullImage: async () => currentPullOperation ?? pendingOperation('default-pull').handle,
    startPreflight: async () => overrides.startPlan ?? plan('containers.start', 'sha256:start'),
    removePreflight: async () => plan('containers.remove', 'sha256:remove'),
    createVolumePreflight: async () => plan('volumes.create', 'sha256:create-volume'),
    removeVolumePreflight: async () => plan('volumes.remove', 'sha256:remove-volume'),
    start: unexpected('start'), stop: unexpected('stop'), restart: unexpected('restart'), pause: unexpected('pause'), unpause: unexpected('unpause'), kill: unexpected('kill'), remove: unexpected('remove'),
    createVolume: unexpected('createVolume'), removeVolume: unexpected('removeVolume'), tagImage: unexpected('tagImage'), removeImage: unexpected('removeImage'),
    inspect: async () => ({ engine: 'docker', container: container('container-a') }),
    statsSnapshot: async () => ({ engine: 'docker', stats: { container_id: 'container-a', cpu_percent: 4, memory_bytes: 1000, memory_limit: 2000, network_rx_bytes: 10, network_tx_bytes: 20 } }),
    statsWatch: overrides.statsWatch ?? unexpected('statsWatch'),
    tailLogs: overrides.tailLogs ?? unexpected('tailLogs'), inspectImage: async () => ({ engine: 'docker', image: image() }), imageHistory: async () => ({ engine: 'docker', image: 'example', history: [] }), inspectVolume: async () => ({ engine: 'docker', volume: volume() }),
  };
  globalThis.__containersFixture = { bridge, client, renderErrors };
  await import(`data:text/javascript;base64,${Buffer.from(`${bundledSource}\n//# sourceURL=containers-v4-test-${++moduleGeneration}.mjs`).toString('base64')}`);
  await eventually(() => {
    if (renderErrors.length > 0) throw renderErrors[0];
    const text = textContent(renders.at(-1));
    if (options.expectAvailable === false) {
      assert.match(text, /Docker unavailable/u);
      return;
    }
    assert.match(text, /Operational summary for Docker/u);
    const volumeMetric = findNode(renders.at(-1), (node) => node.key === 'overview-metric-volumes');
    const projectMetric = findNode(renders.at(-1), (node) => node.key === 'overview-metric-engine-specific');
    assert.match(textContent(volumeMetric), /1 Volumes/u);
    assert.match(textContent(projectMetric), /1 Projects/u);
  });
  return {
    calls,
    setPullOperation(operation) { currentPullOperation = operation; },
    action(name, event = {}) { const callback = actions.get(name); assert.ok(callback, `missing action ${name}`); callback({ action: name, event: 'click', targetKey: name, editRevision: 1, isComposing: false, ...event }); },
    context(next) { surfaceContext = next; for (const callback of contexts) callback(next); },
    dispose() { for (const callback of lifecycle) callback({ type: 'dispose' }); },
    errors: () => renderErrors, text: () => textContent(renders.at(-1)), tree: () => renders.at(-1),
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

function plan(method, digest) { return { method, plan_digest: digest, request: { engine: 'docker', endpoint_id: 'endpoint-docker-default' }, risk_level: 'critical', risk_flags: [{ id: 'container_privileged', severity: 'critical', title: 'Privileged container', detail: 'The container can receive broad host-level privileges.' }], requires_admin: true, summary: ['The Host computed this exact resource plan.'] }; }
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
function endpoint(engine, endpointID = `endpoint-${engine}-default`) { return { endpoint_id: endpointID, engine, display_name: engine === 'docker' ? 'default' : 'local', default: true, available: true, engine_version: 'test', ...(engine === 'podman' ? { rootless: true } : {}) }; }
function composeProject() { return { project_id: 'project-a', name: 'application', status: 'running', service_count: 2, container_count: 2, running_count: 2 }; }
function pod() { return { pod_id: 'pod-a', name: 'application-pod', status: 'running', container_count: 2, running_count: 2, ports: [{ host_ip: '127.0.0.1', host_port: 8080, port: 80, protocol: 'tcp' }], created_at_unix_ms: 1_700_000_000_000 }; }
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
