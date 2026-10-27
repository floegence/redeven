import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComputerScript } from './redevenComputerScript.mjs';

test('compact script supplies input and immutable image bindings', async () => {
  const script = await createComputerScript();
  const operations=[];
  try {
    await script.execute("globalThis.image=await ui.screenshot(); await ui.type('hello'); await image.click(4,5);", async op=>{
      operations.push(op);
      return op.action==='screenshot'?{frame_geometry:{frame:'original',document_id:'document-1'}}:{action_executed:true};
    });
    assert.deepEqual(operations.map(x=>x.action),['screenshot','type','pointer_click']);
    assert.deepEqual(operations[2],{action:'pointer_click',x:4,y:5,coordinate_space:'image_pixels',frame:'original',document_id:'document-1'});
    await script.execute("image.frame_geometry.frame='forged'; await image.click(8,9);", async op=>{operations.push(op);return {};});
    assert.equal(operations.at(-1).frame,'original');
  } finally {script.dispose();}
});

test('documentation is discoverable and snapshots have one canonical role', async () => {
  const script=await createComputerScript();
  try {
    const r=await script.execute("await ui.help('core'); const s=await ui.snapshot({emit:false}); log(s.nodes[0]);",async op=>op.action==='help'?{documentation:'core signatures'}:{url:'https://example.test',observation:{document_id:'d',nodes:[{ref:'r',role:'AXTextField',platform_role:'AXTextField',canonical_role:'textbox',name:'Search'}],truncated:false}});
    assert.deepEqual(r.logs,[['core signatures'],[{ref:'r',role:'textbox',name:'Search'}]]);
  }finally{script.dispose();}
});

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

test('strict waits seal later input even when a guest catches timeout', async () => {
 const script=await createComputerScript();const actions=[];
 try {
  await assert.rejects(script.execute("await ui.type('first'); try { await ui.ref('r').requireState({state:'enabled',timeout_ms:0}); } catch {} await ui.type('second');",async op=>{actions.push(op.action);return op.action==='wait'?{state:'timeout'}:{};}),e=>e.result.diagnostic.code==='CONDITION_TIMEOUT');
  assert.deepEqual(actions,['type','wait']);
 } finally {script.dispose();}
});

test('read helpers preserve legacy shapes and never treat redacted href as an action URL',async()=>{
 const script=await createComputerScript(); const actions=[];
 try {
  const result=await script.execute("const l=ui.ref('r'); log(await l.node(),await l.read(),await l.count(),await l.attribute('title'),await l.linkSummary(),await l.rows({limit:2}));",async op=>{
   actions.push(op);if(op.action==='read')return {node:{ref:'r',role:'AXButton',canonical_role:'button',platform_role:'AXButton'}};
   if(op.action==='query')return {total:9,items:[]};if(op.action==='attribute')return {attribute:op.attribute,value:op.attribute==='href'?'https://example.test/path':'Title'};
   return {rows:[],total:0,truncated:false};
  });
  assert.deepEqual(result.logs[0],[{ref:'r',role:'button'},{node:{ref:'r',role:'AXButton',canonical_role:'button',platform_role:'AXButton'}},9,'Title',{url:'https://example.test/path',redacted:true},{rows:[],total:0,truncated:false}]);
  await assert.rejects(script.execute("await ui.ref('r').attribute('href');",async()=>assert.fail('unsafe dispatch')));
 }finally{script.dispose();}
});

test('native helpers expose input parity without browser collections or image methods',async()=>{
 const script=await createComputerScript({browser:false});const actions=[];
 try {
  const r=await script.execute("await ui.type('abc'); await ui.doubleClick(1,2); await ui.scroll(80); const image=await ui.screenshot(); log(typeof image.click,typeof ui.ref('r').rows,typeof ui.ref('r').attribute);",async op=>{actions.push(op.action);return {};});
  assert.deepEqual(actions,['type','double_click','scroll','screenshot']);assert.deepEqual(r.logs,[['undefined','undefined','undefined']]);
 }finally{script.dispose();}
});

test('download cursor exposes an immutable waiter bound before the click', async () => {
 const vm=await createComputerScript(); const calls=[];
 try {
  await vm.execute("globalThis.pending=await browser.downloadCursor(); pending.cursor='changed'; await ui.ref('export').click(); log(await pending.wait({timeout_ms:1000}));",async op=>{
   calls.push(op); return op.action==='download_cursor'?{cursor:'original',downloads:[]}:{download:{state:'completed'}};
  });
  assert.deepEqual(calls.map(c=>c.action),['download_cursor','click','wait_for_download']);
  assert.deepEqual(calls[2],{action:'wait_for_download',after:'original',timeout_ms:1000});
 } finally { vm.dispose(); }
});
