/* global document, window */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { BrowserObservationInvalidated } from './computerBrowserPage.mjs';

async function fixture(html, run) {
  const browser = await chromium.launch({headless:true});
  let controller;
  try {
    const tab = await browser.newPage();
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab);
    controller = new BrowserComputerController(session);
    await controller.initialize();
    const call = (tool_name, args = {}) => controller.execute({tool_name,args,full_access:true,script_operation:true});
    const initial = await call('computer.observe', {limit:1000});
    assert.ok(initial.result.observation, JSON.stringify(initial));
    await run({tab,session,controller,call,initial});
  } finally {
    if (controller) { await controller.page.releasePage(); controller.close(); }
    await browser.close();
  }
}

test('text waits measure layout without inventing hidden state', async () => fixture(
  '<main><p>Ordinary</p><span>Inline</span><span style="display:contents">Contents</span><p style="width:30px">Multiple lines</p><svg><text y="20">Vector</text></svg><p style="position:absolute;top:3000px">Offscreen</p><div id="shadow"></div></main>',
  async ({tab,controller,call}) => {
    await tab.evaluate(() => { document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<span>Shadow</span>'; });
    for (const name of ['Ordinary','Inline','Contents','Multiple lines','Vector','Offscreen','Shadow']) {
      const selector = {role:'StaticText',name,exact:true};
      const visible = await call('computer.action',{action:'wait',selector,state:'visible',timeout_ms:40});
      assert.equal(visible.result.state,'visible', name + JSON.stringify(visible));
      const hidden = await call('computer.action',{action:'wait',selector,state:'hidden',timeout_ms:0});
      assert.equal(hidden.result.state,'timeout',name);
      assert.equal(hidden.result.last_known.found,true);
    }
    const entry = await controller.page.resolve({role:'StaticText',name:'Ordinary',exact:true});
    await tab.locator('p').first().evaluate(e => { e.style.visibility='hidden'; });
    assert.equal((await controller.page.elementState(entry)).visible,false);
    await tab.locator('p').first().evaluate(e => { e.style.visibility='visible'; e.style.display='none'; });
    assert.equal((await controller.page.elementState(entry)).visible,false);
    await tab.locator('p').first().evaluate(e => e.remove());
    const detached = await controller.page.elementState(entry);
    assert.equal(detached.connected,false);
  }));

test('transparent pointer targets and disabled hover retain browser semantics', async () => fixture(
  '<label style="display:block;position:relative;width:180px;height:40px"><input type="radio" aria-label="Choice" style="opacity:0;position:absolute;inset:0;width:180px;height:40px;margin:0"><span>Choice</span></label><button disabled onpointerenter="window.enters=(window.enters||0)+1">Disabled</button>',
  async ({tab,call}) => {
    const click = await call('computer.action',{action:'click',selector:{role:'radio',name:'Choice',exact:true}});
    assert.equal(click.error,undefined,JSON.stringify(click));
    assert.equal(await tab.locator('input').isChecked(),true);
    const hover = await call('computer.action',{action:'hover',selector:{role:'button',name:'Disabled',exact:true}});
    assert.equal(hover.error,undefined,JSON.stringify(hover));
    assert.equal(await tab.evaluate(() => window.enters),1);
    const disabledClick = await call('computer.action',{action:'click',selector:{role:'button',name:'Disabled',exact:true}});
    assert.equal(disabledClick.error,'ELEMENT_NOT_ACTIONABLE');
    assert.equal(disabledClick.result.actionability.enabled,false);
  }));

test('guest node order preserves depth-first structural grouping', async () => fixture(
  '<main><section><h2>Title A</h2><span><b>Severity A</b></span><p>Date A</p></section><section><h2>Title B</h2><span><b>Severity B</b></span><p>Date B</p></section></main>',
  async ({initial}) => {
    assert.deepEqual(initial.result.observation.nodes.filter(n=>n.role==='StaticText').map(n=>n.name),['Title A','Severity A','Date A','Title B','Severity B','Date B']);
  }));

test('root hit test has no dependency on unrelated frame enumeration', async () => fixture(
  '<button onclick="window.clicks=(window.clicks||0)+1">Go</button><iframe srcdoc="<p>Auxiliary</p>"></iframe>',
  async ({tab,controller,call}) => {
    const receives = controller.page.receivesPoint.bind(controller.page);
    const frames = controller.page.frames.bind(controller.page);
    controller.page.receivesPoint = async (...args) => {
      controller.page.frames = async () => { throw new BrowserObservationInvalidated(); };
      try { return await receives(...args); } finally { controller.page.frames = frames; }
    };
    const result = await call('computer.action',{action:'click',selector:{role:'button',name:'Go',exact:true}});
    assert.equal(result.error,undefined,JSON.stringify(result));
    assert.equal(await tab.evaluate(() => window.clicks),1);
  }));

for (const scope of ['main','whole','target']) test('observation lifetime tracks '+scope+' dependencies', async () => fixture(
  '<main><button>Ready</button></main><iframe srcdoc="<p>Auxiliary</p>"></iframe>',
  async ({session,controller,call,initial}) => {
    const root = initial.result.observation.nodes.find(n=>n.role==='main');
    const child = (await controller.page.frames()).find(f=>f.frame.parentId);
    const send = session.send.bind(session);
    let injected = false;
    session.send = async (method,args) => {
      const result = await send(method,args);
      if (method==='Accessibility.getFullAXTree' && args.frameId===root.frame_id && !injected) {
        injected=true; controller.page.invalidate([scope==='target'?root.frame_id:child.frame.id]);
      }
      return result;
    };
    const result = await call('computer.observe',scope==='whole'?{}:{root_ref:root.ref});
    assert.equal(injected,true);
    if (scope==='main') assert.ok(result.result.observation,JSON.stringify(result));
    else { assert.equal(result.result.observation_invalidated,true,JSON.stringify(result)); assert.equal(result.result.observation,undefined); }
  }));

for (const boundary of ['privacy','screenshot']) test('scoped read preserves '+boundary+' boundary', async () => fixture(
  '<main><button>Ready</button></main><iframe srcdoc="<p>Auxiliary</p>"></iframe>',
  async ({controller,call,initial}) => {
    const root = initial.result.observation.nodes.find(n=>n.role==='main');
    const child = (await controller.page.frames()).find(f=>f.frame.parentId);
    const observe = controller.page.observe.bind(controller.page);
    controller.page.observe = async (...args) => {
      const result = await observe(...args);
      controller.page.invalidate([child.frame.id]);
      if (boundary==='privacy') controller.page.safety = async () => ({level:'takeover',reason_codes:['secret_input'],safe_to_capture:false,safe_to_send_to_model:false});
      return result;
    };
    const result = await call('computer.observe',{root_ref:root.ref,...(boundary==='screenshot'?{screenshot:true}:{})});
    assert.equal(result.result.observation,undefined,JSON.stringify(result));
    if (boundary==='privacy') assert.equal(result.safety.level,'takeover');
    else assert.equal(result.result.observation_invalidated,true);
  }));
