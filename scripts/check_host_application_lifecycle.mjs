// Exercise actual browser popup closure with production viewer code and a
// controlled host stream. This is browser lifecycle evidence, not native capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
const {chromium, firefox, webkit} = require('playwright');
const output = process.argv[2];
assert(output, 'provide an evidence directory');
await mkdir(output, {recursive:true});
const asset = file => readFile(path.join(root, 'internal/codeapp/appserver/host_application_viewer', file), 'utf8');
const catalogSource = await asset('catalog.generated.js');
const catalog = JSON.parse(catalogSource.slice(catalogSource.indexOf(' = ') + 3).trim().slice(0, -1));
const css = (await Promise.all(['appearance.generated.css','remote-input.generated.css','remote-pointer.generated.css','viewer.css'].map(asset))).join('\n');
const js = (await Promise.all(['catalog.generated.js','viewport.generated.js','remote-input.generated.js','remote-pointer.generated.js','appearance.js','connection.js','toolbar.js','canvas.js','macos.js'].map(asset))).join('\n');
const html = (await asset('viewer.html')).replaceAll('{{.Locale}}','en-US').replaceAll('{{.Theme}}','porcelain-light')
  .replace('<script src="{{.TransportScript}}"></script>', '<script>window.RedevenWindowTransport={create:()=>({fetch:window.fetch.bind(window),WebSocket:window.WebSocket})};</script>')
  .replaceAll('{{.Name}}','Lifecycle fixture').replaceAll('{{.Nonce}}','fixture').replace('{{.Style}}',css)
  .replace('{{.Config}}',JSON.stringify({base:'/fixture',backend:'macos',icon:'',copy:catalog.locales['en-US']})).replace('{{.Script}}',js);
let state = {state:'running',password:'fixture'};
const server = createServer((req,res) => {
  if(req.url.endsWith('/state')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));}
  else {res.setHeader('Content-Type','text/html');res.end(req.url === '/' ? '<button onclick="window.open(\'/fixture/viewer\')">Open fixture</button>' : html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const browserType of [chromium,firefox,webkit]) {
    const browser = await browserType.launch({headless:true});
    try {
      for(const scenario of ['windows_closed','application_exited','sharing_stopped','unknown','before_frame','waiting','direct']) {
        state = {state:'running',password:'fixture'};
        const context = await browser.newContext();
        const evidence = {browser:browserType.name(),version:browser.version(),scenario,events:[]};
        let stream;
        await context.exposeBinding('recordLifecycle',(_source,event)=>evidence.events.push(event));
        await context.addInitScript(()=>{
          if(window.close.lifecycleInstrumented) return;
          const close = window.close.bind(window);
          window.close = function() { void window.recordLifecycle({type:'close_call',stack:new Error().stack}); close(); };
          window.close.lifecycleInstrumented=true;
        });
        await context.routeWebSocket('**/_redeven_host_app/stream',socket=>{
          stream=socket;
          socket.onMessage(message=>{
            const request=JSON.parse(message);
            if(request.action==='frame_ack') evidence.events.push({type:'first_frame_ack',generation:request.generation});
          });
        });
        const parent = await context.newPage();
        await parent.goto(origin);
        const page = scenario==='direct' ? parent : await Promise.all([
          context.waitForEvent('page'),parent.locator('button').click(),
        ]).then(([page])=>page);
        if(scenario==='direct') await page.goto(origin+'/fixture/viewer');
        await page.waitForFunction(()=>document.body.dataset.state==='connecting');
        for(let i=0;!stream&&i<100;i++) await new Promise(resolve=>setTimeout(resolve,10));
        assert(stream,'stream was not opened');
        page.on('close',()=>evidence.events.push({type:'page_closed'}));
        page.on('response',response=>{if(response.url().endsWith('/state')) evidence.events.push({type:'state_response',status:response.status()});});
        if(scenario==='before_frame') {
          stream.send(JSON.stringify({type:'waiting',generation:1}));
          await page.waitForFunction(()=>document.body.dataset.state==='waiting');
        } else {
          stream.send(JSON.stringify({type:'window',input_version:1,window:'fixture-instance',generation:1,width:8,height:8}));
          const pixels = await parent.screenshot({clip:{x:0,y:0,width:8,height:8}});
          const header = Buffer.from(JSON.stringify({codec:'png',generation:1,frame_id:1,transport:'images'}));
          const size = Buffer.alloc(4);size.writeUInt32BE(header.length);
          stream.send(Buffer.concat([size,header,pixels]));
          await page.waitForFunction(()=>document.body.dataset.state==='active');
          if(scenario==='waiting') {
            stream.send(JSON.stringify({type:'waiting',generation:2}));
            await page.waitForFunction(()=>document.body.dataset.state==='waiting');
            await page.locator('#retry').waitFor({state:'visible'});
            assert((await page.locator('#hint').innerText()).includes('temporarily unavailable'));
            await page.screenshot({path:path.join(output,`${browserType.name()}-waiting.png`),animations:'disabled'});
            assert.equal(page.isClosed(),false);
          }
        }
        state={state:'ended',end_reason:['unknown'].includes(scenario)?'unrecognized':'windows_closed'};
        if(['application_exited','sharing_stopped'].includes(scenario)) state.end_reason=scenario;
        evidence.events.push({type:'host_state',...state},{type:'websocket_close'});
        const closes=!['unknown','before_frame','direct'].includes(scenario);
        const closed=closes?page.waitForEvent('close'):null;
        stream.close({code:1000,reason:'fixture transition'});
        if(closed) await closed;
        else {
          await page.waitForFunction(()=>['ended','windowsClosed'].includes(document.body.dataset.state));
          assert.equal(page.isClosed(),false);
          assert(!evidence.events.some(event=>event.type==='close_call'));
        }
        if(closes) {
          assert.equal(evidence.events.filter(event=>event.type==='close_call').length,1,JSON.stringify(evidence));
          assert(evidence.events.find(event=>event.type==='close_call').stack.includes('dismissEnded'));
          assert(evidence.events.some(event=>event.type==='first_frame_ack'));
        }
        evidence.passed=true;
        results.push(evidence);
        await context.close();
      }
    } finally {await browser.close();}
  }
  await writeFile(path.join(output,'browser-lifecycle.json'),JSON.stringify(results,null,2)+'\n');
  console.log(`Passed ${results.length} browser lifecycle cases with actual popup close events.`);
} finally {await new Promise(resolve=>server.close(resolve));}
