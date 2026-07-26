import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/operation-state.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  write: false,
});
const moduleURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
const { ContainerOperationStore, containerOperationKey } = await import(moduleURL);

test('serializes mutations for one engine and container', () => {
  const store = new ContainerOperationStore();
  const first = store.begin('docker', 'container-a', 'start');
  assert.ok(first);
  assert.equal(store.begin('docker', 'container-a', 'stop'), undefined);
  assert.equal(store.current('docker', 'container-a'), first);
});

test('allows independent engines and containers to progress concurrently', () => {
  const store = new ContainerOperationStore();
  const dockerA = store.begin('docker', 'container-a', 'start');
  const dockerB = store.begin('docker', 'container-b', 'restart');
  const podmanA = store.begin('podman', 'container-a', 'remove');
  assert.ok(dockerA && dockerB && podmanA);
  assert.equal(store.forEngine('docker').length, 2);
  assert.equal(store.forEngine('podman').length, 1);
  assert.notEqual(containerOperationKey('docker', 'container-a'), containerOperationKey('podman', 'container-a'));
});

test('rejects stale updates and completion from an older generation', () => {
  const store = new ContainerOperationStore();
  const first = store.begin('docker', 'container-a', 'start');
  assert.ok(first);
  assert.equal(store.finish(first.key, first.generation), true);
  const second = store.begin('docker', 'container-a', 'stop');
  assert.ok(second);
  assert.equal(store.update(first.key, first.generation, { phase: 'running' }), undefined);
  assert.equal(store.finish(first.key, first.generation), false);
  assert.equal(store.current('docker', 'container-a'), second);
});

test('preserves operation identity while observation changes phase', () => {
  const store = new ContainerOperationStore();
  const operation = store.begin('docker', 'container-a', 'restart');
  assert.ok(operation);
  const running = store.update(operation.key, operation.generation, {
    operationID: 'operation-1',
    phase: 'running',
    message: 'Restart is running.',
  });
  const paused = store.update(operation.key, operation.generation, {
    phase: 'observation_paused',
    message: 'Observation paused.',
  });
  assert.equal(running?.operationID, 'operation-1');
  assert.equal(paused?.operationID, 'operation-1');
  assert.equal(paused?.phase, 'observation_paused');
});
