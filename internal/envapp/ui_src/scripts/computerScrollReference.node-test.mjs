/* global document, scrollY */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { createComputerBrowserSource } from './computerBrowserSource.mjs';

async function fixture(html, run) {
  const browser = await chromium.launch({headless:true});
  try {
    const tab = await browser.newPage({viewport:{width:1000,height:700}});
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab), send = session.send.bind(session);
    const inputs = [];
    session.send = async (method, params) => { if (method.startsWith('Input.')) inputs.push({method,params}); return send(method,params); };
    const controller = new BrowserComputerController(session); await controller.initialize();
    const call = (action, selector, extra={}) => controller.execute({target_id:'contract',tool_name:'computer.action',args:{action,selector,...extra},full_access:true,script_operation:true});
    try { await run({tab,session,send:session.send.bind(session),inputs,controller,call}); }
    finally { controller.close(); await session.detach(); }
  } finally { await browser.close(); }
}

for (const c of [
  {name:'short document',html:'<p>Short</p>',role:'RootWebArea',moves:false},
  {name:'tall document',html:'<style>body{margin:0;height:3000px}</style><p>Long</p>',role:'RootWebArea',moves:true},
  {name:'tall region',html:'<section role="region" style="height:3000px" aria-label="Content">Long</section>',role:'region',moves:true},
  {name:'clipped tall region',html:'<div style="height:150px;overflow:auto"><section role="region" style="height:3000px" aria-label="Content">Long</section></div>',role:'region',moves:true,container:'div'},
  {name:'transformed clipped region',html:'<div style="transform:scale(.6);transform-origin:0 0;margin:150px;height:180px;overflow:auto"><section role="region" style="height:3000px" aria-label="Content">Long</section></div>',role:'region',moves:true,container:'div'},
  {name:'disabled descendant region',html:'<section role="region" aria-disabled="true" style="height:180px;overflow:auto" aria-label="Content"><div style="height:3000px">Long</div></section>',role:'region',moves:true,container:'section'},
]) test('semantic scroll uses visible geometry: '+c.name, () => fixture(c.html,async ({tab,inputs,call})=>{
  const r=await call('scroll',{role:c.role},{delta_y:300});
  assert.equal(r.error,undefined,JSON.stringify(r));
  assert.equal(inputs.filter(x=>x.params.type==='mouseWheel').length,1);
  assert.equal(r.result.scroll_progress.measurement,'immediate_after_dispatch');
  if(c.moves) await tab.waitForFunction(selector=>(selector?document.querySelector(selector).scrollTop:scrollY)>0,c.container||null);
  else assert.equal(await tab.evaluate(()=>scrollY),0);
}));

test('covered region rejects without wheel input',()=>fixture('<section role="region" aria-label="Content" style="height:3000px">Long</section><div style="position:fixed;inset:0;z-index:100;background:white"></div>',async({inputs,call})=>{
  assert.equal((await call('scroll',{role:'region'},{delta_y:300})).error,'ELEMENT_NOT_ACTIONABLE');
  assert.equal(inputs.length,0);
}));

test('scroll geometry failure retains preparation without wheel input',()=>fixture('<section role="region" style="margin-top:100px;height:3000px" aria-label="Content">Long</section>',async({session,send,inputs,call})=>{
  const diagnostic={phase:'protocol',method:'Runtime.callFunctionOn',code:-32603};
  session.send=async(m,p)=>{
    if(m==='Runtime.callFunctionOn'&&p.functionDeclaration.startsWith('async function'))throw Object.assign(new Error('private geometry failure'),{protocolDiagnostic:diagnostic});
    return send(m,p);
  };
  const result=await call('scroll',{role:'region'},{delta_y:300});
  assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE',JSON.stringify(result));
  assert.equal(result.result.observation_stage,'hit_test');
  assert.deepEqual(result.result.diagnostic,diagnostic);
  assert.equal(result.result.action_executed,true,'completed preparation survives the failed read');
  assert.equal(inputs.length,0);
}));

for (const action of ['read','click']) for (const method of ['DOM.describeNode','Accessibility.getPartialAXTree']) test(action+' preserves unknown validation failure from '+method,()=>fixture('<button>Stable target</button>',async({session,send,inputs,controller,call})=>{
  const entry=await controller.page.resolve({role:'button'});
  let failures=0;
  const diagnostic={phase:'protocol',method,code:-32603};
  session.send=async(m,p)=>{if(m===method&&failures++===0)throw Object.assign(new Error('private data'),{protocolDiagnostic:diagnostic});return send(m,p);};
  const result=await call(action,{ref:entry.ref});
  assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE',JSON.stringify(result));
  assert.deepEqual(result.result.diagnostic,diagnostic);
  assert.equal(controller.page.references.has(entry.ref),true);
  assert.equal(inputs.length,0);
  assert.equal(JSON.stringify(result).includes('private data'),false);
  session.send=send;
  assert.equal((await call('read',{ref:entry.ref})).error,undefined,'explicit later validation can recover');
  await tabNameChange();
  async function tabNameChange(){await session.send('Runtime.evaluate',{expression:'document.querySelector("button").textContent="Changed"'});}
  assert.equal((await call('read',{ref:entry.ref})).error,'STALE_REFERENCE');
}));

for (const payload of [{nodes:null},{nodes:[null]},{nodes:[{nodeId:'malformed',ignored:false}]}]) test('malformed identity read is unavailable: '+JSON.stringify(payload),()=>fixture('<button>Stable</button>',async({session,send,inputs,controller,call})=>{
  const entry=await controller.page.resolve({role:'button'});
  if(payload.nodes?.[0]) payload.nodes[0].backendDOMNodeId=entry.backendNodeId;
  session.send=async(m,p)=>m==='Accessibility.getPartialAXTree'?payload:send(m,p);
  assert.equal((await call('click',{ref:entry.ref})).error,'TARGET_OBSERVATION_UNAVAILABLE');
  assert.equal(inputs.length,0);
  assert.equal(controller.page.references.has(entry.ref),true);
}));

test('semantic wheel retains shadow and frame ownership',async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    if(req.url==='/frame')res.end('<style>body{margin:0}</style><section role="region" aria-label="Content" style="height:3000px">Frame content</section>');
    else if(req.url==='/shadow')res.end('<div id="host" style="height:160px;overflow:auto"></div><script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML=\'<section role="region" aria-label="Content" style="height:3000px">Shadow content</section>\'</script>');
    else res.end('<style>body{margin:0}iframe{margin:50px;width:400px;height:250px;transform:scale(.8);transform-origin:0 0}</style><iframe src="http://'+(req.url==='/cross'?'localhost':'127.0.0.1')+':'+server.address().port+'/frame"></iframe>');
  });
  await new Promise(resolve=>server.listen(0,resolve));
  const browser=await chromium.launch({headless:true,args:['--site-per-process']});
  try {
    for(const route of ['/same','/cross','/shadow'])await t.test(route,async()=>{
      const tab=await browser.newPage();await tab.goto('http://127.0.0.1:'+server.address().port+route);
      const owner=await createComputerBrowserSource(tab,'scroll-frames');
      try {
        const call=selector=>owner.controller.execute({target_id:'scroll-frames',tool_name:'computer.action',args:{action:'scroll',selector,delta_y:180},full_access:true,script_operation:true});
        const result=await call({role:'region',name:'Content',exact:true});
        assert.equal(result.error,undefined,JSON.stringify(result));
        const frame=route==='/shadow'?tab.mainFrame():tab.frames().find(f=>f!==tab.mainFrame());
        await frame.waitForFunction(()=>document.getElementById('host')?document.getElementById('host').scrollTop>0:scrollY>0);
        await tab.evaluate(()=>{const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:100;background:white';document.body.append(cover);});
        const blocked=await call({role:'region',name:'Content',exact:true});
        assert.equal(blocked.error,'ELEMENT_NOT_ACTIONABLE',JSON.stringify(blocked));
      }finally{await owner.dispose();await tab.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
