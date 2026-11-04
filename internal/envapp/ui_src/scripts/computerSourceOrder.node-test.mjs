/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserComputerController} from './computerBrowserController.mjs';
const fixture=async fn=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const transport=await page.context().newCDPSession(page);const controller=new BrowserComputerController(transport);await controller.initialize();await fn({page,transport,controller});}finally{await browser.close();}};
const request=(action,args={})=>({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action,...args}});
test('query pages follow source child order through nested and ignored branches',()=>fixture(async({page,controller})=>{
 await page.setContent('<main><div><div><a href="#one">First</a></div></div><a href="#two">Second</a></main><footer><a href="#three">Last</a></footer>');
 const first=await controller.execute(request('query',{selector:{role:'link'},limit:1}));
 assert.equal(first.result.items[0].name,'First');
 const next=await controller.execute(request('query',{selector:{role:'link'},limit:2,cursor:first.result.next_cursor}));
 assert.deepEqual(next.result.items.map(x=>x.name),['Second','Last']);
 const main=await controller.page.resolve({role:'main'});
 const scoped=await controller.page.query({role:'link',root_ref:main.ref});
 assert.deepEqual(scoped.items.map(x=>x.name),['First','Second']);
}));
test('source frame identity stays exact while page sampling revision advances',()=>fixture(async({page,controller})=>{
 await page.setContent('<main>Parent facts</main><iframe srcdoc="<p>Child one</p>"></iframe>');await controller.page.frames();
 const before=await controller.execute(request('query',{selector:{role:'main'}}));const ref=before.result.items[0].ref;
 await page.locator('iframe').evaluate(el=>el.srcdoc='<p>Child two</p>');await page.frames()[1].waitForFunction(()=>document.body.innerText==='Child two');
 const after=await controller.execute(request('query',{selector:{role:'main'}}));const text=await controller.execute(request('text',{selector:{ref}}));const source=await controller.execute(request('source',{selector:{ref},source:'dom',field:'innerText'}));
 assert.equal(after.result.items[0].ref,ref);assert.ok(after.result.items[0].frame_document_id);
 assert.equal(before.result.items[0].frame_document_id,after.result.items[0].frame_document_id);
 assert.equal(text.result.document_id,after.result.document_id);assert.equal(source.result.document_id,after.result.document_id);
 assert.equal(text.result.frame_document_id,after.result.items[0].frame_document_id);assert.equal(source.result.frame_document_id,text.result.frame_document_id);
 await page.setContent('<main>Replacement</main>');await controller.page.frames();
 const stale=await controller.execute(request('text',{selector:{ref}}));assert.equal(stale.error,'STALE_REFERENCE');
}));
test('AX owns order and complete-scope ambiguity survive bounded query pages',()=>fixture(async({page,controller,transport})=>{
 await page.setContent('<main aria-owns="last first"><a id="first" href="#one">First</a><a id="last" href="#two">Last</a></main><button>Duplicate</button><button>Duplicate</button>');
 const {nodes}=await transport.send('Accessibility.getFullAXTree');
 const source=new Map(nodes.map(node=>[node.nodeId,node]));const expected=[];const walk=id=>{const node=source.get(id);if(!node)return;if(node.role?.value==='link')expected.push(node.name.value);for(const child of node.childIds??[])walk(child);};
 for(const node of nodes.filter(n=>!source.has(n.parentId)))walk(node.nodeId);
 const query=await controller.execute(request('query',{selector:{role:'link'},limit:1}));
 assert.equal(query.result.items[0].name,expected[0]);
 const next=await controller.execute(request('query',{selector:{role:'link'},limit:1,cursor:query.result.next_cursor}));assert.equal(next.result.items[0].name,expected[1]);
 const duplicate=await controller.execute(request('query',{selector:{role:'button',name:'Duplicate'},limit:1}));assert.equal(duplicate.result.total,2);
 const click=await controller.execute(request('click',{selector:{role:'button',name:'Duplicate'}}));assert.equal(click.error,'AMBIGUOUS_ELEMENT');
}));
test('query items retain each frame source identity',()=>fixture(async({page,controller})=>{
 await page.setContent('<a href="#main">Parent</a><iframe srcdoc="<a href=\'#child\'>Child</a>"></iframe>');await page.frames()[1].waitForSelector('a');
 const query=await controller.execute(request('query',{selector:{role:'link'}}));assert.equal(query.result.total,2);
 const [parent,child]=query.result.items;assert.notEqual(parent.frame_id,child.frame_id);assert.notEqual(parent.frame_document_id,child.frame_document_id);
 for(const item of query.result.items){const source=await controller.execute(request('source',{selector:{ref:item.ref},source:'ax',field:'name'}));assert.equal(source.result.frame_document_id,item.frame_document_id);assert.equal(source.result.frame_id,item.frame_id);}
}));
