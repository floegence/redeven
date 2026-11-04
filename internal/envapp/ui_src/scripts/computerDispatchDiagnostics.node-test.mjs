/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserComputerController} from './computerBrowserController.mjs';

test('moving geometry reports the rejected stability predicate and supports explicit no-wait',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<button>Moving</button>');
    await page.evaluate(()=>{globalThis.clicks=0;document.querySelector('button').onclick=()=>globalThis.clicks++;});
    const controller=new BrowserComputerController(await page.context().newCDPSession(page));await controller.page.initialize();
    // Guarantee distinct live layouts instead of depending on animation frames
    // advancing under concurrent headless test load. Hit testing stays real.
    let position=0;const geometry=controller.page.geometry.bind(controller.page);
    controller.page.geometry=async(...args)=>{await page.locator('button').evaluate((element,x)=>{element.style.transform='translateX('+x+'px)';},++position);return geometry(...args);};
    const run=options=>controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action:'click',selector:{role:'button',name:'Moving'},...options}});
    const rejected=await run({stability_timeout_ms:120,scroll_into_view:false});
    assert.equal(rejected.error,'ELEMENT_NOT_ACTIONABLE',JSON.stringify(rejected));
    assert.equal(rejected.result.actionability.layout_stable,false);
    assert.deepEqual(rejected.result.actionability.failed_checks,['layout_stable']);
    assert.equal(rejected.result.actionability.previous_quads[0].length,8);
    assert.equal(rejected.result.actionability.current_quads[0].length,8);
    assert.ok(rejected.result.actionability.sample_interval_ms>=0);
    assert.equal(await page.evaluate(()=>globalThis.clicks),0);
    const accepted=await run({stability_timeout_ms:0,scroll_into_view:false});
    assert.equal(accepted.error,undefined,JSON.stringify(accepted));
    assert.equal(await page.evaluate(()=>globalThis.clicks),1);
  }finally{await browser.close();}
});

for(const operation of ['navigate','click','key']){
  test(operation+' preflight invalidation cannot dispatch or change the page',async()=>{
    const {BrowserObservationInvalidated}=await import('./computerBrowserPage.mjs');
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage();await page.setContent('<button>Action</button>');
      const transport=await page.context().newCDPSession(page);
      const controller=new BrowserComputerController(transport);await controller.page.initialize();
      const originalURL=page.url();let commands=0;
      const send=transport.send.bind(transport);
      transport.send=async(method,params)=>{if(method==='Page.navigate'||method.startsWith('Input.'))commands++;return send(method,params);};
      controller.page.safety=async()=>{throw new BrowserObservationInvalidated('document_changed',{scope:'safety',event:'document_inventory'});};
      const request={target_id:'fixture',script_operation:true,full_access:true,...(operation==='navigate'?{tool_name:'browser.navigate',args:{url:'https://fixture.test'}}:{tool_name:'computer.action',args:operation==='click'?{action:'click',selector:{role:'button',name:'Action'}}:{action:'key',key:'Enter'}})};
      const result=await controller.execute(request);
      assert.equal(result.result.observation_invalidated,true,JSON.stringify(result));
      assert.equal(result.result.action_executed,false);
      assert.equal(commands,0);assert.equal(page.url(),originalURL);
    }finally{await browser.close();}
  });
}
