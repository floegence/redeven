/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
async function fixture(run) {
  const browser=await chromium.launch({headless:true});const tab=await browser.newPage();let controller;
  try {
    await tab.setContent('<section aria-label="Scope"><button id="candidate">Ready</button></section>');
    const session=await tab.context().newCDPSession(tab);controller=new BrowserComputerController(session);await controller.initialize();
    const call=(tool_name,args={})=>controller.execute({tool_name,args,script_operation:true,full_access:true});
    const initial=await call('computer.observe');assert.ok(initial.result.observation);await run({tab,session,controller,call,initial});
  }finally{if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
}
for(const change of ['name','role','hidden','replacement']) {
  test('semantic wait resamples a changed candidate: '+change,async()=>fixture(async({tab,session,call})=>{
    const send=session.send.bind(session);let changed=false,inputs=0;
    session.send=async(method,params)=>{
      if(method.startsWith('Input.'))inputs++;
      const response=await send(method,params);
      if(method==='Accessibility.getFullAXTree'&&!changed){changed=true;await tab.evaluate(change=>{
        const element=document.querySelector('#candidate');
        if(change==='name')element.setAttribute('aria-label','Retired');
        if(change==='role')element.setAttribute('role','link');
        if(change==='hidden')element.hidden=true;
        if(change==='replacement')element.remove();
        const next=document.createElement('button');next.textContent='Ready';document.querySelector('section').append(next);
      },change);}
      return response;
    };
    const result=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true},state:'visible',timeout_ms:1500});
    assert.equal(result.result.state,'visible',JSON.stringify(result));assert.equal(inputs,0);
  }));
}
for(const kind of ['ref','root_ref','click','ambiguous','protocol']) {
  test('candidate resampling never relaxes '+kind,async()=>fixture(async({tab,session,call,initial})=>{
    const ref=initial.result.observation.nodes.find(n=>n.role==='button').ref;
    const root_ref=initial.result.observation.nodes.find(n=>n.role==='region').ref;
    const send=session.send.bind(session);let changed=false,inputs=0;
    session.send=async(method,params)=>{
      if(method.startsWith('Input.'))inputs++;
      const response=await send(method,params);
      if(!changed&&method===(kind==='ref'?'DOM.describeNode':'Accessibility.getFullAXTree')){
        changed=true;
        if(kind==='protocol')throw Object.assign(new Error('private error'),{protocolDiagnostic:{phase:'protocol',method,code:-32000}});
        await tab.evaluate(kind=>{
          document.querySelector('#candidate').setAttribute('aria-label','Retired');
          if(kind==='root_ref')document.querySelector('section').setAttribute('aria-label','Changed scope');
          for(let i=0;i<(kind==='ambiguous'?2:1);i++){const b=document.createElement('button');b.textContent='Ready';document.querySelector('section').append(b);}
        },kind);
      }
      return response;
    };
    const selector=kind==='ref'?{ref}:{role:'button',name:'Ready',exact:true,...(kind==='root_ref'?{root_ref}:{})};
    const result=await call('computer.action',{action:kind==='click'?'click':'wait',selector,...(kind==='click'?{}:{state:'visible',timeout_ms:1500})});
    assert.equal(result.error,kind==='protocol'?'TARGET_OBSERVATION_UNAVAILABLE':kind==='ambiguous'?'AMBIGUOUS_ELEMENT':'STALE_REFERENCE',JSON.stringify(result));assert.equal(inputs,0);
  }));
}
test('malformed safety input retains bounded method and reason without retry',async()=>fixture(async({session,call})=>{
  const send=session.send.bind(session);let attempts=0;
  session.send=async(method,params)=>{if(method==='DOMSnapshot.captureSnapshot'){attempts++;return {strings:[]};}return send(method,params);};
  const result=await call('computer.observe');assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
  assert.deepEqual(result.result.diagnostic,{phase:'adapter',method:'DOMSnapshot.captureSnapshot',reason:'invalid_result'});
  assert.equal(result.result.observation,undefined);assert.equal(attempts,1);
}));

for(const outcome of ['hidden','deadline','permission','privacy']) {
  test('invalid samples never fabricate '+outcome,async()=>fixture(async({tab,session,controller,call})=>{
    const send=session.send.bind(session);let samples=0,inputs=0;
    session.send=async(method,params)=>{
      if(method.startsWith('Input.'))inputs++;
      const result=await send(method,params);
      if(method==='Accessibility.getFullAXTree'&&(samples++===0||outcome==='deadline')){
        await tab.evaluate(()=>{document.querySelector('button').remove();const b=document.createElement('button');b.textContent='Ready';document.querySelector('section').append(b);});
        if(outcome==='permission')controller.page.requiredURL='https://ungranted.invalid/';
        if(outcome==='privacy')await tab.evaluate(()=>{const input=document.createElement('input');input.type='password';document.body.append(input);});
      }
      return result;
    };
    const start=Date.now();
    const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true},state:outcome==='hidden'?'hidden':'visible',timeout_ms:80});
    assert.equal(inputs,0);assert.ok(Date.now()-start<1500);
    if(outcome==='hidden')assert.equal(response.result.state,'timeout');
    if(outcome==='deadline'){assert.equal(response.result.observation_invalidated,true);assert.equal(response.result.state,undefined);}
    if(outcome==='permission')assert.equal(response.error,'TARGET_PERMISSION_REQUIRED');
    if(outcome==='privacy'){assert.equal(response.safety.level,'takeover');assert.equal(response.result.state,undefined);}
  }));
}

test('scoped query resampling cannot select a match outside the original root',async()=>fixture(async({tab,session,call,initial})=>{
  const root_ref=initial.result.observation.nodes.find(n=>n.role==='region').ref;
  const send=session.send.bind(session);let changed=false;
  session.send=async(method,params)=>{
    const result=await send(method,params);
    if(method==='Accessibility.getFullAXTree'&&!changed){changed=true;await tab.evaluate(()=>{document.querySelector('button').remove();const b=document.createElement('button');b.textContent='Ready';document.body.append(b);});}
    return result;
  };
  const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true,root_ref},timeout_ms:50});
  assert.equal(response.result.state,'timeout',JSON.stringify(response));
}));

test('unclassified adapter exceptions carry bounded stage without private details',async()=>fixture(async({controller,call})=>{
  controller.page.safety=async()=>{throw new TypeError('private page payload');};
  const response=await call('computer.observe');
  assert.deepEqual(response.result.diagnostic,{phase:'adapter',method:'safety_scan',reason:'internal_error'});
  assert.equal(JSON.stringify(response).includes('private page'),false);
}));

test('valid empty protocol attributes and optional geometry do not fail safety',async()=>fixture(async({tab,session,call})=>{
  await tab.evaluate(()=>document.querySelector('button').setAttribute('disabled',''));
  const send=session.send.bind(session);
  session.send=async(method,params)=>{
    const result=await send(method,params);
    if(method==='DOMSnapshot.captureSnapshot')for(const doc of result.documents){delete doc.scrollOffsetX;delete doc.scrollOffsetY;}
    return result;
  };
  const response=await call('computer.observe');assert.equal(response.error,undefined,JSON.stringify(response));
  assert.ok(response.result.observation.nodes.some(n=>n.name==='Ready'));
  assert.ok(response.result.observation.nodes.every(n=>n.bounds===undefined));
}));

test('replacement during state read cannot satisfy hidden from an obsolete candidate',async()=>fixture(async({tab,controller,call})=>{
  const read=controller.page.elementState.bind(controller.page);let changed=false;
  controller.page.elementState=async element=>{
    if(!changed){changed=true;await tab.evaluate(()=>{const old=document.querySelector('button');old.replaceWith(old.cloneNode(true));});}
    return read(element);
  };
  const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true},state:'hidden',timeout_ms:80});
  assert.equal(response.result.state,'timeout',JSON.stringify(response));
}));

test('missing descendant never hides a changed fixed root',async()=>fixture(async({tab,session,call,initial})=>{
  const root_ref=initial.result.observation.nodes.find(n=>n.role==='region').ref;
  const send=session.send.bind(session);let changed=false;
  session.send=async(method,params)=>{
    if(method==='Accessibility.getFullAXTree'&&!changed){changed=true;await tab.evaluate(()=>{document.querySelector('section').setAttribute('aria-label','Other scope');document.querySelector('button').remove();});}
    return send(method,params);
  };
  const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true,root_ref},state:'hidden',timeout_ms:80});
  assert.equal(response.error,'STALE_REFERENCE',JSON.stringify(response));
}));

for(const change of ['outside_scope','ambiguous']) {
  test('state reads retain original query membership: '+change,async()=>fixture(async({tab,controller,call,initial})=>{
    const root_ref=initial.result.observation.nodes.find(n=>n.role==='region').ref;
    const read=controller.page.elementState.bind(controller.page);let changed=false;
    controller.page.elementState=async element=>{
      if(!changed){changed=true;await tab.evaluate(change=>{
        const button=document.querySelector('button');
        if(change==='outside_scope')document.body.append(button);
        else button.after(button.cloneNode(true));
      },change);}
      return read(element);
    };
    const response=await call('computer.action',{action:'wait',selector:{role:'button',name:'Ready',exact:true,root_ref},state:'visible',timeout_ms:80});
    if(change==='outside_scope')assert.equal(response.result.state,'timeout',JSON.stringify(response));
    else assert.equal(response.error,'AMBIGUOUS_ELEMENT',JSON.stringify(response));
  }));
}
