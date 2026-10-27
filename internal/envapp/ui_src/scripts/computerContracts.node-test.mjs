/* global window */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

test('scoped collection pages reject changed contents and attributes are allowlisted', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage(); await tab.setContent('<a href="https://user:pass@example.test/path?token=secret#private">Entry</a><button>One</button><button>Two</button><button>Three</button>');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab)); await controller.initialize();
  const call=args=>controller.execute({target_id:'query',tool_name:'computer.action',args,script_operation:true});
  const first=await call({action:'query',selector:{role:'button'},limit:2}); assert.equal(first.result.total,3); assert.equal(first.result.items.length,2); assert.ok(first.result.next_cursor);
  const second=await call({action:'query',selector:{role:'button'},limit:2,cursor:first.result.next_cursor}); assert.equal(second.result.items[0].name,'Three'); assert.equal(second.result.truncated,false);
  const attr=await call({action:'attribute',selector:{role:'link',name:'Entry'},attribute:'href'}); assert.equal(attr.result.value,'https://example.test/path');
  const denied=await call({action:'attribute',selector:{role:'link',name:'Entry'},attribute:'value'}); assert.equal(denied.error,'INVALID_REQUEST');
  await tab.locator('button').last().evaluate(el=>el.remove());
  const stale=await call({action:'query',selector:{role:'button'},cursor:first.result.next_cursor}); assert.equal(stale.error,'STALE_REFERENCE');
  controller.close();
 } finally {await browser.close();}
});


test('image coordinates bind target, document and observed viewport at real device scale', async () => {
  const browser = await chromium.launch({headless:true,args:['--force-device-scale-factor=2']});
  try {
    const context=await browser.newContext({viewport:null}); const tab=await context.newPage();
    await tab.setContent(`<button style="position:fixed;left:100px;top:100px;width:100px;height:50px" onclick="document.title='hit'">Hit</button>`);
    const session=await context.newCDPSession(tab), controller=new BrowserComputerController(session); await controller.initialize();
    const request=(tool_name,args={})=>controller.execute({target_id:'fixture',tool_name,args,script_operation:true});
    const shot=await request('computer.screenshot'); const g=shot.result.frame_geometry;
    assert.equal(g.image.width/g.viewport.width,2);
    const point={x:150/g.transform.scale_x,y:125/g.transform.scale_y,coordinate_space:'image_pixels',frame:g.frame,document_id:g.document_id};
    const clicked=await request('computer.click',point); assert.equal(clicked.error,undefined,JSON.stringify(clicked)); assert.equal(await tab.title(),'hit');
    const wrong=await request('computer.click',{...point,frame:g.frame.replace('fixture','other')}); assert.equal(wrong.error,'STALE_REFERENCE'); assert.equal(wrong.result.action_executed,false);
    await session.send('Emulation.setDeviceMetricsOverride',{width:600,height:500,deviceScaleFactor:2,mobile:false});
    const resized=await request('computer.click',point); assert.equal(resized.error,'STALE_REFERENCE'); assert.equal(resized.result.action_executed,false);
    controller.close();
  } finally { await browser.close(); }
});


test('invalid locator keys are rejected before focus and expose a safe field diagnostic', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent(`<input aria-label="Probe" onfocus="document.title='focused'">`);
    const controller = new BrowserComputerController(await tab.context().newCDPSession(tab));
    await controller.initialize();
    const result = await controller.execute({tool_name:'computer.action', script_operation:true, args:{action:'key', selector:{role:'textbox',name:'Probe'}, key:'Meta+Equal'}});
    assert.equal(result.error, 'INVALID_REQUEST');
    assert.equal(await tab.title(), '');
    assert.equal(result.result.action_executed, false);
    assert.equal(result.result.diagnostic.field, 'key');
    assert.equal(result.result.diagnostic.phase, 'validation');
    controller.close();
  } finally { await browser.close(); }
});

test('omitted wait duration means no extra delay and still returns an observation', async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const tab = await browser.newPage();
    await tab.setContent('<title>Wait fixture</title>');
    const controller = new BrowserComputerController(await tab.context().newCDPSession(tab));
    await controller.initialize();
    const result = await controller.execute({tool_name:'computer.wait', args:{}});
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.result.title, 'Wait fixture');
    assert.ok(result.screenshot);
    controller.close();
  } finally { await browser.close(); }
});


test('invalid fields and mixed coordinate modes never prepare or focus the page', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage();await tab.setContent('<input aria-label="Probe">');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  let prepared=0;controller.page.preparePage=async()=>{prepared++;};
  for(const args of [
   {action:'key',selector:{role:'textbox'},key:'Enter',unknown:true},
   {action:'key',selector:{role:'textbox',exact:'yes'},key:'Enter'},
   {action:'key',key:'Enter',document_id:'stale'},
   {action:'pointer_click',x:-1,y:2},
   {action:'scroll',delta_y:1,x:2},
   {action:'attribute',attribute:'href'},
  ]) {
   const r=await controller.execute({tool_name:'computer.action',args,script_operation:true});
   assert.equal(r.error,'INVALID_REQUEST',JSON.stringify(r));assert.equal(r.result.action_executed,false);
  }
  assert.equal(prepared,0);controller.close();
 } finally {await browser.close();}
});

test('large queries return usable refs without exceeding output budget', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage();await tab.setContent(Array.from({length:2100},(_,i)=>'<button>Item '+i+'</button>').join(''));
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  const query=await controller.page.action({action:'query',selector:{role:'button'},limit:200});
  assert.equal(query.total,2100);assert.equal(query.items.length,200);assert.ok(Buffer.byteLength(JSON.stringify(query))<65536);
  const read=await controller.page.action({action:'read',selector:{ref:query.items[0].ref}});assert.equal(read.node.name,'Item 0');
  controller.close();
 }finally{await browser.close();}
});

for (const scale of [1,1.25,1.5,2]) test('image input follows captured pixels at scale '+scale, async () => {
 const {PNG}=await import('pngjs');
 const browser=await chromium.launch({headless:true,args:['--force-device-scale-factor='+scale]});
 try {
  const context=await browser.newContext({viewport:null});const tab=await context.newPage();
  await tab.setContent('<style>body{margin:0;height:3000px}button{position:fixed;left:100px;top:100px;width:80px;height:60px;background:rgb(255,0,0);border:0;color:red}</style><button onclick="document.title=String(Number(document.title||0)+1)"></button>');
  const session=await context.newCDPSession(tab),controller=new BrowserComputerController(session);await controller.initialize();
  const call=(tool_name,args={},extra={})=>controller.execute({target_id:'matrix',tool_name,args,script_operation:true,...extra});
  for (const zoom of [0.8,1,1.25,1.5]) {
   await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:zoom});
   const shot=await call('computer.screenshot');assert.equal(shot.error,undefined,JSON.stringify(shot.result));
   const png=PNG.sync.read(Buffer.from(shot.screenshot.data,'base64'));let sumX=0,sumY=0,n=0;
   for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(png.data[i]>245&&png.data[i+1]<10&&png.data[i+2]<10){sumX+=x;sumY+=y;n++;}}
   assert.ok(n>0);const g=shot.result.frame_geometry;
   const point={x:sumX/n,y:sumY/n,coordinate_space:'image_pixels',frame:g.frame,document_id:g.document_id};
   const before=Number(await tab.title()||0);
   await tab.evaluate("document.body.style.background='lightblue'");await call('computer.screenshot',{}, {live_frame:true});
   const clicked=await call('computer.click',point);assert.equal(clicked.error,undefined,JSON.stringify(clicked));assert.equal(Number(await tab.title()),before+1,'scale='+scale+' zoom='+zoom+' geometry='+JSON.stringify(g));
   const bad=await call('computer.click',{...point,document_id:'other'});assert.equal(bad.error,'STALE_REFERENCE');assert.equal(bad.result.action_executed,false);
  }
  await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  const beforeScroll=await call('computer.screenshot');
  await tab.evaluate("scrollTo(0,500)");
  const moved=await call('computer.click',{x:1,y:1,coordinate_space:'image_pixels',frame:beforeScroll.result.frame_geometry.frame,document_id:beforeScroll.result.frame_geometry.document_id});
  assert.equal(moved.error,'STALE_REFERENCE');assert.equal(moved.result.action_executed,false);
  const shot=await call('computer.screenshot');await tab.goto('about:blank');
  const stale=await call('computer.click',{x:1,y:1,coordinate_space:'image_pixels',frame:shot.result.frame_geometry.frame,document_id:shot.result.frame_geometry.document_id});assert.equal(stale.error,'STALE_REFERENCE');
  controller.close();
 }finally{await browser.close();}
});

test('scroll reports immediate measurements without inventing settling', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage();await tab.setContent('<div role="region" aria-label="List" style="height:100px;overflow:auto"><div style="height:900px">Content</div></div>');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  const result=await controller.execute({tool_name:'computer.action',args:{action:'scroll',selector:{role:'region',name:'List'},delta_y:80},script_operation:true});
  assert.equal(result.error,undefined);assert.equal(result.result.action_executed,true);assert.equal(result.result.scroll_progress.measurement,'immediate_after_dispatch');assert.equal(result.result.scroll_progress.before.scope,'nearest_scroll_container');
  controller.close();
 }finally{await browser.close();}
});

test('image transform excludes scrollbar width and maps an edge target exactly', async () => {
 const {PNG}=await import('pngjs');const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--force-device-scale-factor=2']});
 try {
  const context=await browser.newContext({viewport:null});const tab=await context.newPage();
  await tab.setContent('<style>html{overflow-y:scroll}::-webkit-scrollbar{width:30px}body{height:3000px}button{position:fixed;right:5px;top:100px;width:8px;height:30px;padding:0;border:0;background:rgb(255,0,0)}</style><button onclick="document.title=\'hit\'"></button>');
  const controller=new BrowserComputerController(await context.newCDPSession(tab));await controller.initialize();
  const shot=await controller.execute({target_id:'scrollbar',tool_name:'computer.screenshot',args:{},script_operation:true});
  const g=shot.result.frame_geometry,png=PNG.sync.read(Buffer.from(shot.screenshot.data,'base64'));let sx=0,sy=0,n=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(png.data[i]>245&&png.data[i+1]<10&&png.data[i+2]<10){sx+=x;sy+=y;n++;}}
  assert.ok(n);const result=await controller.execute({target_id:'scrollbar',tool_name:'computer.click',args:{x:sx/n,y:sy/n,coordinate_space:'image_pixels',frame:g.frame,document_id:g.document_id},script_operation:true});
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(await tab.title(),'hit',JSON.stringify(g));controller.close();
 }finally{await browser.close();}
});

test('table pages preserve cells, exclude nested rows and reject changed cursors',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const tab=await browser.newPage();await tab.setContent('<table aria-label="Domains"><tr><th>Domain</th><th>Score</th></tr><tr><td>One</td><td>7</td></tr><tr><td>Two</td><td>8</td></tr></table><table aria-label="Other"><tr><td>Unrelated</td></tr></table>');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  const call=args=>controller.execute({tool_name:'computer.action',script_operation:true,args});
  const first=await call({action:'table',selector:{role:'table',name:'Domains',exact:true},limit:2});
  assert.equal(first.error,undefined,JSON.stringify(first));assert.equal(first.result.total,3);assert.deepEqual(first.result.rows[0].cells,[{role:'columnheader',text:'Domain'},{role:'columnheader',text:'Score'}]);
  const second=await call({action:'table',selector:{role:'table',name:'Domains',exact:true},cursor:first.result.next_cursor});
  assert.deepEqual(second.result.rows[0].cells,[{role:'cell',text:'Two'},{role:'cell',text:'8'}]);assert.equal(second.result.truncated,false);
  await tab.locator('td').first().evaluate(e=>e.textContent='Changed');
  const stale=await call({action:'table',selector:{role:'table',name:'Domains',exact:true},cursor:first.result.next_cursor});assert.equal(stale.error,'STALE_REFERENCE');
  const denied=await call({action:'table',selector:{role:'cell',name:'Changed',exact:true}});assert.equal(denied.error,'INVALID_REQUEST');
  controller.close();
 }finally{await browser.close();}
});

test('table content and page budgets explicitly mark omitted cells and text',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const tab=await browser.newPage();await tab.setContent('<table role="table" aria-label="Huge"><tr>'+Array.from({length:300},()=>'<td>'+'x'.repeat(3000)+'</td>').join('')+'</tr><tr><td>Tail</td></tr></table>');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  const result=await controller.page.action({action:'table',selector:{role:'table',name:'Huge'},limit:1});
  assert.equal(result.total,2);assert.equal(result.rows[0].cells_truncated,true);assert.equal(result.rows[0].cells[0].text_truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<48000);
  const second=await controller.page.action({action:'table',selector:{role:'table',name:'Huge'},cursor:result.next_cursor});assert.equal(second.rows[0].cells[0].text,'Tail');
  controller.close();
 }finally{await browser.close();}
});

test('content waits observe asynchronous changes without repeating input', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage();await tab.setContent('<input aria-label="Page"><output aria-label="Status">old</output><button onclick="window.hits=(window.hits||0)+1;setTimeout(()=>{document.querySelector(\'input\').value=\'2\';document.querySelector(\'output\').textContent=\'new\'},150)">Next</button>');
  const controller=new BrowserComputerController(await tab.context().newCDPSession(tab));await controller.initialize();
  const call=args=>controller.execute({tool_name:'computer.action',args,script_operation:true});
  assert.deepEqual((await controller.execute({tool_name:'browser.download_cursor',script_operation:true})).result.downloads,[]);
  assert.equal((await call({action:'click',selector:{role:'button',name:'Next'}})).error,undefined);
  for(const [role,name,state,equals] of [['textbox','Page','value','2'],['status','Status','text','new']]){
   const result=await call({action:'wait',selector:{role,name},state,equals,timeout_ms:1000});
   assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.state,state);
  }
  assert.equal(await tab.evaluate(()=>window.hits),1);
  const timed=await call({action:'wait',selector:{role:'textbox',name:'Page'},state:'value',equals:'3',timeout_ms:0});assert.equal(timed.result.state,'timeout');
  const invalid=await call({action:'wait',selector:{role:'textbox'},state:'value'});assert.equal(invalid.result.diagnostic.field,'equals');controller.close();
 }finally{await browser.close();}
});
