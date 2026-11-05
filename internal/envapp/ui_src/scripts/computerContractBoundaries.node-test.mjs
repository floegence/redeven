/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserComputerController} from './computerBrowserController.mjs';
import {BrowserObservationInvalidated} from './computerBrowserPage.mjs';

const fixture=async(fn)=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const transport=await page.context().newCDPSession(page);const controller=new BrowserComputerController(transport);await controller.initialize();await fn({page,transport,controller});}finally{await browser.close();}};
const click=(options={})=>({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action:'click',selector:{role:'button',name:'Action',exact:true},...options}});

test('default pointer input neither scrolls nor samples a settling window',()=>fixture(async({page,controller})=>{
 await page.setContent('<style>button{margin-top:1300px}</style><button onclick="this.dataset.clicked=1">Action</button>');
 const rejected=await controller.execute(click());
 assert.equal(rejected.error,'ELEMENT_NOT_ACTIONABLE',JSON.stringify(rejected));
 assert.equal(await page.evaluate(()=>scrollY),0);
 assert.deepEqual(rejected.result.actionability.preparation,{scroll_into_view:false,stability_timeout_ms:0,elapsed_ms:rejected.result.actionability.preparation.elapsed_ms});
 const accepted=await controller.execute(click({scroll_into_view:true}));
 assert.equal(accepted.error,undefined,JSON.stringify(accepted));
 assert.ok(await page.evaluate(()=>scrollY)>0);
 assert.equal(await page.locator('button').getAttribute('data-clicked'),'1');
}));

test('a viewport mismatch is returned from one capture sample without automatic retry',async()=>{
 const controller=new BrowserComputerController({});let reads=0;
 await assert.rejects(controller.readObservation(async()=>{reads++;throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'),{observationReason:'viewport_unstable'});},'capture'),error=>error.observationReason==='viewport_unstable');
 assert.equal(reads,1);
});

test('inventory preflight invalidation identifies its safety dependency',async()=>{
 const controller=new BrowserComputerController({});
 await assert.rejects(controller.readObservation(async()=>{throw new BrowserObservationInvalidated('document_changed',{scope:'content',event:'document_inventory'});},'frame_inventory'),error=>error.invalidation.scope==='safety'&&error.observationStage==='frame_inventory');
});

test('table projection explicitly identifies source AX names without rewriting text',()=>fixture(async({page,controller})=>{
 await page.setContent('<table><tr><th aria-label="Source null">Source</th></tr><tr><td>42</td></tr></table>');
 const result=await controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action:'table',selector:{role:'table'}}});
 assert.equal(result.error,undefined,JSON.stringify(result));
 assert.equal(result.result.source,'browser_ax');assert.equal(result.result.property,'name');
 assert.equal(result.result.rows[0].cells[0].text,'Source null');
}));
