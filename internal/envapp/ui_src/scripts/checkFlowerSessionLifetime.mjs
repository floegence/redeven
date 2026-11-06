/* global window */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const fixture = JSON.parse(process.env.REDEVEN_FLOWER_SESSION_FIXTURE);
const bundled = await build({ stdin: { contents: `
import { parseArtifact, createArtifactLease } from '@floegence/flowersec-core';
import { connectProxyBrowser } from '@floegence/flowersec-core/proxy';
import { fetchServerSentEvents } from '@floegence/floe-webapp-boot';
import { bindSessionHTTP, fetchSessionHTTP, readSessionEvents } from './src/ui/services/sessionHTTP';
window.qualify = async fixture => {
 const lease = createArtifactLease(parseArtifact(fixture.artifact), async () => {});
 const connection = await connectProxyBrowser(lease, { runtime: { externalOrigin: fixture.appOrigin, maxBodyBytes: 1024 } });
 const unbind = bindSessionHTTP({fetch: connection.runtime.fetch,
  events: (input, options) => fetchServerSentEvents(input, {...options, headers: {Accept:"text/event-stream"}, fetch: connection.runtime.fetch})});
 try {
  const started = performance.now();
  const command = fetchSessionHTTP('/command', {method:'POST',body:'{}'}).then(async response => ({status:response.status, body:await response.json()}));
  const events = (async()=>{const frames=[];for await(const frame of readSessionEvents('/events'))frames.push(frame.data);return frames;})();
  const [receipt, frames] = await Promise.all([command, events]);
  const controller = new AbortController();
  const pending = fetchSessionHTTP('/hold',{signal:controller.signal}).then(()=>false,()=>true);
  await new Promise(resolve=>setTimeout(resolve,200)); controller.abort();
  const cancelled=await pending;
  const bounded=await fetchSessionHTTP('/oversize').then(response=>response.arrayBuffer()).then(()=>false,()=>true);
  const terminated=fetchSessionHTTP('/hold').then(()=>false,()=>true);
  await new Promise(resolve=>setTimeout(resolve,200)); await connection.session.close();
  return {receipt,frames,cancelled,bounded,terminated:await terminated,elapsed:performance.now()-started};
 } finally { unbind(); await connection.dispose(); }
};`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, nodePaths:[fileURLToPath(new URL('../node_modules', import.meta.url))], bundle:true, write:false, format:'iife', platform:'browser' });
const browser = await chromium.launch({headless:true,args:['--ignore-certificate-errors','--redeven-flower-session-acceptance']});
try {
 const context=await browser.newContext({ignoreHTTPSErrors:true});
 await context.grantPermissions(['local-network-access'],{origin:fixture.controllerOrigin});
 const page=await context.newPage();
 const sockets=[],errors=[];
 page.on('websocket',socket=>sockets.push(socket.url()));
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(fixture.controllerOrigin+'/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
 await page.goto(fixture.controllerOrigin);
 await page.addScriptTag({content:bundled.outputFiles[0].text});
 const result=await page.evaluate(fixture=>window.qualify(fixture),fixture);
 assert.deepEqual(result.receipt,{status:202,body:{ok:true,data:{accepted:true}}});
 assert.deepEqual(result.frames,['ready','completed']);
 assert.equal(result.cancelled,true);assert.equal(result.bounded,true);assert.equal(result.terminated,true);
 assert.ok(result.elapsed>=130000);assert.equal(sockets.length,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({...result,networkSockets:sockets.length}));
 await context.close();
} finally {await browser.close();}
