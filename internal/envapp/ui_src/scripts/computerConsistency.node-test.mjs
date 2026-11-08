/* global document, history */
import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {BrowserComputerController} from './computerBrowserController.mjs';
async function fixture(run){
 const browser=await chromium.launch({headless:true});let controller;
 try{
  const tab=await browser.newPage();await tab.route('https://sample.test/**',route=>route.fulfill({contentType:'text/html',body:'<title>Resource A</title><main>Resource A facts</main><button>Ready</button><iframe srcdoc="<p>Child</p>"></iframe>'}));await tab.goto('https://sample.test/a');
  const session=await tab.context().newCDPSession(tab);controller=new BrowserComputerController(session);await controller.initialize();
  const call=(tool_name,args={})=>controller.execute({tool_name,args,full_access:true,script_operation:true});
  const initial=await call('computer_observe');assert.ok(initial.result.observation,JSON.stringify(initial));await run({tab,session,controller,call,initial});
 }finally{if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
}
test('text owns contemporaneous source metadata across a same-document route change',async()=>fixture(async({tab,controller,call})=>{
 const read=controller.page.text.bind(controller.page);controller.page.text=async element=>{const result=await read(element);await tab.evaluate(()=>{history.pushState({},'','/b');document.title='Resource B';document.querySelector('main').textContent='Resource B facts';});return result;};
 const response=await call('computer.action',{action:'text',selector:{role:'main'}});
 assert.equal(response.error,undefined);assert.equal(response.result.text,'Resource A facts');assert.equal(response.result.url,'https://sample.test/a');assert.equal(response.result.title,'Resource A');assert.ok(response.result.frame_id);assert.ok(response.result.document_id);assert.ok(response.result.ref);
}));
test('explicit wait includes final publication in its original deadline',async()=>fixture(async({tab,controller,call})=>{
 let checks=0,sampled=false;const condition=controller.page.conditionState.bind(controller.page);controller.page.conditionState=async(...args)=>{const result=await condition(...args);sampled=true;return result;};
 const safety=controller.page.safety.bind(controller.page);controller.page.safety=async(...args)=>{if(sampled&&++checks===1)await tab.evaluate(()=>document.querySelector('iframe').remove());return safety(...args);};
 const result=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready'},state:'visible',timeout_ms:1500});
 assert.equal(result.result.state,'visible',JSON.stringify(result));assert.ok(result.result.samples>=2);assert.ok(result.result.elapsed_ms<1500);
}));
test('detached scan frame reports scoped lifecycle facts and protocol method',async()=>fixture(async({tab,session,call})=>{
 const {frameTree}=await session.send('Page.getFrameTree');const child=frameTree.childFrames[0].frame.id;const send=session.send.bind(session);let context,removed=false;
 session.send=async(method,params)=>{if(method==='Runtime.evaluate'&&params.expression.includes('__flowerPrivacyObserver.secretChanged()')&&params.contextId===context&&!removed){removed=true;await tab.evaluate(()=>document.querySelector('iframe').remove());}const result=await send(method,params);if(method==='Page.createIsolatedWorld'&&params.frameId===child)context=result.executionContextId;return result;};
 const response=await call('computer_observe');assert.equal(response.result.observation_invalidated,true,JSON.stringify(response));assert.equal(response.result.invalidation.frame_id,child);assert.equal(response.result.invalidation.scope,'safety');assert.equal(response.result.invalidation.event,'Page.frameDetached');assert.equal(response.result.diagnostic.method,'Runtime.evaluate');
}));
test('unrelated frame churn cannot reclassify an unknown protocol failure',async()=>fixture(async({tab,session,call})=>{
 const send=session.send.bind(session);let changed=false;
 session.send=async(method,params)=>{if(method==='Runtime.evaluate'&&params.expression.includes('__flowerPrivacyObserver.secretChanged()')&&!changed){changed=true;await tab.evaluate(()=>document.querySelector('iframe').remove());throw Object.assign(new Error('unknown'),{protocolDiagnostic:{phase:'protocol',method}});}return send(method,params);};
 const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready'},timeout_ms:1500});assert.equal(response.error,'TARGET_OBSERVATION_UNAVAILABLE',JSON.stringify(response));
}));

test('a frame detached before its safety read retains the enumerated document identity',async()=>fixture(async({tab,session,controller,call})=>{
 const read=controller.page.inFrame.bind(controller.page);let removed=false,dispatched=false;
 const send=session.send.bind(session);
 session.send=async(method,params)=>{if(removed&&method==='Page.createIsolatedWorld'&&params.frameId===removed)dispatched=true;return send(method,params);};
 controller.page.inFrame=async(frame,...args)=>{
  if(frame.frame.parentId&&!removed&&args[0].includes('__flowerPrivacyObserver.secretChanged()')){
   removed=frame.frame.id;
   const detached=new Promise(resolve=>session.once('Page.frameDetached',resolve));
   await tab.evaluate(()=>document.querySelector('iframe').remove());await detached;
  }
  return read(frame,...args);
 };
 const response=await call('computer_observe');
 assert.equal(response.result.reason,'document_changed',JSON.stringify(response));
 assert.equal(response.result.invalidation.frame_id,removed);
 assert.equal(response.result.invalidation.event,'Page.frameDetached');
 assert.equal(response.result.invalidation.scope,'safety');assert.equal(dispatched,false);
 assert.equal((await call('computer_observe')).error,undefined);
}));

test('a lifecycle change during frame enumeration cannot install stale documents',async()=>fixture(async({tab,session,controller,call})=>{
 const send=session.send.bind(session);let removed=false;
 session.send=async(method,params)=>{
  const result=await send(method,params);
  if(method==='Page.getFrameTree'&&!removed){removed=true;const detached=new Promise(resolve=>session.once('Page.frameDetached',resolve));await tab.evaluate(()=>document.querySelector('iframe').remove());await detached;}
  return result;
 };
 const response=await call('computer_observe');
 assert.equal(response.result.reason,'document_changed',JSON.stringify(response));
 assert.equal(response.result.invalidation.event,'document_inventory');
 assert.equal(response.result.observation,undefined);
 assert.equal((await call('computer_observe')).error,undefined);
 assert.equal([...controller.page.observedFrames.values()].some(record=>record.frame.parentId),false);
}));

test('scoped text distinguishes page-wide safety loss from preserved content identity',async()=>fixture(async({tab,controller,call,initial})=>{
 const ref=initial.result.observation.nodes.find(n=>n.role==='main').ref;
 const entry=controller.page.references.get(ref);
 const read=controller.page.text.bind(controller.page);controller.page.text=async element=>{const value=await read(element);await tab.evaluate(()=>document.querySelector('iframe').remove());return value;};
 const result=await call('computer.action',{action:'text',selector:{ref}});
 assert.equal(result.result.observation_invalidated,true,JSON.stringify(result));assert.equal(result.result.invalidation.scope,'safety');assert.equal(result.result.text,undefined);
 assert.equal(controller.page.observedFrames.get(entry.frame.frame.id),entry.document);
 controller.page.text=read;
 const next=await call('computer.action',{action:'text',selector:{ref}});assert.equal(next.result.text,'Resource A facts',JSON.stringify(next));assert.equal(next.safety.safe_to_send_to_model,true);
}));

test('AX content cannot acquire metadata from a later route',async()=>fixture(async({tab,controller,call})=>{
 const read=controller.page.observe.bind(controller.page);controller.page.observe=async(...args)=>{const result=await read(...args);await tab.evaluate(()=>{history.pushState({},'','/b');document.title='Resource B';});return result;};
 const response=await call('computer_observe');assert.equal(response.result.observation_invalidated,true,JSON.stringify(response));assert.equal(response.result.observation,undefined);assert.equal(response.result.invalidation.event,'Page.navigatedWithinDocument');
}));
