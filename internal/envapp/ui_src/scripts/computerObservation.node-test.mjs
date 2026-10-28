/* global document, scrollTo */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { createComputerScript } from './redevenComputerScript.mjs';

async function fixture(t, html) {
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1005,height:513}});
  await page.setContent(html);
  const session = await page.context().newCDPSession(page);
  const controller = new BrowserComputerController(session);
  await controller.initialize();
  const execute = (tool_name, args={}) => controller.execute({target_id:'fixture',tool_name,args,script_operation:true});
  return {page, session, controller, execute};
}

test('capture settles same-document viewport changes without replaying input', async t => {
  const {page,session,execute} = await fixture(t,'<div style="height:9000px">Long page</div>');
  const send = session.send.bind(session);
  let captures=0, inputs=0;
  session.send = async (method,args) => {
    if(method.startsWith('Input.')) inputs++;
    const result = await send(method,args);
    if(method==='Page.captureScreenshot' && ++captures<=3) await page.evaluate(y=>scrollTo(0,y),captures*100);
    return result;
  };
  const result=await execute('computer.screenshot');
  assert.equal(result.error,undefined,JSON.stringify(result.result));
  assert.ok(result.screenshot?.geometry);
  assert.ok(captures>=4);
  assert.equal(inputs,0);
});

test('persistent viewport changes return a closed reason and no pixels', async t => {
  const {page,session,execute} = await fixture(t,'<div style="height:9000px">Long page</div>');
  const send=session.send.bind(session);
  let captures=0;
  session.send=async(method,args)=>{
    const result=await send(method,args);
    if(method==='Page.captureScreenshot') await page.evaluate(y=>scrollTo(0,y),(++captures%2)*100);
    return result;
  };
  const started=Date.now(), result=await execute('computer.screenshot');
  assert.equal(result.error,'TARGET_OBSERVATION_UNAVAILABLE');
  assert.equal(result.result.reason,'viewport_unstable');
  assert.equal(result.result.observation_stage,'capture');
  assert.equal(result.screenshot,undefined);
  assert.equal(result.result.action_executed,false);
  assert.ok(Date.now()-started<5000);
});

test('child document replacement preserves parent refs and revokes child refs', async t => {
  const {page,controller,execute}=await fixture(t,'<button>Parent</button><iframe srcdoc="<button>Child</button>"></iframe>');
  await page.frames()[1].waitForSelector('button');
  const first=await execute('computer.observe');
  const parent=first.result.observation.nodes.find(n=>n.name==='Parent'&&n.role==='button').ref;
  const child=first.result.observation.nodes.find(n=>n.name==='Child'&&n.role==='button').ref;
  await page.frames()[1].setContent('<button>Replacement</button>');
  const next=await execute('computer.observe');
  assert.equal(next.result.observation.nodes.find(n=>n.name==='Parent'&&n.role==='button').ref,parent);
  await controller.page.resolve({ref:parent});
  await assert.rejects(controller.page.resolve({ref:child}),/STALE_REFERENCE/);
  await page.locator('iframe').evaluate(node=>node.remove());
  await execute('computer.observe');
  await controller.page.resolve({ref:parent});
  await page.setContent('<button>Parent</button>');
  await assert.rejects(controller.page.resolve({ref:parent}),/STALE_REFERENCE/);
});

test('read-only settling preserves cancellation and transient privacy boundaries', async t => {
  for (const mode of ['cancel','privacy','navigate']) await t.test(mode, async t => {
    const {page,session,controller,execute}=await fixture(t,'<div style="height:9000px">Long page</div>');
    const send=session.send.bind(session);
    let captures=0,inputs=0;
    session.send=async(method,args)=>{
      if(method.startsWith('Input.')) inputs++;
      const result=await send(method,args);
      if(method==='Page.captureScreenshot' && ++captures===1) {
        await page.evaluate(()=>scrollTo(0,100));
        if(mode==='cancel') controller.cancel(true);
        if(mode==='navigate') await page.setContent('<h1>New document</h1>');
        if(mode==='privacy') await page.evaluate(()=>{const el=document.createElement('input');el.type='password';document.body.append(el);el.remove();});
      }
      return result;
    };
    const result=await execute('computer.screenshot');
    assert.equal(result.screenshot,undefined);
    assert.equal(inputs,0);
    if(mode==='privacy') assert.equal(result.safety.level,'takeover');
    else assert.equal(captures,1,'a changed execution boundary must not be retried');
  });
});

test('ref validation fails if its owning document changes during the read', async t => {
  const {page,session,controller,execute}=await fixture(t,'<button>Parent</button>');
  const first=await execute('computer.observe');
  const ref=first.result.observation.nodes.find(n=>n.role==='button').ref;
  const send=session.send.bind(session);
  session.send=async(method,args)=>{
    const result=await send(method,args);
    if(method==='Accessibility.getPartialAXTree') await page.setContent('<button>Parent</button>');
    return result;
  };
  await assert.rejects(controller.page.resolve({ref}),/STALE_REFERENCE/);
});

test('unsupported known options name the exact field without exposing arbitrary keys', async () => {
  for(const [key,field] of [['full','full'],['private-secret-key','arguments']]) {
    const script=await createComputerScript();
    try {
      await assert.rejects(script.execute(`await ui.ref('r').snapshot({${JSON.stringify(key)}:true})`,async()=>assert.fail('invalid dispatch')),error=>{
        assert.equal(error.result.diagnostic.method,'locator.snapshot');
        assert.equal(error.result.diagnostic.field,field);
        assert.equal(error.result.diagnostic.expected,'documented_fields');
        assert.equal(JSON.stringify(error.result).includes('private-secret-key'),false);
        return true;
      });
    } finally {script.dispose();}
  }
});

test('required wait failure retains its operation and condition without condition text', async () => {
  const script=await createComputerScript();
  try {
    await assert.rejects(script.execute("await ui.snapshot(); try { await ui.ref('r').requireState({state:'text',equals:'private-value',timeout_ms:0}); } catch {} await ui.type('must not run');",async op=>{
      assert.notEqual(op.action,'type');
      return op.action==='wait'?{state:'timeout',requested_state:'text'}:{observation:{nodes:[],document_id:'fixture',truncated:false}};
    }),error=>{
      assert.equal(error.result.diagnostic.code,'CONDITION_TIMEOUT');
      assert.equal(error.result.diagnostic.method,'locator.requireState');
      assert.equal(error.result.diagnostic.state,'text');
      assert.equal(error.result.diagnostic.timeout_ms,0);
      assert.equal(error.result.diagnostic.operation_index,1);
      assert.equal(JSON.stringify(error.result).includes('private-value'),false);
      return true;
    });
  } finally {script.dispose();}
});

test('source-owned child navigation preserves parent refs across process boundaries', async t => {
  const {createServer}=await import('node:http');
  const {once}=await import('node:events');
  const {createComputerBrowserSource}=await import('./computerBrowserSource.mjs');
  for(const crossSite of [false,true]) await t.test(crossSite?'cross-process':'same-process',async t=>{
    let port;
    const site=createServer((req,res)=>{
      res.setHeader('content-type','text/html');
      res.end(req.url==='/'?`<button>Parent</button><iframe src="http://${crossSite?'localhost':'127.0.0.1'}:${port}/child"></iframe>`:'<button>Child</button>');
    });
    site.listen(0);await once(site,'listening');port=site.address().port;
    const browser=await chromium.launch({args:['--site-per-process']});
    let owner;
    t.after(async()=>{await owner?.dispose();await browser.close();site.closeAllConnections();await new Promise(r=>site.close(r));});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}`);
    owner=await createComputerBrowserSource(page,'frame-scope',{captureDownloads:true});
    const observe=()=>owner.controller.execute({target_id:'frame-scope',tool_name:'computer.observe',full_access:true,script_operation:true});
    const first=await observe();
    const parent=first.result.observation.nodes.find(n=>n.role==='button'&&n.name==='Parent').ref;
    const child=first.result.observation.nodes.find(n=>n.role==='button'&&n.name==='Child').ref;
    if(crossSite) assert.ok(owner.source.sessions().length>1,'fixture must exercise OOP sessions');
    await page.frames()[1].goto(`http://${crossSite?'localhost':'127.0.0.1'}:${port}/replacement`);
    await observe();
    await owner.controller.page.resolve({ref:parent});
    await assert.rejects(owner.controller.page.resolve({ref:child}),/STALE_REFERENCE/);
    await page.locator('iframe').evaluate(el=>el.remove());
    await observe();
    await owner.controller.page.resolve({ref:parent});
  });
});
