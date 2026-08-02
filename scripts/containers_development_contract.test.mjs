import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bindContainersProductionCapability,
  loadContainersProductionCapability,
} from './containers_development_contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('development manifest binds the exact signed production capability', () => {
  const capability = loadContainersProductionCapability(root);
  const committedPin = JSON.parse(readFileSync(
    resolve(root, 'spec/redevplugin/official-containers-capability-v4/bundle/host-capability.pin.json'),
    'utf8',
  ));
  assert.deepEqual(capability.pin, committedPin);
  assert.equal(capability.contract.methods.length, 52);

  const manifest = { capability_bindings: [], methods: [] };
  bindContainersProductionCapability(manifest, capability);

  assert.deepEqual(manifest.capability_bindings, [{ binding_id: 'containers-v4', contract: committedPin }]);
  assert.equal(manifest.methods.length, 52);
  assert.equal(new Set(manifest.methods.map((method) => method.method)).size, 52);
  assert.ok(manifest.methods.every((method) => (
    method.route.kind === 'capability'
      && method.route.binding_id === 'containers-v4'
      && method.route.target_method === method.method
  )));
});
