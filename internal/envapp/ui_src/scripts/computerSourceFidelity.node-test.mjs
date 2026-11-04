/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

async function fixture(html, run) {
  const browser=await chromium.launch({headless:true});let controller;
  try {
    const tab=await browser.newPage();await tab.setContent(html);
    const session=await tab.context().newCDPSession(tab);
    controller=new BrowserComputerController(session);await controller.initialize();
    const call=(tool_name,args={})=>controller.execute({tool_name,args,full_access:true,script_operation:true});
    const initial=await call('computer.observe',{limit:1000});
    const source=(ref,field,kind='ax')=>call('computer.action',{action:'source',selector:{ref},source:kind,field});
    const domTarget=async()=>{
      const pending=[initial.result.observation.nodes[0].ref];
      while(pending.length){const ref=pending.shift();const id=await source(ref,'attribute:id','dom');if(id.result?.value==='target')return ref;const children=await source(ref,'child_refs','dom');assert.equal(children.error,undefined,JSON.stringify(children));pending.push(...children.result.items);}
      assert.fail('DOM source target missing');
    };
    await run({tab,session,controller,call,source,initial,domTarget});
  } finally {if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
}

for(const style of ['display:contents','visibility:hidden'])test('text preserves browser innerText: '+style,async()=>fixture(
  '<div id="target" style="'+style+'"><span style="visibility:visible">Unchanged source text</span></div>',
  async({tab,call,source,domTarget})=>{
    const ref=await domTarget();const direct=await tab.locator('#target').evaluate(e=>e.innerText);
    const raw=await source(ref,'innerText','dom');const text=await call('computer.action',{action:'text',selector:{ref}});
    assert.notEqual(direct,'');assert.equal(raw.result.value,direct);assert.equal(text.result.text,direct);
    assert.equal(text.result.source,'browser_dom');assert.equal(text.result.property,'innerText');
  }));

for(const style of ['opacity:0','visibility:visible'])test('scroll uses actual hit facts: '+style,async()=>fixture(
  '<div style="visibility:hidden"><div id="target" style="'+style+';width:300px;height:120px;overflow:auto;'+(style==='opacity:0'?'visibility:visible':'')+'"><div style="height:2000px">Scrollable</div></div></div>',
  async({tab,call,domTarget})=>{
    const ref=await domTarget();const result=await call('computer.action',{action:'scroll',selector:{ref},delta_y:160});
    assert.equal(result.error,undefined,JSON.stringify(result));
    await tab.waitForFunction(()=>document.querySelector('#target').scrollTop>0);
    assert.ok(await tab.locator('#target').evaluate(e=>e.scrollTop)>0);
  }));

test('AX source traverses ignored and backendless records without action authority',async()=>fixture(
  '<main><span>Original text</span><button>Go</button></main>',
  async({tab,call,source,initial})=>{
    let lastRef;
    for(const parent of [initial.result.observation.nodes[0],initial.result.observation.nodes.find(n=>n.role==='StaticText')]){
      const childIDs=await source(parent.ref,'childIds');const children=await source(parent.ref,'child_refs');
      assert.equal(children.error,undefined,JSON.stringify(children));
      assert.equal(children.result.total,JSON.parse(childIDs.result.value).length);assert.ok(children.result.total>0);
      for(const ref of children.result.items){
        lastRef=ref;
        const read=await source(ref,'ignored');assert.equal(read.error,undefined,JSON.stringify(read));assert.equal(read.result.available,true);
        const click=await call('computer.action',{action:'click',selector:{ref}});assert.equal(click.error,'TARGET_CAPABILITY_UNAVAILABLE');
      }
    }
    await tab.setContent('<main>New document</main>');
    const stale=await source(lastRef,'ignored');assert.equal(stale.error,'STALE_REFERENCE');
  }));

test('explicit pointer point is the checked and dispatched point with no alternative search',async()=>fixture(
  '<div style="width:100px;height:80px;overflow:hidden"><button style="width:400px;height:60px" onclick="this.dataset.clicked=event.clientX">Wide</button></div>',
  async({tab,call})=>{
    const selector={role:'button',name:'Wide',exact:true};
    const geometry=await call('computer.action',{action:'geometry',selector,point:{x:30,y:30}});
    assert.equal(geometry.error,undefined,JSON.stringify(geometry));assert.equal(geometry.result.hit_target,true);
    const blocked=await call('computer.action',{action:'click',selector,scroll_into_view:false,stability_timeout_ms:0});
    assert.equal(blocked.error,'ELEMENT_NOT_ACTIONABLE');assert.ok(blocked.result.actionability.tested_point.x>100);
    assert.equal(await tab.locator('button').getAttribute('data-clicked'),null);
    const click=await call('computer.action',{action:'click',selector,point:{x:30,y:30},scroll_into_view:false,stability_timeout_ms:0});
    assert.equal(click.error,undefined,JSON.stringify(click));assert.deepEqual(click.result.point,{x:30,y:30});
    assert.equal(click.result.preparation.scroll_into_view,false);assert.equal(await tab.locator('button').getAttribute('data-clicked'),'30');
  }));
