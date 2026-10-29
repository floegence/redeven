/* global window, document, chrome */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { createComputerBrowserSource } from './computerBrowserSource.mjs';

for (const deviceScaleFactor of [1, 2]) test('real browser zoom preserves semantic and pixel input at DPR '+deviceScaleFactor, {timeout:120000}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flower-geometry-'));
  const extension = path.join(root, 'zoom'); await mkdir(extension);
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({manifest_version:3,name:'Geometry qualification',version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
  await writeFile(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
  const server = http.createServer((req,res) => {
    res.setHeader('content-type','text/html');
    const top = Number(new URL(req.url,'http://fixture').searchParams.get('top') || '100');
    if (!Number.isInteger(top) || top < 0 || top > 5000) { res.writeHead(400); res.end('Invalid top'); return; }
    res.end('<!doctype html><style>body{margin:0;height:5000px}button{position:absolute;left:200px;top:'+top+'px;width:100px;height:50px;background:#ff00ff;border:0;color:#ff00ff}</style><button onclick="window.hits=(window.hits||0)+1">Probe</button>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(root,'profile'), {headless:true,channel:'chromium',viewport:null,args:['--window-size=1200,900','--force-device-scale-factor='+deviceScaleFactor,'--disable-extensions-except='+extension,'--load-extension='+extension]});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const tab = await context.newPage(); await tab.goto(origin);
    for (const zoom of [0.8,1,1.25,1.5,2,2.2]) for (const scroll of [0,1500]) await t.test('zoom '+zoom+', scroll '+scroll, async () => {
      await worker.evaluate(async ({origin,zoom}) => {const tabs=await chrome.tabs.query({}); await chrome.tabs.setZoom(tabs.find(t=>t.url?.startsWith(origin)).id,zoom);},{origin,zoom});
      await tab.goto(origin+'/?top='+(scroll+100)); await tab.evaluate(y=>window.scrollTo(0,y),scroll);
      const session=await context.newCDPSession(tab), controller=new BrowserComputerController(session); await controller.initialize();
      const call=(tool_name,args={})=>controller.execute({target_id:'geometry',tool_name,args,full_access:true,script_operation:true});
      try {
        const shot=await call('computer.screenshot'); assert.equal(shot.error,undefined,JSON.stringify(shot));
        const png=PNG.sync.read(Buffer.from(shot.screenshot.data,'base64'));
        const dimensions=await tab.evaluate(()=>({width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio}));
        assert.ok(Math.abs(png.width-dimensions.width*dimensions.dpr)<3);
        assert.ok(Math.abs(png.height-dimensions.height*dimensions.dpr)<3);
        let x=0,y=0,n=0;
        for(let py=0;py<png.height;py++)for(let px=0;px<png.width;px++){const i=(py*png.width+px)*4;if(png.data[i]>240&&png.data[i+1]<20&&png.data[i+2]>240){x+=px;y+=py;n++;}}
        assert.ok(n>0,'visible button must exist in screenshot');
        const g=shot.result.frame_geometry;
        const clicked=await call('computer.click',{x:x/n,y:y/n,coordinate_space:'image_pixels',frame:g.frame,document_id:g.document_id});
        assert.equal(clicked.error,undefined,JSON.stringify(clicked)); assert.equal(await tab.evaluate(()=>window.hits),1,'pixel input must hit the rendered button');
        const semantic=await call('computer.action',{action:'click',selector:{role:'button',name:'Probe',exact:true}});
        assert.equal(semantic.error,undefined,JSON.stringify(semantic)); assert.equal(await tab.evaluate(()=>window.hits),2,'semantic input must hit after scrolling');
        const beforeWheel=await tab.evaluate(()=>window.scrollY);
        const wheel=await call('computer.action',{action:'scroll',selector:{role:'RootWebArea'},delta_y:100});
        assert.equal(wheel.error,undefined,JSON.stringify(wheel));
        await tab.waitForFunction(before=>window.scrollY>before,beforeWheel);
        await tab.evaluate(()=>{const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:100;background:#eee';document.body.append(cover);});
        const covered=await call('computer.action',{action:'click',selector:{role:'button',name:'Probe',exact:true}});
        assert.equal(covered.error,'ELEMENT_NOT_ACTIONABLE'); assert.equal(await tab.evaluate(()=>window.hits),2);
      } finally {controller.close();await session.detach();}
    });
  } finally {await context?.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('scrolled nested containers, shadow roots and cross-process frames retain hit-test ownership', {timeout:30000}, async t => {
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    const port=server.address().port;
    if(req.url==='/frame') res.end('<style>body{height:4000px;margin:0}button{margin-top:1500px}</style><button onclick="this.textContent=\'Done\'">Frame probe</button>');
    else if(req.url==='/shadow') res.end('<div id="host" style="margin-top:1500px"></div><script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML=\'<button onclick="this.textContent=String(Number(this.textContent||0)+1)">0</button>\'</script>');
    else if(req.url==='/nested') res.end('<div style="margin-top:1500px;height:150px;overflow:auto"><div style="height:1600px"><button style="margin-top:1200px" onclick="this.textContent=\'Done\'">Nested probe</button></div></div>');
    else res.end('<style>body{height:4000px}iframe{margin-top:1200px;width:400px;height:250px}</style><iframe src="http://'+(req.url==='/cross'?'localhost':'127.0.0.1')+':'+port+'/frame"></iframe>');
  });
  await new Promise(resolve=>server.listen(0,resolve));
  const browser=await chromium.launch({headless:true,args:['--site-per-process']});
  try {
    for(const route of ['/same','/cross','/nested','/shadow']) await t.test(route,async()=>{
      const tab=await browser.newPage(); await tab.goto('http://127.0.0.1:'+server.address().port+route);
      const owner=await createComputerBrowserSource(tab,'frames');
      try {
        const ctrl=owner.controller;
        const name=route==='/shadow'?'0':route==='/nested'?'Nested probe':'Frame probe';
        const call=()=>ctrl.execute({target_id:'frames',tool_name:'computer.action',args:{action:'click',selector:{role:'button',name,exact:true}},full_access:true,script_operation:true});
        const result=await call();assert.equal(result.error,undefined,JSON.stringify(result));
        const frame=route==='/same'||route==='/cross'?tab.frames().find(f=>f!==tab.mainFrame()):tab.mainFrame();
        assert.equal(await frame.getByRole('button').textContent(),route==='/shadow'?'1':'Done');
        await frame.getByRole('button').evaluate((e,name)=>e.textContent=name,name);
        await tab.evaluate(()=>{const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:100;background:#aaa';document.body.append(cover);});
        const blocked=await call();assert.equal(blocked.error,'ELEMENT_NOT_ACTIONABLE',JSON.stringify(blocked));
        assert.equal(await frame.getByRole('button').textContent(),name,'top-level overlay must block iframe input');
      }finally{await owner.dispose();await tab.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
