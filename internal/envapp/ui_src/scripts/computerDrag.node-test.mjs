/* global window */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

const fixture = '<!doctype html><title>Pointer contract</title><div style="width:400px;height:240px;background:#ddd;user-select:none">Drag surface</div><section aria-label="Telemetry">[]</section><script>window.events=[];for(const kind of ["mousedown","mousemove","mouseup"]) document.addEventListener(kind,e=>{window.events.push({type:e.type,time:performance.now(),x:e.clientX,y:e.clientY,buttons:e.buttons});document.querySelector("section").textContent=JSON.stringify(window.events)});</script>';

for (const mode of ['managed', 'connected']) test(mode + ' browser drag honors timing and rejects invalid duration without input', { timeout: 30000 }, async t => {
  const site = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(fixture); });
  site.listen(0, '127.0.0.1'); await once(site, 'listening');
  const origin = 'http://127.0.0.1:' + site.address().port;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-drag-'));
  let context, helper, exited;
  t.after(async () => {
    helper?.stdin.end();
    const timeout = setTimeout(() => helper?.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timeout); }
    await context?.close();
    site.closeAllConnections(); await new Promise(resolve => site.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  let args = ['--profile', directory], other, selected;
  if (mode === 'connected') {
    context = await chromium.launchPersistentContext(directory, { headless: true, args: ['--remote-debugging-port=0'] });
    other = await context.newPage(); await other.goto('about:blank#unrelated');
    selected = await context.newPage(); await selected.goto(origin);
    const session = await context.newCDPSession(selected);
    const { targetInfo } = await session.send('Target.getTargetInfo'); await session.detach();
    const port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    args = ['--cdp-url', 'http://127.0.0.1:' + port, '--tab-id', targetInfo.targetId, '--browser-context-id', targetInfo.browserContextId || 'default'];
  }
  helper = spawn(process.execPath, [fileURLToPath(new URL('./redevenComputerHost.mjs', import.meta.url)), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  exited = once(helper, 'exit');
  let stderr = ''; helper.stderr.on('data', bytes => { stderr += bytes; });
  const lines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
  async function next() {
    let timer;
    try {
      const line = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('helper timeout: ' + stderr)), 10000); })]);
      assert.equal(line.done, false, stderr); return JSON.parse(line.value);
    } finally { clearTimeout(timer); }
  }
  let sequence = 0;
  async function send(tool_name, args) {
    const id = String(++sequence);
    helper.stdin.write(JSON.stringify({ id, target_id: 'drag-fixture', tool_name, args, allowed_origins: [origin], script_operation: true }) + '\n');
    const result = await next(); assert.equal(result.id, id); return result;
  }
  const ready = await next(); assert.equal(ready.error, undefined, JSON.stringify(ready));
  assert.equal(ready.execution_location, mode === 'connected' ? 'connected_browser' : process.platform + '_headless_browser');
  for (const duration of [0, 1, 500, 5000]) {
    assert.equal((await send('browser.navigate', { url: origin })).error, undefined);
    const result = await send('computer.action', { action: 'drag', from_x: 20, from_y: 30, to_x: 150, to_y: 100, duration_ms: duration });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.result.action_executed, true);
    const read = await send('computer.action', { action: 'text', selector: { role: 'region', name: 'Telemetry', exact: true } });
    const events = JSON.parse(read.result.text);
    const down = events.filter(e => e.type === 'mousedown'), up = events.filter(e => e.type === 'mouseup');
    const moves = events.filter(e => e.type === 'mousemove');
    assert.equal(down.length, 1); assert.equal(up.length, 1);
    assert.deepEqual([down[0].x, down[0].y, up[0].x, up[0].y], [20, 30, 150, 100]);
    assert.ok(up[0].time - down[0].time >= duration - 25, JSON.stringify({ duration, held_ms: up[0].time - down[0].time }));
    assert.ok(up[0].time - down[0].time < duration + 2000);
    t.diagnostic(JSON.stringify({mode, duration_ms:duration, held_ms:up[0].time-down[0].time, moves:moves.length}));
    assert.equal(events[0].type, 'mousedown'); assert.equal(events.at(-1).type, 'mouseup');
    assert.ok(moves.every(e => e.buttons === 1 && e.x >= 20 && e.x <= 150 && e.y >= 30 && e.y <= 100));
    if (duration >= 500) assert.ok(moves.some(e => e.x > 20 && e.x < 150), 'timed drag must move along its path');
  }
  await send('browser.navigate', { url: origin });
  const capture = await send('computer.screenshot', {});
  const geometry = capture.result.frame_geometry;
  const imageDrag = await send('computer.drag', {from_x:20,from_y:30,to_x:150,to_y:100,duration_ms:500,
    coordinate_space:'image_pixels',frame:geometry.frame,document_id:geometry.document_id});
  assert.equal(imageDrag.error, undefined, JSON.stringify(imageDrag));
  const imageRead = await send('computer.action', { action:'text',selector:{role:'region',name:'Telemetry',exact:true} });
  const imageEvents = JSON.parse(imageRead.result.text);
  assert.equal(imageEvents.filter(e => e.type === 'mousedown').length, 1);
  assert.equal(imageEvents.filter(e => e.type === 'mouseup').length, 1);
  assert.ok(imageEvents.at(-1).time-imageEvents[0].time >= 475);
  for (const duration of [-1, 0.5, 5001]) {
    await send('browser.navigate', { url: origin });
    const result = await send('computer.action', { action: 'drag', from_x: 20, from_y: 30, to_x: 150, to_y: 100, duration_ms: duration });
    assert.equal(result.error, 'INVALID_REQUEST'); assert.equal(result.result.action_executed, false);
    const read = await send('computer.action', { action: 'text', selector: { role: 'region', name: 'Telemetry', exact: true } });
    assert.deepEqual(JSON.parse(read.result.text), []);
  }
  helper.stdin.end(); await exited;
  if (mode === 'connected') { assert.equal(selected.isClosed(), false); assert.equal(other.url(), 'about:blank#unrelated'); }
});

for (const interruption of ['cancel', 'takeover', 'document', 'transport']) test('timed drag ' + interruption + ' releases held input without finishing or replaying', { timeout: 10000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent(fixture);
  const session = await page.context().newCDPSession(page);
  const controller = new BrowserComputerController(session); await controller.initialize();
  const original = session.send.bind(session);
  let timer, interrupted = false;
  t.after(() => clearTimeout(timer));
  session.send = async (method, parameters) => {
    const response = await original(method, parameters);
    if (method === 'Input.dispatchMouseEvent' && parameters.type === 'mouseMoved' && parameters.buttons === 1 && !interrupted) {
      interrupted = true;
      if (interruption === 'transport') throw new Error('reply lost after input');
      const stop = () => interruption === 'document' ? controller.page.invalidate() : controller.cancel(interruption === 'cancel');
      timer = setTimeout(stop, 1);
    }
    return response;
  };
  const start = performance.now();
  const result = await controller.execute({ tool_name: 'computer.action', args: { action: 'drag', from_x: 20, from_y: 30, to_x: 250, to_y: 150, duration_ms: 5000 }, script_operation: true });
  assert.ok(interrupted); assert.ok(performance.now() - start < 1500, 'interruption must not wait for the duration');
  assert.ok(result.error || result.safety?.level === 'takeover', JSON.stringify(result));
  if (interruption === 'transport') assert.equal(result.error, 'EFFECT_OUTCOME_UNKNOWN');
  if (interruption === 'document') assert.equal(result.error, 'STALE_REFERENCE');
  assert.equal(controller.page.heldInput.size, 0);
  const events = await page.evaluate(() => window.events);
  assert.equal(events.filter(e => e.type === 'mousedown').length, 1);
  assert.equal(events.filter(e => e.type === 'mouseup').length, 1);
  assert.equal(events.at(-1).type, 'mouseup');
  assert.ok(!events.some(e => e.type === 'mousemove' && e.x === 250), 'interruption must not finish the path');
  if (interruption !== 'transport') {
    const lastMove = events.findLast(e => e.type === 'mousemove');
    assert.deepEqual([events.at(-1).x, events.at(-1).y], [lastMove.x, lastMove.y]);
  }
});
