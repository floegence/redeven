import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  sameProcess,
  refreshOwnedProcesses,
  processIdentity,
  stopOwnedProcess,
  processPorts,
  stopTarget,
} from './desktop_test_session.mjs';
import net from 'node:net';

// Scope: acceptance orchestration only. Owner: the supervisor. Acceptance:
// every outcome is bounded and verified; production quit/runtime semantics stay intact.
const fixture = new URL('./fixtures/desktop-test-session/scenario.mjs', import.meta.url);
async function scenario(name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-session-test-'));
  const child = spawn(process.execPath, [fixture.pathname, name, directory], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    const code = await new Promise((resolve) => child.once('exit', resolve));
    const report = await readFile(path.join(directory, 'result.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const evidence = await readFile(path.join(directory, 'evidence.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    return { code, report, output, directory, evidence };
  } finally {
    clearTimeout(watchdog);
    await rm(directory, { recursive: true, force: true });
  }
}

for (const name of [
  'normal',
  'assertion',
  'hung-close',
  'ignore-term',
  'cleanup-error',
  'duplicate-interrupt',
  'worker-exit',
  'startup-error',
  'deadline',
  'blocked-worker',
  'command-timeout',
  'port-conflict',
  'unexpected-child-exit',
  'browser-worker-exit',
  'browser-startup-error',
]) {
  test(`supervised ${name} completes cleanup before reporting its outcome`, { timeout: 10000 }, async () => {
    const result = await scenario(name);
    assert.ok(result.report, result.output);
    assert.equal(result.report.state, 'finished');
    assert.equal(result.report.status, name === 'normal' ? 'passed' : 'failed', result.output);
    assert.equal(result.code, name === 'normal' ? 0 : 1, result.output);
    assert.deepEqual(result.report.remainingProcesses, []);
    if (result.evidence) assert.equal(result.evidence.status, result.report.status);
    assert.equal(result.report.resources.find((resource) => resource.name === 'independent-service')?.cleaned, true);
    if (name === 'assertion') assert.match(result.report.error, /original assertion/);
    if (name === 'hung-close') assert.match(JSON.stringify(result.report.errors), /graceful/);
    if (name === 'ignore-term') assert.match(JSON.stringify(result.report.errors), /force/);
    if (name.startsWith('browser-')) {
      assert.equal(
        result.report.processes.some((resource) => resource.kind === 'browser'),
        true,
        result.output,
      );
      assert.match(
        result.report.error,
        name === 'browser-startup-error' ? /browser startup failed after spawn/ : /worker exited unexpectedly/,
      );
    }
  });
}

test('identity reuse and unrelated same-name processes never acquire stop authority', async () => {
  const actual = processIdentity(process.pid);
  assert.ok(actual);
  assert.equal(sameProcess(actual, { ...actual, birth: 'reused-pid' }), false);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((resolve) => child.once('spawn', resolve));
  const owned = processIdentity(child.pid);
  try {
    const stale = { identity: { ...owned, birth: 'stale' }, group: true };
    assert.deepEqual(refreshOwnedProcesses(stale), []);
    assert.deepEqual(await stopOwnedProcess(stale), { forced: false });
    assert.ok(sameProcess(owned, processIdentity(child.pid)));
  } finally {
    await stopOwnedProcess({ identity: owned, group: true });
  }
});

test('recorded descendants remain owned after the parent exits', () => {
  const identity = {
    pid: 100,
    group: 100,
    birth: 'one',
    executable: '/fixture',
    device: 1,
    inode: 1,
  };
  const child = { ...identity, pid: 101, parent: 100, birth: 'two' };
  const unrelated = {
    ...child,
    pid: 102,
    parent: 1,
    group: 102,
    birth: 'other',
  };
  const resource = { identity, group: true };
  assert.deepEqual(refreshOwnedProcesses(resource, [identity, child, unrelated]), [identity, child]);
  assert.deepEqual(refreshOwnedProcesses(resource, [child, unrelated]), [child]);
  assert.deepEqual(refreshOwnedProcesses(resource, [unrelated]), []);
});

test('Windows child ownership follows exact recorded descendants without adopting unrelated trees', () => {
  const identity = {
    pid: 100,
    group: null,
    birth: 'one',
    executable: 'C:\\fixture.exe',
  };
  const child = { ...identity, pid: 101, parent: 100, birth: 'two' };
  const unrelated = { ...child, pid: 102, parent: 1, birth: 'other' };
  const resource = { identity, group: false };
  assert.deepEqual(refreshOwnedProcesses(resource, [identity, child, unrelated]), [identity, child]);
  assert.deepEqual(refreshOwnedProcesses(resource, [child, unrelated]), [child]);
  assert.deepEqual(refreshOwnedProcesses(resource, [{ ...child, birth: 'reused' }, unrelated]), []);
});

test('listener evidence comes only from exact live process identities', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const owner = processIdentity(process.pid);
    assert.ok(processPorts([owner]).some((item) => item.port === server.address().port));
    assert.deepEqual(processPorts([{ ...owner, birth: 'reused' }]), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const restarted of [false, true])
  test(`target cleanup fences inventory changes and observes restarted instances: ${restarted}`, async () => {
    const stops = [],
      observed = [];
    let reads = 0;
    const execute = async (command) => {
      if (command.args[0] === 'desktop-target-process-inventory') {
        const instance = reads++ === 0 ? 101 : reads === 2 ? 202 : null;
        return JSON.stringify({
          inventory_digest: `digest-${instance}`,
          instances: instance ? [{ pid: instance }] : [],
        });
      }
      stops.push(command.args);
      if (stops.length === 1 && !restarted) throw new Error('inventory digest changed');
      return JSON.stringify({ after: { instances: [] } });
    };
    await assert.rejects(
      stopTarget({ executable: 'owned-runtime', root: '/owned-session' }, (inventory) => observed.push(inventory), execute),
      restarted ? /remain/ : /digest changed/,
    );
    assert.deepEqual(
      stops.map((args) => args[4]),
      ['digest-101', 'digest-202'],
    );
    assert.ok(stops.every((args) => args[2] === '/owned-session' && args.includes('--expected-inventory-digest')));
    assert.equal(observed[1].instances[0].pid, 202);
  });

test('parallel sessions preserve independent owners and cleanup results', async () => {
  const results = await Promise.all([scenario('normal'), scenario('assertion')]);
  assert.notEqual(results[0].report.id, results[1].report.id);
  assert.equal(results[0].report.status, 'passed');
  assert.equal(results[1].report.status, 'failed');
  assert.deepEqual(
    results.map((result) => result.report.remainingProcesses),
    [[], []],
  );
});
