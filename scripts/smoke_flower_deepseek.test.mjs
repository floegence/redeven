import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertPortsFree,
  assertSmokeConfiguration,
  canonicalEvidence,
  findDeepSeekProvider,
  ownedManifestPIDs,
  scanSecretLeaks,
  withSensitiveState,
} from './smoke_flower_deepseek.mjs';

const expectedConfiguration = {
  root: '/tmp/redeven-flower-smoke-01a00852',
  workspace: '/tmp/redeven-flower-smoke-01a00852/workspace',
  model: 'deepseek-v4-flash',
  localUIPort: 43924,
  cdpPort: 43925,
  inspectorPort: 43926,
};

test('smoke configuration locks root, workspace, ports, and DeepSeek V4 Flash', () => {
  assert.doesNotThrow(() => assertSmokeConfiguration(expectedConfiguration));
  for (const patch of [
    { model: 'deepseek-v4-pro' },
    { root: '/tmp/other' },
    { workspace: '/tmp/other/workspace' },
    { localUIPort: 43824 },
    { cdpPort: 43825 },
    { inspectorPort: 43826 },
  ]) {
    assert.throws(() => assertSmokeConfiguration({ ...expectedConfiguration, ...patch }), /locked/u);
  }
});

test('Desktop launch receives the locked local UI port', async () => {
  const runner = await readFile(new URL('./smoke_flower_deepseek.sh', import.meta.url), 'utf8');
  assert.match(runner, /REDEVEN_DESKTOP_LOCAL_UI_BIND="127\.0\.0\.1:\$LOCAL_UI_PORT"/u);
  assert.match(runner, /LOCAL_UI_PORT=43924/u);
  assert.match(runner, /owned_pids=\$\(node .* owned-pids/u);
  assert.doesNotMatch(runner, /\$\{owned\[@\]\}/u);
});

test('provider selection requires an exact DeepSeek provider key and forces flash model', () => {
  const selected = findDeepSeekProvider({
    current_model_id: 'deepseek-profile/deepseek-v4-pro',
    providers: [{
      id: 'deepseek-profile', type: 'deepseek', base_url: 'https://api.deepseek.com',
      models: [{ model_name: 'deepseek-v4-pro' }, { model_name: 'deepseek-v4-flash' }],
    }],
  }, { provider_api_keys: { 'deepseek-profile': 'smoke-test-secret' } });
  assert.equal(selected.currentModelID, 'deepseek-profile/deepseek-v4-flash');
  assert.equal(selected.provider.type, 'deepseek');
  assert.equal(selected.apiKey, 'smoke-test-secret');
  assert.throws(() => findDeepSeekProvider({
    providers: [{ id: 'deepseek-profile', type: 'deepseek', models: [{ model_name: 'deepseek-v4-flash' }] }],
  }, { provider_api_keys: {} }), /API key is missing/u);
});

test('canonical evidence unwraps the API envelope and preserves canonical IDs', () => {
  assert.deepEqual(canonicalEvidence({ status: 200, body: { ok: true, data: {
    thread: { thread_id: 'thread-1', active_run_id: 'run-1', run_status: 'running' },
    current: {
      thread_id: 'thread-1', turn_id: 'turn-1', activity: 'active',
      items: [{ id: 'message-1', kind: 'user' }, { id: 'tool-1', kind: 'tool' }],
      interactions: [{ id: 'approval-1' }],
    },
  } } }), {
    http_status: 200, thread_id: 'thread-1', run_id: 'run-1', turn_id: 'turn-1',
    status: 'running', activity: 'active', item_ids: ['message-1', 'tool-1'],
    message_ids: ['message-1'], interaction_ids: ['approval-1'], error_code: '',
  });
});

test('port conflicts fail without killing the listener', async (t) => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => listener.close());
  const port = listener.address().port;
  await assert.rejects(assertPortsFree([port]), /already in use/u);
  assert.equal(listener.listening, true);
});

test('cleanup selects only manifest PIDs with exact task provenance', () => {
  const manifest = {
    worktree: '/work/redeven-smoke', stateRoot: '/tmp/redeven-flower-smoke-01a00852/state',
    pids: [101, 102, 103],
  };
  const observed = [
    { pid: 101, cwd: '/work/redeven-smoke/desktop', command: '/work/redeven-smoke/desktop/node_modules/electron --user-data-dir=/tmp/redeven-flower-smoke-01a00852/user-data' },
    { pid: 102, cwd: '/work/other/desktop', command: '/work/other/redeven run --state-root /tmp/other' },
    { pid: 103, cwd: '/work/redeven-smoke/desktop', command: '/work/redeven-smoke/desktop/.bundle/redeven run --state-root /tmp/redeven-flower-smoke-01a00852/state' },
    { pid: 43824, cwd: '/work/redeven', command: 'redeven run --local-ui-bind localhost:43824' },
  ];
  assert.deepEqual(ownedManifestPIDs(manifest, observed), [101, 103]);
});

test('cleanup treats macOS /tmp and /private/tmp as the same owned root', async () => {
  const privateTmp = await import('node:fs').then(({ realpathSync }) => realpathSync('/tmp'));
  const manifest = {
    worktree: '/work/redeven-smoke', stateRoot: '/tmp/redeven-flower-smoke-01a00852/state', pids: [201],
  };
  const observed = [{
    pid: 201,
    cwd: '/work/redeven-smoke/desktop',
    command: `/work/redeven-smoke/desktop/.bundle/redeven run --state-root ${privateTmp}/redeven-flower-smoke-01a00852/state`,
  }];
  assert.deepEqual(ownedManifestPIDs(manifest, observed), [201]);
});

test('failure paths remove temporary config and secrets before returning', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flower-smoke-sensitive-'));
  await assert.rejects(withSensitiveState(root, {
    config: { current_model_id: 'profile/deepseek-v4-flash' },
    secrets: { provider_api_keys: { profile: 'smoke-test-secret' } },
  }, async () => {
    throw new Error('expected failure');
  }), /expected failure/u);
  await assert.rejects(readFile(path.join(root, 'config.json')), /ENOENT/u);
  await assert.rejects(readFile(path.join(root, 'secrets.json')), /ENOENT/u);
  await rm(root, { recursive: true, force: true });
});

test('secret leak scan reports only paths and never secret content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flower-smoke-report-'));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'safe.json'), '{"configured":true}\n');
  assert.deepEqual(await scanSecretLeaks([root], 'smoke-test-secret'), []);
  await writeFile(path.join(root, 'nested', 'leak.log'), 'prefix smoke-test-secret suffix');
  const leaks = await scanSecretLeaks([root], 'smoke-test-secret');
  assert.equal(leaks.length, 1);
  assert.match(leaks[0], /leak\.log$/u);
  assert.doesNotMatch(JSON.stringify(leaks), /smoke-test-secret/u);
  await rm(root, { recursive: true, force: true });
});
