import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComputerScript } from './redevenComputerScript.mjs';

test('script JSONL entrypoint starts through a symlinked bundle path', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'flower-script-entry-'));
  let child;
  let exited;
  try {
    const alias = path.join(directory, 'bundle');
    await symlink(fileURLToPath(new URL('.', import.meta.url)), alias, 'dir');
    child = spawn(process.execPath, [path.join(alias, 'redevenComputerScript.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    exited = new Promise(resolve => child.once('exit', resolve));
    const result = await new Promise((resolve, reject) => {
      let buffer = '';
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Script exited before its result: ${code}`)));
      child.stdout.on('data', bytes => {
        buffer += bytes;
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (message.type === 'ready') child.stdin.write(JSON.stringify({ type: 'execute', id: 'entry', code: 'log(typeof browser, typeof ui);' }) + '\n');
          else resolve(message);
        }
      });
    });
    assert.equal(result.type, 'result');
    assert.equal(result.id, 'entry');
    assert.deepEqual(result.result.logs, [['undefined', 'object']]);
    child.stdin.end();
    assert.equal(await exited, 0);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test('script combines operations, retains explicit variables and isolates host objects', async () => {
  const script = await createComputerScript();
  const operations = [];
  try {
    const first = await script.execute(`
      globalThis.query = 'hello';
      await ui.getByRole('textbox', {name: 'Search'}).fill(query);
      await ui.getByRole('button', {name: 'Search'}).click();
      log(typeof process, typeof require, typeof fetch, typeof __operation);
    `, async (operation) => { operations.push(operation); return { ok: true }; });
    assert.deepEqual(first.logs, [['undefined', 'undefined', 'undefined', 'undefined']]);
    assert.deepEqual(operations.map((op) => op.action), ['fill', 'click']);
    const second = await script.execute('log(query);', async () => assert.fail('unexpected action'));
    assert.deepEqual(second.logs, [['hello']]);
  } finally { script.dispose(); }
});

test('a caught host rejection cannot authorize a later operation', async () => {
  const script = await createComputerScript();
  let calls = 0;
  try {
    await assert.rejects(script.execute(`
      try { await browser.navigate('https://blocked.example'); } catch {}
      try { await ui.click(1, 1); } catch {}
    `, async () => { calls++; throw new Error('blocked'); }));
    assert.equal(calls, 1);
  } finally { script.dispose(); }
});

test('script enforces operation and CPU limits', async () => {
  const script = await createComputerScript();
  let calls = 0;
  try {
    await assert.rejects(script.execute('for (let i = 0; i < 51; i++) await ui.observe();', async () => { calls++; return {}; }));
    assert.equal(calls, 50);
    await assert.rejects(script.execute('while (true) {}', async () => ({}), 25));
  } finally { script.dispose(); }
});

test('unawaited effects cannot outlive an invocation', async () => {
  const script = await createComputerScript();
  try {
    await assert.rejects(script.execute('ui.click(1, 1);', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {};
    }));
  } finally { script.dispose(); }
});

test('guest heap exhaustion cannot reach the host or another namespace', async () => {
  const exhausted = await createComputerScript();
  try { await assert.rejects(exhausted.execute('const values=[]; for(;;) values.push(new Array(100000).fill(123));', async () => assert.fail('unexpected host operation'))); }
  finally { exhausted.dispose(); }
  const next = await createComputerScript();
  try { assert.deepEqual((await next.execute('log(typeof values);', async () => ({}))).logs, [['undefined']]); }
  finally { next.dispose(); }
});

test('desktop namespaces do not expose browser-only methods', async () => {
  const script = await createComputerScript({ browser: false });
  try { assert.deepEqual((await script.execute('log(typeof browser, typeof ui);', async () => ({}))).logs, [['undefined', 'object']]); }
  finally { script.dispose(); }
});
