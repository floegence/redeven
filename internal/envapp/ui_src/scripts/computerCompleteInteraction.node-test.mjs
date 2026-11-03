/* global document, getSelection */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

test('complete explicit reads and pointer/selection operations preserve page facts', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Complete interface</title><textarea aria-label="Editor">hello 🌻 world</textarea><button aria-label="Menu">Menu</button><section aria-label="Long">'+ 'a'.repeat(13000) +'TAIL</section><a href="https://example.test/path?q=complete#tail" data-extra="value">Exact link</a><div hidden>Hidden source fact</div>');
    await page.evaluate(() => { globalThis.events=[]; const b=document.querySelector('button'); b.addEventListener('mouseenter',()=>globalThis.events.push('hover')); b.addEventListener('contextmenu',e=>{e.preventDefault();globalThis.events.push('right');}); });
    const session=await page.context().newCDPSession(page);
    const controller=new BrowserComputerController(session); await controller.page.initialize();
    const run=async args=>{
      const result=await controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args});
      assert.equal(result.error,undefined,JSON.stringify(result)); return result.result;
    };
    const select={role:'textbox',name:'Editor',exact:true};
    await run({action:'hover',selector:{role:'button',name:'Menu'}});
    await run({action:'click',selector:{role:'button',name:'Menu'},button:'right'});
    assert.deepEqual(await page.evaluate(()=>globalThis.events),['hover','right']);
    await run({action:'select_text',selector:select,text:'🌻',selection_type:'text'});
    const selection=await run({action:'selection',selector:select});
    assert.equal(selection.text,'🌻'); assert.equal(selection.start,6); assert.equal(selection.end,8);
    await run({action:'replace_selection',selector:select,text:'flower'});
    assert.equal(await page.locator('textarea').inputValue(),'hello flower world');
    const first=await run({action:'source',selector:{role:'region',name:'Long'},source:'dom',field:'textContent',limit:12000});
    assert.equal(first.truncated,true);
    const tail=await run({action:'source',selector:{role:'region',name:'Long'},source:'dom',field:'textContent',limit:12000,cursor:first.next_cursor});
    assert.equal(tail.value.endsWith('TAIL'),true); assert.equal(tail.truncated,false);
    const href=await run({action:'source',selector:{role:'link',name:'Exact link'},source:'dom',field:'attribute:href'});
    assert.equal(href.value,'https://example.test/path?q=complete#tail');
    await page.locator('a').evaluate(e=>e.href='https://user:private@example.test/path?q=complete#tail');
    const clean=await run({action:'source',selector:{role:'link',name:'Exact link'},source:'dom',field:'attribute:href'});
    assert.equal(clean.value,'https://example.test/path?q=complete#tail');assert.deepEqual(clean.redacted,['url_credentials']);
    const axURL=await run({action:'source',selector:{role:'link',name:'Exact link'},source:'ax',field:'properties'});
    assert.equal(axURL.value.includes('private'),false);assert.ok(axURL.value.includes('?q=complete#tail'));
    const fields=await run({action:'source',selector:{role:'link',name:'Exact link'},source:'dom'});
    assert.ok(fields.fields.includes('attribute:data-extra'));
  } finally {await browser.close();}
});

test('copy cut paste and controls expose real editing effects', async () => {
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
    await context.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<textarea aria-label="Editor">alpha 🌻 omega</textarea><div contenteditable role="textbox" aria-label="Rich">rich flower text</div><input type="checkbox" aria-label="Flag"><select aria-label="Choice" multiple><option value="one">One</option><option value="two">Two</option></select>'}));
    const page=await context.newPage();await page.goto('https://fixture.test');
    const controller=new BrowserComputerController(await context.newCDPSession(page));await controller.page.initialize();
    const run=async args=>{const r=await controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args});assert.equal(r.error,undefined,JSON.stringify(r));return r.result;};
    const selector={role:'textbox',name:'Editor',exact:true};
    await run({action:'select_text',selector,text:'🌻'});
    assert.equal((await run({action:'copy',selector})).accepted,true);
    assert.equal(await page.locator('textarea').inputValue(),'alpha 🌻 omega');
    const clipboard=await run({action:'clipboard',operation:'read'});
    assert.equal(Buffer.from(clipboard.items[0]['text/plain'],'base64').toString(),'🌻');
    assert.equal((await run({action:'cut',selector})).accepted,true);
    assert.equal(await page.locator('textarea').inputValue(),'alpha  omega');
    assert.equal((await run({action:'paste',selector})).dispatched,true);
    assert.equal(await page.locator('textarea').inputValue(),'alpha 🌻 omega');
    await run({action:'select_all',selector});
    await run({action:'paste',selector,text:'supplied Unicode 🪷'});
    assert.equal(await page.locator('textarea').inputValue(),'supplied Unicode 🪷');
    const rich={role:'textbox',name:'Rich',exact:true};
    await run({action:'select_text',selector:rich,text:'flower'});
    await run({action:'replace_selection',selector:rich,text:'🌻'});
    assert.equal(await page.locator('[contenteditable]').textContent(),'rich 🌻 text');
    await run({action:'set_value',selector:{role:'checkbox',name:'Flag'},value:true});
    assert.equal(await page.locator('[type=checkbox]').isChecked(),true);
    await run({action:'set_value',selector:{role:'listbox',name:'Choice'},value:['one','two']});
    assert.deepEqual(await page.locator('select').evaluate(e=>[...e.selectedOptions].map(o=>o.value)),['one','two']);
    const invalid=await controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{action:'select_range',selector,start:18,end:19}});
    assert.ok(invalid.error,'surrogate split must fail');
  }finally{await browser.close();}
});

test('source cursors reject changed values and hidden protected input',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<section aria-label="Facts">'+ 'a'.repeat(13000)+'</section>');
    const controller=new BrowserComputerController(await page.context().newCDPSession(page));await controller.page.initialize();
    const args={action:'source',selector:{role:'region',name:'Facts'},source:'dom',field:'textContent',limit:100};
    const run=extra=>controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args:{...args,...extra}});
    const first=await run({});assert.equal(first.error,undefined);
    await page.locator('section').evaluate(e=>e.append('changed'));
    assert.ok((await run({cursor:first.result.next_cursor})).error);
    await page.locator('section').evaluate(e=>{const input=document.createElement('input');input.type='password';input.hidden=true;input.value='protected-value';e.append(input);});
    const protectedRead=await run({});assert.ok(protectedRead.error||protectedRead.safety?.level==='takeover');
    assert.equal(JSON.stringify(protectedRead).includes('protected-value'),false);
  }finally{await browser.close();}
});

test('source child pages, detached refs, file selection and invalid actions retain boundaries',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();await page.setContent('<section aria-label="Many">'+Array.from({length:250},(_,i)=>'<span hidden>row '+i+'</span>').join('')+'</section><input type="file" aria-label="Upload"><textarea aria-label="Editor">🌻 text</textarea>');
  const controller=new BrowserComputerController(await page.context().newCDPSession(page));await controller.page.initialize();
  const run=args=>controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args});
  const selector={role:'region',name:'Many'};
  const first=await run({action:'source',selector,source:'dom',field:'child_refs',limit:200});
  assert.equal(first.result.items.length,200);assert.equal(first.result.total,250);
  const last=await run({action:'source',selector,source:'dom',field:'child_refs',limit:200,cursor:first.result.next_cursor});
  assert.equal(last.result.items.length,50);assert.equal(last.result.truncated,false);
  const ref=last.result.items.at(-1);
  assert.equal((await run({action:'source',selector:{ref},source:'dom',field:'textContent'})).result.value,'row 249');
  await page.locator('span').last().evaluate(e=>e.remove());
  assert.equal((await run({action:'source',selector:{ref},source:'dom',field:'textContent'})).error,'STALE_REFERENCE');
  const invalid=await run({action:'select_range',selector:{role:'textbox',name:'Editor'},start:1,end:2});
  assert.equal(invalid.error,'INVALID_REQUEST');assert.equal(invalid.result.action_executed,false);
  const upload=await run({action:'set_files',selector:{role:'button',name:'Upload'},files:[{name:'fixture.txt',mime_type:'text/plain',base64:Buffer.from('payload 🌻').toString('base64')}]});
  assert.equal(upload.error,undefined,JSON.stringify(upload));
  assert.equal(await page.locator('[type=file]').evaluate(async e=>e.files[0].text()),'payload 🌻');
  const restricted=await controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:false,allowed_origins:[],args:{action:'clipboard',operation:'read'}});
  assert.equal(restricted.error,'TARGET_PERMISSION_REQUIRED');assert.equal(restricted.result.action_executed,false);
 } finally {await browser.close();}
});

test('explicit input preserves modifiers, repeat, direction and cancellation releases',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();await page.setContent('<textarea aria-label="Editor">abcd</textarea><div role="textbox" contenteditable aria-label="Rich">abcdef</div><button>Pointer</button>');
  const controller=new BrowserComputerController(await page.context().newCDPSession(page));await controller.page.initialize();
  const run=args=>controller.execute({target_id:'fixture',tool_name:'computer.action',script_operation:true,full_access:true,args});
  await page.evaluate(()=>{globalThis.transitions=[];document.addEventListener('keydown',e=>globalThis.transitions.push({key:e.key,shift:e.shiftKey,repeat:e.repeat}));document.addEventListener('contextmenu',e=>{e.preventDefault();globalThis.pointer={button:e.button,shift:e.shiftKey};});});
  await run({action:'select_range',selector:{role:'textbox',name:'Editor'},start:1,end:3,direction:'backward'});
  assert.equal(await page.locator('textarea').evaluate(e=>e.selectionDirection),'backward');
  const typed=await run({action:'input_sequence',events:[{type:'keyDown',key:'Shift'},{type:'keyDown',key:'a',repeat:true},{type:'keyUp',key:'a'},{type:'keyUp',key:'Shift'}]});
  assert.equal(typed.error,undefined,JSON.stringify(typed));
  assert.equal(await page.locator('textarea').inputValue(),'aAd');
  assert.ok((await page.evaluate(()=>globalThis.transitions)).some(e=>e.key==='A'&&e.shift&&e.repeat));
  const box=await page.locator('button').boundingBox();
  const pointer=await run({action:'input_sequence',events:[{type:'mousePressed',x:box.x+5,y:box.y+5,button:'right',modifiers:['Shift']},{type:'mouseReleased',x:box.x+5,y:box.y+5,button:'right',modifiers:['Shift']}]});
  assert.equal(pointer.error,undefined,JSON.stringify(pointer));assert.deepEqual(await page.evaluate(()=>globalThis.pointer),{button:2,shift:true});
  await run({action:'select_range',selector:{role:'textbox',name:'Rich'},start:1,end:4,direction:'backward'});
  assert.deepEqual(await page.evaluate(()=>({anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})),{anchor:4,focus:1});
  const blocked=await run({action:'input_sequence',events:[{type:'keyDown',key:'Meta'},{type:'keyDown',key:'v'}]});
  assert.equal(blocked.error,'TARGET_NOT_ALLOWED');assert.equal(blocked.result.action_executed,false);
  const fake={send:async(method,args)=>{globalThis.cleanup.push({method,...args});}};
  globalThis.cleanup=[];
  const p=controller.page;
  p.heldInput.set('key:v',{session:fake,method:'Input.dispatchKeyEvent',parameters:{type:'rawKeyDown',key:'v',commands:['Paste'],modifiers:4,text:'v'}});
  p.heldInput.set('mouse:right',{session:fake,method:'Input.dispatchMouseEvent',parameters:{type:'mousePressed',button:'right',buttons:2,modifiers:8,x:1,y:2}});
  await p.releaseInput();
  assert.equal(p.heldInput.size,0);assert.ok(globalThis.cleanup.every(e=>!e.commands&&!e.text&&e.modifiers===0));
  assert.equal(globalThis.cleanup[1].type,'mouseReleased');assert.equal(globalThis.cleanup[1].buttons,0);
 }finally{await browser.close();}
});
