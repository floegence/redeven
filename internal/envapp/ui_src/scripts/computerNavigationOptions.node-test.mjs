import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { createComputerScript } from './redevenComputerScript.mjs';
import { BrowserComputerPage } from './computerBrowserPage.mjs';

test('unrelated frame and loader events cannot satisfy the selected navigation', async () => {
  const transport=new EventEmitter();const page=new BrowserComputerPage(transport);
  transport.send=async()=>{
    transport.emit('Page.lifecycleEvent',{name:'load',loaderId:'old-root',frameId:'main'});
    transport.emit('Page.navigatedWithinDocument',{frameId:'child'});
    transport.emit('Page.frameNavigated',{frame:{id:'child',parentId:'main',loaderId:'child-loader'}});
    return {frameId:'main',loaderId:'new-root'};
  };
  const result=await page.navigate('Page.navigate',{url:'https://fixture.test'},{wait_until:'commit',timeout_ms:0});
  assert.equal(result.wait.state,'timeout');assert.equal(result.navigation_stage,'response');
  assert.equal(transport.listenerCount('Page.lifecycleEvent'),0);
});

test('navigation options validate before dispatch and timeout data permits explicit reads', async () => {
  const script = await createComputerScript();
  try {
    const calls = [];
    const result = await script.execute("const r=await browser.navigate('https://fixture.test',{wait_until:'commit',timeout_ms:0});if(r.wait.state==='timeout')await ui.snapshot();", async op => {
      calls.push(op);return op.action === 'navigate' ? {wait:{state:'timeout'}} : {observation:{nodes:[]}};
    });
    assert.equal(result.operations, 2);
    assert.deepEqual(calls[0], {action:'navigate',url:'https://fixture.test',wait_until:'commit',timeout_ms:0});
    for (const options of ["{wait_until:'networkidle'}", '{timeout_ms:-1}', '{timeout_ms:30001}', '{quiet:true}']) {
      await assert.rejects(script.execute('await browser.reload('+options+');', async () => assert.fail('invalid dispatch')));
    }
  } finally { script.dispose(); }
});

test('slow subresource keeps load distinct from commit, DOM content and explicit reads', async () => {
  const server = http.createServer((req,res) => {
    if(req.url==='/slow.png') return;
    res.setHeader('Content-Type','text/html');res.end('<h1>Available report</h1><img src="/slow.png">');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});let controller;
  try {
    const tab=await browser.newPage();const session=await tab.context().newCDPSession(tab);
    controller=new BrowserComputerController(session);await controller.initialize();
    const call=(tool_name,args={})=>controller.execute({tool_name,args,full_access:true,script_operation:true});
    const url='http://127.0.0.1:'+server.address().port;
    let navigations=0;const send=session.send.bind(session);
    session.send=(method,args)=>{if(method==='Page.navigate')navigations++;return send(method,args);};
    for(const stage of ['commit','domcontentloaded','load']) {
      const result=await call('browser_navigate',{url:url+'/?stage='+stage,wait_until:stage,timeout_ms:250});
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.equal(result.result.wait.state,stage==='load'?'timeout':'reached');
      assert.equal(result.result.wait.wait_until,stage);
      assert.equal(result.result.command_acknowledged,true);
      assert.equal(result.result.action_executed,true);
      const ready=await call('computer.action',{action:'wait',selector:{role:'heading',name:'Available report'},state:'visible',timeout_ms:1000});
      assert.equal(ready.result.state,'visible',JSON.stringify(ready));
      const observation=await call('computer_observe');
      assert.ok(observation.result.observation.nodes.some(n=>n.name==='Available report'));
    }
    assert.equal(navigations,3);
    const reload=await call('browser_reload',{wait_until:'domcontentloaded',timeout_ms:1000});
    assert.equal(reload.result.wait.state,'reached',JSON.stringify(reload));
    const back=await call('browser_go_back',{wait_until:'commit',timeout_ms:1000});
    assert.equal(back.result.wait.state,'reached',JSON.stringify(back));
    await call('computer.action',{action:'wait',selector:{role:'heading',name:'Available report'},state:'visible',timeout_ms:1000});
    const hash=await call('browser_navigate',{url:tab.url()+'#section',wait_until:'load',timeout_ms:1000});
    assert.equal(hash.result.wait?.state,'reached',JSON.stringify(hash));
    assert.equal(hash.result.navigation_stage,'same_document');
  } finally {
    if(controller){await controller.page.releasePage();controller.close();}await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
