/* global window, document, RedevenWindowTransport */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const require = createRequire(new URL('../../../envapp/ui_src/package.json', import.meta.url));
const { chromium } = require('playwright');
const fixture = JSON.parse(process.env.REDEVEN_WINDOW_TUNNEL_FIXTURE);
const product = readFileSync(new URL('../../ui/dist/window-transport.js', import.meta.url), 'utf8');
const bundled = await build({ stdin: { contents: `
import { parseArtifact, createArtifactLease } from '@floegence/flowersec-core';
import { connectProxyControllerBrowser } from '@floegence/flowersec-core/proxy';
window.connectFixture = async (fixture) => {
  const lease = createArtifactLease(parseArtifact(fixture.artifact), async () => {});
  window.connection = await connectProxyControllerBrowser(lease, {
    runtime: { externalOrigin: fixture.appOrigin, maxWsFrameBytes: 33554432, maxWsBufferedAmountBytes: 67108864 },
    controller: { allowedOrigins: [fixture.appOrigin], capabilityNonce: 'window-test-capability' }
  });
};`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--redeven-window-tunnel-acceptance'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.grantPermissions(['local-network-access'], { origin: fixture.controllerOrigin });
  const page = await context.newPage();
  const sockets = [], errors = [];
  page.on('websocket', socket => { sockets.push(socket.url()); socket.on('socketerror', error => console.error(String(error))); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route(fixture.controllerOrigin + '/**', route => route.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.route(fixture.appOrigin + '/**', route => {
    assert.equal(new URL(route.request().url()).pathname,'/','app must not request graphical data directly');
    return route.fulfill({contentType:'text/html',body:'<html></html>'});
  });
  await page.goto(fixture.controllerOrigin);
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.evaluate(fixture => window.connectFixture(fixture),fixture);
  await page.evaluate(origin => { const frame=document.createElement('iframe');frame.src=origin;document.body.append(frame); },fixture.appOrigin);
  const frame = await page.waitForSelector('iframe').then(handle => handle.contentFrame());
  await frame.waitForLoadState();
  await frame.evaluate(() => {
    sessionStorage.setItem('redeven_app_bridge_capability_nonce','window-test-capability');
    sessionStorage.setItem('redeven_app_max_ws_frame_bytes','33554432');
  });
  await frame.addScriptTag({content:product});
  const result = await frame.evaluate(async () => {
    const transport=RedevenWindowTransport.create({kind:'tunnel',forward_id:'window',base:''});
    const state=await transport.fetch('/state').then(response=>response.json());
    const open=path=>new Promise((resolve,reject)=>{const socket=new transport.WebSocket(window.location.origin.replace('https:','wss:')+path);socket.binaryType='arraybuffer';socket.onopen=()=>resolve(socket);socket.onerror=()=>reject(new Error('native stream failed'));});
    const [control,media]=await Promise.all([open('/control'),open('/media')]);
    const echoed=(socket,data)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('echo timeout '+socket.url)),10000);socket.onmessage=event=>{clearTimeout(timer);resolve(event.data)};socket.onclose=event=>{clearTimeout(timer);reject(new Error('echo closed '+socket.url+' '+event.code+' '+event.reason));};socket.send(data);});
    const text='office: 中文 😀';
    const bytes=new Uint8Array(4*1024*1024+17);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    const [ack,output]=await Promise.all([echoed(control,text),echoed(media,bytes)]);
    const received=new Uint8Array(output);
    const intact=received.length===bytes.length&&received.every((value,i)=>value===bytes[i]);
    const bounded=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('oversized frame did not close its stream')),5000);
      media.onmessage=()=>{clearTimeout(timer);reject(new Error('oversized frame reached the upstream'));};
      media.onclose=event=>{clearTimeout(timer);resolve(event.code===1006 && media.readyState===WebSocket.CLOSED && media.bufferedAmount===0);};
      media.send(new Uint8Array(33554433));
    });
    control.close();media.close();transport.dispose();
    return {state:state.ok,control:ack===text,bytes:received.length,intact,bounded};
  });
  assert.deepEqual(result,{state:true,control:true,bytes:4194321,intact:true,bounded:true});
  assert.equal(sockets.length,1);
  assert.ok(new URL(sockets[0]).pathname.includes('/tunnel'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...result,carrier:'flowersec-tunnel',networkSockets:sockets.length}));
  await page.evaluate(()=>window.connection.dispose());
  await context.close();
} finally { await browser.close(); }
