/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

async function fixture(html, run) {
  const browser = await chromium.launch({headless:true});
  let controller;
  try {
    const tab = await browser.newPage({viewport:{width:800,height:600}});
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab);
    controller = new BrowserComputerController(session);
    await controller.initialize();
    const call = (tool_name,args={}) => controller.execute({target_id:'factual',tool_name,args,script_operation:true,full_access:true});
    await run({tab,controller,session,call});
  } finally { if(controller){await controller.page.releasePage();controller.close();}await browser.close(); }
}

test('unsupported layout reports capability facts without prescribing recovery',()=>fixture('<main><!--state marker--><button>Ready</button></main>',async({controller,session})=>{
  const entry=await controller.page.resolve({role:'button',name:'Ready',exact:true});
  const {root}=await session.send('DOM.getDocument',{depth:-1});
  const pending=[root];let comment;
  while(pending.length){const node=pending.pop();if(node.nodeType===8){comment=node;break;}pending.push(...(node.children??[]));}
  assert.ok(comment,'fixture comment missing');
  await assert.rejects(controller.page.elementState({...entry,backendNodeId:comment.backendNodeId}),error=>{
    assert.equal(error.message,'TARGET_CAPABILITY_UNAVAILABLE');
    assert.deepEqual(error.diagnostic,{phase:'read',method:'element_state',expected:'element_or_text_layout'});
    return true;
  });
}));

test('nested wheel reports only the explicit measured element, never a guessed receiver',()=>fixture('<style>body{margin:0}main{width:600px;height:300px;overflow:hidden}#inner{width:580px;height:280px;overflow:auto}#content{height:2000px}</style><main><div id="inner"><div id="content">Content</div></div></main>',async({tab,call})=>{
  const observed=await call('computer.observe');
  const main=observed.result.observation.nodes.find(n=>n.role==='main');
  const r=await call('computer.action',{action:'scroll',selector:{ref:main.ref},delta_y:200});
  assert.equal(r.error,undefined,JSON.stringify(r));
  await tab.waitForFunction(()=>document.querySelector('#inner').scrollTop===200);
  const p=r.result.scroll_progress;
  assert.equal(p.measured_ref,main.ref);
  assert.equal(p.scope,'requested_element');
  assert.equal(p.before.y,0);assert.equal(p.after.y,0);
  assert.equal(p.offset_changed,false);
  assert.equal(p.changed,undefined);
  assert.equal(p.scroll_effect,'unknown');
  assert.equal(r.result.input_dispatched,true);
}));

test('pure input returns a receipt without a post-action metadata read',()=>fixture('<button>Act</button>',async({controller,call})=>{
  const inFrame=controller.page.inFrame.bind(controller.page);
  controller.page.inFrame=(frame,expression,accepts)=>{if(expression==='({url:document.URL,title:document.title})')throw new Error('metadata unavailable');return inFrame(frame,expression,accepts);};
  const r=await call('computer.action',{action:'click',selector:{role:'button',name:'Act'}});
  assert.equal(r.error,undefined,JSON.stringify(r));
  assert.equal(r.result.action_executed,true);
  assert.equal(r.result.needs_observation,true);
  assert.equal(r.result.title,undefined);assert.equal(r.result.url,undefined);
  assert.equal(r.safety.safe_to_send_to_model,false);
  assert.equal((await call('computer.observe')).error,'TARGET_OBSERVATION_UNAVAILABLE');
}));

test('reads scan at entry and final publication; waits report time and samples',()=>fixture('<button>Ready</button>',async({controller,call})=>{
  let scans=0;const safety=controller.page.safety.bind(controller.page);
  controller.page.safety=(...args)=>{scans++;return safety(...args);};
  assert.equal((await call('computer.observe')).error,undefined);assert.equal(scans,2);
  scans=0;
  const r=await call('computer.action',{action:'wait',selector:{role:'button',name:'Absent'},state:'visible',timeout_ms:220});
  assert.equal(r.result.state,'timeout');assert.ok(r.result.elapsed_ms>=220);
  assert.ok(r.result.samples>=2);assert.ok(scans<=r.result.samples+2);
  assert.equal(r.result.title,undefined);assert.equal(r.result.requested_state,'visible');
}));

test('browser node actions do not guess supported input from role',()=>fixture('<table aria-label="Data"><tr><th>Metric</th></tr><tr><td>Count</td></tr></table>',async({call})=>{
  const r=await call('computer.observe');const cell=r.result.observation.nodes.find(n=>n.role==='cell');
  assert.equal(cell.actions_scope,'declared_only');
  assert.deepEqual(cell.actions,['read']);
  assert.equal((await call('computer.action',{action:'click',selector:{ref:cell.ref}})).result.action_executed,true);
}));

test('attribute href preserves source and rejects retired summary requests',()=>fixture('<a href="https://user:pass@example.test/report?period=7#daily">Report</a>',async({call})=>{
  const args={action:'attribute',selector:{role:'link',name:'Report'},attribute:'href'};
  const raw=await call('computer.action',args);
  assert.equal(raw.result.value,'https://example.test/report?period=7#daily');
  assert.deepEqual(raw.result.redacted,['url_credentials']);
  const summary=await call('computer.action',{...args,summary:true});
  assert.equal(summary.error,'INVALID_REQUEST');
}));

for(const transition of ['scan_failure','private_input','permission','cancel']) {
  test('acknowledged input retains the '+transition+' boundary',()=>fixture('<button>Act</button>',async({controller,tab,session,call})=>{
    const action=controller.page.action.bind(controller.page);
    let dispatched=0;const send=session.send.bind(session);
    session.send=(method,args)=>{if(method==='Input.dispatchMouseEvent'&&args.type==='mousePressed')dispatched++;return send(method,args);};
    controller.page.action=async args=>{
      const result=await action(args);
      if(transition==='scan_failure')controller.page.safety=async()=>{throw new Error('unavailable');};
      if(transition==='private_input')await tab.evaluate(()=>{const input=document.createElement('input');input.type='password';document.body.append(input);});
      if(transition==='permission')controller.page.requiredURL='https://ungranted.test/';
      if(transition==='cancel')controller.page.operationCancelled=true;
      return result;
    };
    const result=await call('computer.action',{action:'click',selector:{role:'button',name:'Act'}});
    assert.equal(dispatched,1);assert.equal(result.result.action_executed,true);
    assert.equal(result.result.title,undefined);assert.equal(result.result.observation,undefined);
    if(transition==='scan_failure'){
      assert.equal(result.error,undefined);assert.equal(result.result.post_action_check.state,'unavailable');
      assert.equal(result.safety.safe_to_send_to_model,false);
    }else if(transition==='private_input')assert.equal(result.safety.level,'takeover');
    else assert.equal(result.error,transition==='permission'?'TARGET_PERMISSION_REQUIRED':'TARGET_OBSERVATION_UNAVAILABLE');
  }));
}

test('table cell references reach complete source text beyond its displayed prefix',()=>fixture('<table aria-label="Data"><tr><th>Metric</th></tr><tr><td>'+ 'x'.repeat(2100) +'TAIL</td></tr></table>',async({call})=>{
  const result=await call('computer.action',{action:'table',selector:{role:'table',name:'Data'}});
  const cell=result.result.rows[1].cells[0];
  assert.equal(cell.text_truncated,true);assert.ok(cell.ref);
  const source=await call('computer.action',{action:'source',selector:{ref:cell.ref},source:'dom',field:'textContent'});
  assert.equal(source.result.value.endsWith('TAIL'),true);assert.equal(source.result.truncated,false);
}));

for(const mode of ['initial_document','private_input','ungranted_origin','invalid_document_url']) {
 test('empty child-frame URL uses its actual document without bypassing '+mode,()=>fixture('<h1>Parent</h1><iframe></iframe>',async({tab,controller,session,call})=>{
  const frame=tab.frames().find(f=>f!==tab.mainFrame());
  if(mode==='private_input')await frame.setContent('<input type="password" value="never-export">');
  const send=session.send.bind(session);let documentReads=0;
  session.send=async(method,args)=>{
   const result=await send(method,args);
   if(method==='Page.getFrameTree')for(const child of result.frameTree.childFrames??[])child.frame.url='';
   if(method==='Runtime.evaluate'&&args.expression==='document.URL'){
    documentReads++;
    if(mode==='ungranted_origin')result.result={type:'string',value:'https://ungranted.test/frame'};
    if(mode==='invalid_document_url')result.result={type:'string',value:''};
   }
   return result;
  };
  const result=mode==='ungranted_origin'?await controller.execute({tool_name:'computer.observe',script_operation:true,allowed_origins:[]}):await call('computer.observe');
  assert.ok(documentReads>0);
  if(mode==='initial_document'){
   assert.equal(result.error,undefined,JSON.stringify(result));
   assert.ok(result.result.observation.nodes.some(n=>n.name==='Parent'));
  }else if(mode==='invalid_document_url'){
   assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
   assert.deepEqual(result.result.diagnostic,{phase:'evaluation',method:'Runtime.evaluate',reason:'invalid_result'});
  }else{
   assert.equal(result.safety.level,'takeover');
   assert.ok(result.safety.reason_codes.includes(mode==='private_input'?'secret_input':'site_permission'));
  }
  assert.equal(JSON.stringify(result).includes('never-export'),false);
 }));
}

for(const boundary of ['beginObservation','safety'])for(const privacy of [false,true]){
 test('real wait includes '+boundary+' frame replacement and preserves privacy='+privacy,()=>fixture('<button>Ready</button><iframe srcdoc="<p>Original</p>"></iframe>',async({tab,controller,session,call})=>{
  await tab.frameLocator('iframe').locator('p').waitFor();
  await call('computer.observe');
  const original=controller.page[boundary].bind(controller.page);let changed=false,inputs=0;
  const send=session.send.bind(session);session.send=(method,args)=>{if(method.startsWith('Input.'))inputs++;return send(method,args);};
  controller.page[boundary]=async(...args)=>{
   const result=await original(...args);
   if(!changed){changed=true;await tab.evaluate(privateInput=>{
    if(privateInput){const secret=document.createElement('input');secret.type='password';document.body.append(secret);secret.remove();}
    document.querySelector('iframe').srcdoc='<p>Replacement</p>';
   },privacy);await tab.frameLocator('iframe').locator('p').filter({hasText:'Replacement'}).waitFor();}
   return result;
  };
  const result=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready'},state:'visible',timeout_ms:1000});
  if(privacy){assert.equal(result.safety.level,'takeover',JSON.stringify(result));assert.equal(result.result.state,undefined);}
  else{assert.equal(result.result.state,'visible',JSON.stringify(result));assert.ok(result.result.samples>=2);}
  assert.equal(inputs,0);assert.equal(controller.page.listeners.size,0);
 }));
}
