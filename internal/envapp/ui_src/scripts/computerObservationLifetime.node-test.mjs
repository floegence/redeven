/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

const safe = {level:'routine',safe_to_capture:true,safe_to_send_to_model:true};
function fixture() {
  const controller = new BrowserComputerController({send:async()=>({frameTree:{frame:{url:'https://fixture.test'}}})});
  const page=controller.page;
  Object.assign(page,{beginObservation:async()=>{},safety:async()=>safe,inFrame:async()=>'Original',
    observe:async()=>({document_id:'original:0',nodes:[],truncated:false}),releaseInput:async()=>{}});
  return {controller,page,run:()=>controller.execute({tool_name:'computer.observe',script_operation:true,full_access:true})};
}

for(const boundary of ['after_read','before_metadata','after_metadata']) {
  test('one observation rejects document replacement '+boundary,async()=>{
    const {controller,page,run}=fixture();
    const read=controller.readObservation.bind(controller);
    let observed=false;
    const observe=page.observe;
    page.observe=async()=>{const result=await observe();observed=true;return result;};
    controller.readObservation=async(operation,stage)=>{
      if(stage==='safety_scan'&&observed&&boundary==='after_read')page.invalidate();
      if(stage==='metadata'&&boundary==='before_metadata')page.invalidate();
      const result=await read(operation,stage);
      if(stage==='metadata'&&boundary==='after_metadata')page.invalidate();
      return result;
    };
    const result=await run();
    assert.equal(result.result.observation_invalidated,true,JSON.stringify(result));
    assert.equal(result.result.observation,undefined);
    assert.equal(result.safety.safe_to_send_to_model,false);
  });
}

test('real browser wait samples across child replacement without losing parent identity',async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  let controller;
  try {
    await page.setContent('<title>Original</title><h1>Original content</h1><button disabled>Ready</button><iframe srcdoc="<p>Child one</p>"></iframe>');
    await page.frameLocator('iframe').locator('p').waitFor();
    const transport=await page.context().newCDPSession(page);
    controller=new BrowserComputerController(transport);
    await controller.initialize();
    const seed=await controller.execute({tool_name:'computer.observe',full_access:true,script_operation:true});
    assert.equal(seed.error,undefined);
    const button=seed.result.observation.nodes.find(n=>n.role==='button');
    const readState=controller.page.elementState.bind(controller.page);
    let changed=false,inputs=0;
    const send=transport.send.bind(transport);
    transport.send=async(method,args)=>{if(method.startsWith('Input.'))inputs++;return send(method,args);};
    controller.page.elementState=async element=>{
      const state=await readState(element);
      if(!changed){
        changed=true;
        await page.evaluate(()=>{document.querySelector('iframe').srcdoc='<p>Child two</p>';});
        await page.frameLocator('iframe').locator('p').filter({hasText:'Child two'}).waitFor();
        await page.evaluate(()=>{document.querySelector('button').disabled=false;});
      }
      return state;
    };
    const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,
      args:{action:'wait',selector:{ref:button.ref},state:'enabled',timeout_ms:2000}});
    assert.equal(result.result.state,'enabled',JSON.stringify(result));
    assert.equal(result.safety.safe_to_send_to_model,true);
    assert.equal(inputs,0);
  } finally {if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
});

for (const outcome of ['unknown','stale','ambiguous','cancel','connection','permission','privacy']) {
  test('condition sample preserves '+outcome+' without retry or later input',async()=>{
    const {controller,page}=fixture();
    let samples=0;
    page.conditionState=async()=>{
      samples++;
      page.invalidate();
      if(outcome==='unknown')throw new Error('OBSERVATION_INVALIDATED'); // Text alone is not lifecycle authority.
      if(outcome==='stale')throw new Error('STALE_REFERENCE');
      if(outcome==='ambiguous')throw new Error('AMBIGUOUS_ELEMENT');
      if(outcome==='cancel')page.operationCancelled=true;
      if(outcome==='connection')page.invalid=true;
      if(outcome==='permission')page.requiredURL='https://new.test/';
      if(outcome==='privacy')page.stopped=true;
      return {state:'enabled'};
    };
    const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'wait',selector:{role:'button'},state:'enabled',timeout_ms:1000}});
    assert.equal(samples,1,JSON.stringify(result));
    assert.equal(result.result?.state,undefined);
    assert.equal(result.result?.action_executed,false);
    if(outcome==='unknown'||outcome==='cancel')assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
    if(outcome==='stale')assert.equal(result.error,'STALE_REFERENCE');
    if(outcome==='ambiguous')assert.equal(result.error,'AMBIGUOUS_ELEMENT');
    if(outcome==='permission')assert.equal(result.error,'TARGET_PERMISSION_REQUIRED');
    if(outcome==='privacy')assert.equal(result.safety.level,'takeover');
    assert.equal(page.listeners.size,0);
  });
}

test('ordinary content updates do not invalidate a same-document read',async()=>{
  const {controller,page,run}=fixture();
  const observe=page.observe;
  page.observe=async()=>{page.changed();return observe();};
  assert.equal((await run()).result.observation.document_id,'original:0');
  assert.equal(page.revision,0);
  controller.close();
});

test('confirmed input is never replayed when its resulting observation changes',async()=>{
  const {controller,page}=fixture();
  let actions=0;
  page.action=async()=>{actions++;page.effectCount++;return {confirmed:true};};
  page.inFrame=async()=>{page.invalidate();return 'Replacement';};
  const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'click',selector:{role:'button'}}});
  assert.equal(actions,1);
  assert.equal(result.result.action_executed,true);
  assert.equal(result.result.observation_invalidated,true);
});

test('wait timeout is a verified sample and does not reset its deadline',async()=>{
  const {controller,page}=fixture();
  let samples=0;
  page.conditionState=async()=>{samples++;return {state:'timeout',requested_state:'visible',last_known:{found:false,enabled:false}};};
  const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'wait',selector:{role:'button'},timeout_ms:0}});
  assert.equal(samples,1);
  assert.equal(result.result.state,'timeout');
  assert.equal(result.safety.safe_to_send_to_model,true);
});

for(const mode of ['snapshot','screenshot','semantic_wait','ref_wait']) {
  test('real document replacement respects '+mode+' lifetime',async()=>{
    const browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    let controller;
    try {
      await page.setContent('<title>Original</title><h1>Original content</h1><button disabled>Ready</button>');
      const transport=await page.context().newCDPSession(page);
      controller=new BrowserComputerController(transport);
      await controller.initialize();
      const seed=await controller.execute({tool_name:'computer.observe',full_access:true,script_operation:true});
      const original=seed.result.observation.document_id;
      const ref=seed.result.observation.nodes.find(n=>n.role==='button').ref;
      const replace=async()=>{
        const changed=new Promise(resolve=>{const listener=()=>{controller.page.listeners.delete(listener);resolve();};controller.page.listeners.add(listener);});
        await page.setContent('<title>Replacement</title><h1>Replacement content</h1><button>Ready</button>');
        await changed;
      };
      let response;
      if(mode.endsWith('wait')){
        const state=controller.page.elementState.bind(controller.page);
        let replaced=false;
        controller.page.elementState=async element=>{
          const value=await state(element);
          if(!replaced){replaced=true;await replace();}
          return value;
        };
        response=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'wait',selector:mode==='ref_wait'?{ref}:{role:'button',name:'Ready'},state:'enabled',timeout_ms:2000}});
        if(mode==='ref_wait')assert.equal(response.error,'STALE_REFERENCE',JSON.stringify(response));
        else {assert.equal(response.result.state,'enabled',JSON.stringify(response));assert.equal(response.result.title,'Replacement');}
      }else{
        const read=controller.readObservation.bind(controller);
        let replaced=false;
        controller.readObservation=async(operation,stage)=>{
          if(stage==='metadata'&&!replaced){replaced=true;await replace();}
          return read(operation,stage);
        };
        response=await controller.execute({tool_name:mode==='snapshot'?'computer.observe':'computer.screenshot',target_id:'test',full_access:true,script_operation:true});
        assert.equal(response.result.observation_invalidated,true,JSON.stringify(response));
        assert.equal(response.result.observation,undefined);
        assert.equal(response.screenshot,undefined);
        assert.equal(controller.frameAnchor,undefined);
      }
      assert.notEqual(original,controller.page.prefix+':'+controller.page.revision);
    }finally{if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
  });
}

test('deadline stays bounded when every sample is explicitly invalidated',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const {controller,page}=fixture();
  let samples=0;
  page.conditionState=async()=>{samples++;page.invalidate();return {state:'enabled'};};
  const pending=controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'wait',selector:{role:'button'},state:'enabled',timeout_ms:20}});
  for(let turn=0;turn<30;turn++)await Promise.resolve();
  const beforeDeadline=samples;
  t.mock.timers.tick(25);
  const response=await pending;
  assert.equal(response.result.observation_invalidated,true);
  assert.ok(beforeDeadline>=1);
  assert.ok(samples<=beforeDeadline+1);
  assert.equal(page.listeners.size,0);
});

test('wait samples retain transient private-input evidence',async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  let controller;
  try {
    await page.setContent('<button disabled>Ready</button>');
    controller=new BrowserComputerController(await page.context().newCDPSession(page));
    await controller.initialize();
    const state=controller.page.elementState.bind(controller.page);
    let samples=0;
    controller.page.elementState=async element=>{
      samples++;
      const current=await state(element);
      await page.evaluate(()=>{const secret=document.createElement('input');secret.type='password';document.body.append(secret);secret.remove();document.querySelector('button').disabled=false;});
      return current;
    };
    const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'wait',selector:{role:'button',name:'Ready'},state:'enabled',timeout_ms:1000}});
    assert.equal(result.safety.level,'takeover',JSON.stringify(result));
    assert.ok(result.safety.reason_codes.includes('secret_input'));
    assert.equal(samples,1);
    assert.equal(result.result.state,undefined);
  }finally{if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
});

test('cancellation after metadata prevents publication',async()=>{
  const {page,run}=fixture();
  page.inFrame=async()=>{page.operationCancelled=true;return 'Late title';};
  const result=await run();
  assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
  assert.equal(result.result.observation,undefined);
});

for (const boundary of ['replacement','cancel','privacy','permission','connection','release_failure']) {
  test('final publication respects '+boundary+' during input cleanup',async()=>{
    const {controller,page}=fixture();
    let actions=0;
    page.action=async()=>{actions++;page.effectCount++;return {confirmed:true};};
    page.releasePage=async()=>{};
    page.releaseInput=async()=>{
      if(boundary==='replacement')page.invalidate();
      if(boundary==='cancel')page.operationCancelled=true;
      if(boundary==='privacy')page.safety=async()=>({level:'takeover',reason_codes:['secret_input'],safe_to_capture:false,safe_to_send_to_model:false});
      if(boundary==='permission')page.requiredURL='https://other.test/';
      if(boundary==='connection')page.guardFailure=true;
      if(boundary==='release_failure'){page.invalidate();throw new Error('private cleanup failure');}
    };
    const result=await controller.execute({tool_name:'computer.action',full_access:true,script_operation:true,args:{action:'click',selector:{role:'button'}}});
    assert.equal(actions,1);
    assert.equal(result.result?.confirmed,undefined,JSON.stringify(result));
    assert.equal(result.result?.title,undefined);
    if(boundary==='replacement')assert.equal(result.result.observation_invalidated,true);
    if(boundary==='cancel')assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
    if(boundary==='privacy')assert.equal(result.safety.level,'takeover');
    if(boundary==='permission')assert.equal(result.error,'TARGET_PERMISSION_REQUIRED');
    if(boundary==='connection')assert.equal(result.error,'TARGET_CONNECTION_REQUIRED');
    if(boundary==='release_failure')assert.equal(result.error,'EFFECT_OUTCOME_UNKNOWN');
    else assert.equal(result.result.action_executed,true);
    assert.equal(controller.frameAnchor,undefined);
  });
}
