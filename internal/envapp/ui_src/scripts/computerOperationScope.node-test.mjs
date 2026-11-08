/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserComputerController} from './computerBrowserController.mjs';
const fixture=async(fn)=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const transport=await page.context().newCDPSession(page);const controller=new BrowserComputerController(transport);await controller.initialize();await fn({page,transport,controller});}finally{await browser.close();}};
const action=(action,args={})=>({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action,...args}});

test('navigation receipts depend on control and destination rather than the old document inventory',()=>fixture(async({page,transport,controller})=>{
 await page.setContent('<main>Old document</main><iframe srcdoc="<p>changing child</p>"></iframe>');
 let inventories=0,navigations=0;const send=transport.send.bind(transport);
 transport.send=async(method,args)=>{if(method==='Page.navigate')navigations++;if(method==='Page.getFrameTree'||method==='DOMSnapshot.captureSnapshot'){inventories++;throw new Error('old document unavailable');}return send(method,args);};
 const result=await controller.execute({target_id:'fixture',tool_name:'browser_navigate',script_operation:true,full_access:true,args:{url:'about:blank',wait_until:'commit'}});
 assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.command_acknowledged,true);assert.equal(navigations,1);assert.equal(inventories,0);
}));

test('recently read refs survive bounded collection churn and missing refs are not claimed to have changed',()=>fixture(async({page,controller})=>{
 await page.setContent('<button>Persistent</button>'+[0,1,2].map(i=>'<section role="group" aria-label="Group '+i+'">'+Array.from({length:750},(_,n)=>'<button>Item '+i+' '+n+'</button>').join('')+'</section>').join(''));
 const target=await controller.page.resolve({role:'button',name:'Persistent',exact:true});
 for(const i of [0,1,2]){const group=await controller.page.resolve({role:'group',name:'Group '+i,exact:true});await controller.page.observe({root_ref:group.ref,limit:1000});await controller.page.resolve({ref:target.ref});}
 assert.ok(controller.page.references.size<=2000);
 const unknown=await controller.execute(action('read',{selector:{ref:'unretained'}}));
 assert.equal(unknown.error,'TARGET_OBSERVATION_UNAVAILABLE',JSON.stringify(unknown));assert.equal(unknown.result.reason,'reference_not_retained');assert.equal(unknown.result.action_executed,false);
}));

test('pure delay survives child replacement without input delivery',()=>fixture(async({page,controller})=>{
 await page.setContent('<main>Stable</main><iframe srcdoc="<p>one</p>"></iframe>');await controller.page.frames();
 const delay=controller.page.delay.bind(controller.page);let injected=false;
 controller.page.delay=async(ms,revision)=>{if(!injected){injected=true;await page.locator('iframe').evaluate(el=>el.srcdoc='<p>two</p>');await new Promise(r=>setTimeout(r,30));}return delay(ms,revision);};
 const result=await controller.execute(action('input_sequence',{events:[{type:'wait',duration_ms:100}]}));
 assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(controller.page.inputPosted,0);assert.equal(result.result.completed_events,1);
}));

test('text click validates its exact source text at the fixed point and rejects overlays',()=>fixture(async({page,controller})=>{
 await page.setContent('<button><span>Exact text</span></button>');await page.evaluate(()=>{globalThis.clicks=0;document.querySelector('button').onclick=()=>globalThis.clicks++;});
 const text=await controller.page.resolve({role:'StaticText',name:'Exact text',exact:true});
 const result=await controller.execute(action('click',{selector:{ref:text.ref},stability_timeout_ms:0,scroll_into_view:false}));
 assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(await page.evaluate(()=>globalThis.clicks),1);
 await page.evaluate(()=>{const cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:99';cover.textContent='Overlay';document.body.append(cover);});
 const blocked=await controller.execute(action('click',{selector:{ref:text.ref},stability_timeout_ms:0,scroll_into_view:false}));
 assert.equal(blocked.error,'ELEMENT_NOT_ACTIONABLE',JSON.stringify(blocked));assert.equal(await page.evaluate(()=>globalThis.clicks),1);
}));

for(const boundary of ['permission','user_control','cancel','connection'])test('receipt navigation keeps the '+boundary+' barrier',()=>fixture(async({page,transport,controller})=>{
 await page.setContent('<main>Unchanged</main>');let dispatched=0;const send=transport.send.bind(transport);
 transport.send=async(method,args)=>{if(method==='Page.navigate')dispatched++;return send(method,args);};
 if(boundary==='user_control')controller.page.stopped=true;
 if(boundary==='cancel')controller.page.operationCancelled=true;
 if(boundary==='connection')controller.page.invalid=true;
 const result=await controller.execute({target_id:'fixture',tool_name:'browser_navigate',script_operation:true,full_access:boundary!=='permission',args:{url:'https://unauthorized.test',wait_until:'commit'}});
 assert.equal(dispatched,0);assert.equal(result.result?.action_executed===true,false);assert.ok(result.error||result.safety?.level==='takeover',JSON.stringify(result));
}));

test('ordinary reads and input still stop at secret fields; a navigation receipt reveals no content',()=>fixture(async({page,controller})=>{
 await page.setContent('<input type="password" value="never published"><button>Action</button>');
 const read=await controller.execute({target_id:'fixture',tool_name:'computer_observe',script_operation:true,full_access:true,args:{}});
 assert.equal(read.safety.level,'takeover');assert.equal(read.result.observation,undefined);
 const click=await controller.execute(action('click',{selector:{role:'button',name:'Action'}}));
 assert.equal(click.safety.level,'takeover');assert.equal(click.result.action_executed,false);
 const nav=await controller.execute({target_id:'fixture',tool_name:'browser_navigate',script_operation:true,full_access:true,args:{url:'about:blank',wait_until:'commit'}});
 assert.equal(nav.result.command_acknowledged,true);assert.equal(nav.result.observation,undefined);assert.equal(nav.safety.safe_to_send_to_model,false);
 assert.equal(JSON.stringify([read,click,nav]).includes('never published'),false);
}));

test('input sequence stops after document replacement and releases held keys',()=>fixture(async({page,transport,controller})=>{
 await page.setContent('<textarea></textarea>');await page.locator('textarea').focus();
 const send=transport.send.bind(transport),inputs=[];let replaced=false;
 transport.send=async(method,args)=>{const result=await send(method,args);if(method==='Input.dispatchKeyEvent'){inputs.push(args.type+':'+args.key);if(!replaced&&args.type==='keyDown'){replaced=true;await page.setContent('<textarea></textarea>');await new Promise(r=>setTimeout(r,30));}}return result;};
 const result=await controller.execute(action('input_sequence',{events:[{type:'keyDown',key:'a'},{type:'wait',duration_ms:100},{type:'keyUp',key:'a'},{type:'keyDown',key:'b'},{type:'keyUp',key:'b'}]}));
 assert.equal(result.error,'STALE_REFERENCE',JSON.stringify(result));assert.ok(inputs.includes('keyUp:a'));assert.equal(inputs.some(x=>x.endsWith(':b')),false);assert.equal(controller.page.heldInput.size,0);
}));

for(const shadow of [false,true])test('text hit remains exact inside '+(shadow?'shadow root':'scrolled iframe'),()=>fixture(async({page,controller})=>{
 if(shadow){await page.setContent('<div id="host"></div>');await page.locator('#host').evaluate(e=>{e.attachShadow({mode:'open'}).innerHTML='<button><span>Exact text</span></button>';e.shadowRoot.querySelector('button').onclick=()=>globalThis.textClicks=(globalThis.textClicks||0)+1;});}
 else {await page.setContent('<iframe srcdoc="<style>body{height:2000px}button{margin-top:900px}</style><button><span>Exact text</span></button>"></iframe>');await page.frames()[1].waitForLoadState();await page.frames()[1].locator('button').scrollIntoViewIfNeeded();await page.frames()[1].evaluate(()=>document.querySelector('button').onclick=()=>globalThis.textClicks=(globalThis.textClicks||0)+1);}
 const result=await controller.execute(action('click',{selector:{role:'StaticText',name:'Exact text',exact:true},stability_timeout_ms:0}));
 assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(await (shadow?page:page.frames()[1]).evaluate(()=>globalThis.textClicks),1);
}));
