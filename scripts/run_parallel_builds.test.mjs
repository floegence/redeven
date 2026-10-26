import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const runner = new URL('./run_parallel_builds.mjs', import.meta.url);
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-parallel-builds-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'task.mjs');
  writeFileSync(script, `
import { writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [root, mode, name, peer] = process.argv.slice(2);
writeFileSync(root + '/' + name, String(process.pid));
if (mode === 'barrier') {
  const timer = setInterval(() => {
    if (existsSync(root + '/' + peer)) { clearInterval(timer); console.log('ready ' + name); }
  }, 10);
  setTimeout(() => { console.error('peer did not start'); process.exit(41); }, 2000).unref();
} else if (mode === 'failure') {
  const timer = setInterval(() => {
    if (existsSync(root + '/' + peer)) { clearInterval(timer); process.exit(23); }
  }, 10);
} else if (mode === 'descendant') {
  process.on('SIGTERM', () => {});
  spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)', root + '/grandchild'], { stdio: 'inherit' });
  setInterval(() => {}, 1000);
}
`);
  function start(...tasks) {
    const argumentsFor = ([name, mode, peer]) => ['--task', name, process.execPath, script, root, mode, name, peer || ''];
    const args = tasks.flatMap(task => task[1] === 'nested'
      ? ['--task', 'nested', 'sh', '-c', 'exec "$1" "$2" --task worker "$1" "$3" "$4" descendant worker unused', 'build', process.execPath, runner.pathname, script, root]
      : argumentsFor(task));
    const child = spawn(process.execPath, [runner.pathname, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, output })));
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    return { child, done };
  }
  return { root, start };
}
async function waitFor(file) {
  for (let i = 0; i < 500; i++) {
    if (existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for ' + file);
}
function running(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function assertStopped(root) {
  for (const name of ['worker', 'grandchild']) {
    const pid = Number(readFileSync(path.join(root, name), 'utf8'));
    for (let i = 0; i < 100 && running(pid); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(running(pid), false, name + ' must not outlive the build');
  }
}

test('independent build tasks overlap and retain named diagnostics', { timeout: 8000 }, async t => {
  const f = fixture(t);
  const result = await f.start(['first', 'barrier', 'second'], ['second', 'barrier', 'first']).done;
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\[first\].*ready first/);
  assert.match(result.output, /\[second\].*ready second/);
});

test('nested build supervisors clean their detached task groups before returning', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const run = f.start(['nested', 'nested']);
  await waitFor(path.join(f.root, 'grandchild'));
  run.child.kill('SIGTERM');
  const result = await run.done;
  assert.equal(result.code, 143, result.output);
  await assertStopped(f.root);
});

test('a failure preserves its exit code and terminates sibling descendants', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const result = await f.start(['worker', 'descendant'], ['failure', 'failure', 'grandchild']).done;
  assert.equal(result.code, 23, result.output);
  await assertStopped(f.root);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(signal + ' cancels all active build processes', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const run = f.start(['worker', 'descendant']);
  await waitFor(path.join(f.root, 'grandchild'));
  run.child.kill(signal);
  const result = await run.done;
  assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, result.output);
  await assertStopped(f.root);
});
