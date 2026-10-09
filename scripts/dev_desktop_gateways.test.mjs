import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { developmentGatewayTargets, runDevelopmentGateways } from './dev_desktop_gateways.mjs';

async function fixture(context) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'redeven-dev-gateways-')));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'profile');
  const store = path.join(root, 'local-environment/gateway/gateways.json');
  await mkdir(path.dirname(store), { recursive: true });
  const save = records => writeFile(store, JSON.stringify({ schema_version: 4, gateways: records }));
  const record = (gatewayID, connection = { kind: 'local_host', runtime_root: root }, enabled = true) => ({
    gateway_id: gatewayID, local_enabled: enabled, connection,
  });
  return { root, directory, save, record };
}

test('only manages local host Gateways explicitly saved in the selected profile, including default and symlinked roots', async context => {
  const { root, directory, save, record } = await fixture(context);
  const outside = path.join(directory, 'production');
  await mkdir(outside);
  await symlink(outside, path.join(root, 'escape'));
  await save([
    record('local'), record('disabled', undefined, false),
    record('ssh', { kind: 'ssh_host', runtime_root: root }),
    record('container', { kind: 'local_container', runtime_root: root }),
    record('url', { kind: 'url', base_url: 'https://example.test' }),
    record('external', { kind: 'local_host', runtime_root: outside }),
    record('symlink', { kind: 'local_host', runtime_root: path.join(root, 'escape') }),
    record('default', { kind: 'local_host', runtime_root: 'remote_default' }),
  ]);
  const targets = await developmentGatewayTargets(root);
  assert.deepEqual(targets.map(target => [target.gatewayID, target.enabled]), [
    ['local', true], ['disabled', false], ['external', true], ['symlink', true], ['default', true],
  ]);
  assert.equal(targets.at(-1).runtimeRoot, path.join(os.homedir(), '.redeven'));
  assert.equal(targets.find(target => target.gatewayID === 'symlink').runtimeRoot, outside);
  await save([record('../escape')]);
  await assert.rejects(developmentGatewayTargets(root), /Invalid development Gateway identity/u);
});

test('every launch forces current-source installation with a fresh session cache, and cleanup includes removed and newly added connections', async context => {
  const { root, save, record } = await fixture(context);
  await save([record('local'), record('disabled', undefined, false)]);
  const calls = [];
  const createBinary = async stateRoot => {
    const binary = path.join(stateRoot, 'managed/bin/redeven-gateway');
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(path.join(stateRoot, 'stopped'))}, process.argv.slice(2).join(' '));\n`);
    await chmod(binary, 0o700);
  };
  const options = { mode: 'start', stateRoot: root, sourceRoot: '/current-checkout', log: () => {}, dependencies: {
    ensureManagedGatewayServiceReady: async input => {
      calls.push(input);
      await createBinary(input.stateRoot);
    },
  } };
  await runDevelopmentGateways(options);
  await runDevelopmentGateways(options);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].assetCacheRoot, calls[1].assetCacheRoot);
  for (const call of calls) {
    assert.equal(call.forceUpdate, true);
    assert.equal(call.sourceRuntimeRoot, '/current-checkout');
    await assert.rejects(stat(call.assetCacheRoot), { code: 'ENOENT' });
  }
  await save([record('added')]);
  const addedState = path.join(root, 'gateways/added/state');
  await createBinary(addedState);
  await runDevelopmentGateways({ ...options, mode: 'stop' });
  for (const state of [calls[0].stateRoot, addedState]) {
    assert.equal(await readFile(path.join(state, 'stopped'), 'utf8'), `service-stop --state-root ${state}`);
  }
  await assert.rejects(readFile(path.join(root, 'desktop/dev-gateways-v1.json')), { code: 'ENOENT' });
});

test('a partial startup records ownership before starting, keeps failures visible, and can be stopped without compiled Desktop code', async context => {
  const { root, save, record } = await fixture(context);
  await save([record('local')]);
  await assert.rejects(runDevelopmentGateways({
    mode: 'start', stateRoot: root, sourceRoot: '/missing-source', log: () => {},
    dependencies: { ensureManagedGatewayServiceReady: async () => { throw new Error('build failed'); } },
  }), /build failed/u);
  const ledger = JSON.parse(await readFile(path.join(root, 'desktop/dev-gateways-v1.json'), 'utf8'));
  assert.equal(ledger[0].gatewayID, 'local');
  await save([]);
  await runDevelopmentGateways({ mode: 'stop', stateRoot: root, sourceRoot: '/missing-source', log: () => {} });
});

test('cleanup refuses an inventory that does not match an exact saved Gateway service location', async context => {
  const { root, directory, save } = await fixture(context);
  await save([]);
  await mkdir(path.join(root, 'desktop'));
  await writeFile(path.join(root, 'desktop/dev-gateways-v1.json'), JSON.stringify([{ gatewayID: 'local', runtimeRoot: root, stateRoot: directory }]));
  await assert.rejects(runDevelopmentGateways({ mode: 'stop', stateRoot: root, sourceRoot: directory }), /does not match/u);
});
