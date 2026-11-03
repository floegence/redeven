/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';

async function fixture(html, run) {
  const browser = await chromium.launch({headless:true});
  let controller;
  try {
    const tab = await browser.newPage({viewport:{width:800,height:600}});
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab);
    controller = new BrowserComputerController(session);
    await controller.initialize();
    const call = (tool_name,args={}) => controller.execute({target_id:'factual',tool_name,args,script_operation:true,full_access:true});
    await run({tab,controller,session,call});
  } finally { if(controller){await controller.page.releasePage();controller.close();}await browser.close(); }
}

test('nested wheel reports only the explicit measured element, never a guessed receiver',()=>fixture('<style>body{margin:0}main{width:600px;height:300px;overflow:hidden}#inner{width:580px;height:280px;overflow:auto}#content{height:2000px}</style><main><div id="inner"><div id="content">Content</div></div></main>',async({tab,call})=>{
  const observed=await call('computer.observe');
  const main=observed.result.observation.nodes.find(n=>n.role==='main');
  const r=await call('computer.action',{action:'scroll',selector:{ref:main.ref},delta_y:200});
  assert.equal(r.error,undefined,JSON.stringify(r));
  await tab.waitForFunction(()=>document.querySelector('#inner').scrollTop===200);
  const p=r.result.scroll_progress;
  assert.equal(p.measured_ref,main.ref);
  assert.equal(p.scope,'requested_element');
  assert.equal(p.before.y,0);assert.equal(p.after.y,0);
  assert.equal(p.offset_changed,false);
  assert.equal(p.changed,undefined);
  assert.equal(p.scroll_effect,'unknown');
  assert.equal(r.result.input_dispatched,true);
}));

test('pure input returns a receipt without a post-action metadata read',()=>fixture('<button>Act</button>',async({controller,call})=>{
  const inFrame=controller.page.inFrame.bind(controller.page);
  controller.page.inFrame=(frame,expression,accepts)=>{if(expression==='document.title')throw new Error('metadata unavailable');return inFrame(frame,expression,accepts);};
  const r=await call('computer.action',{action:'click',selector:{role:'button',name:'Act'}});
  assert.equal(r.error,undefined,JSON.stringify(r));
  assert.equal(r.result.action_executed,true);
  assert.equal(r.result.needs_observation,true);
  assert.equal(r.result.title,undefined);assert.equal(r.result.url,undefined);
  assert.equal(r.safety.safe_to_send_to_model,false);
  assert.equal((await call('computer.observe')).error,'TARGET_OBSERVATION_UNAVAILABLE');
}));

test('reads scan at entry and final publication; waits report time and samples',()=>fixture('<button>Ready</button>',async({controller,call})=>{
  let scans=0;const safety=controller.page.safety.bind(controller.page);
  controller.page.safety=(...args)=>{scans++;return safety(...args);};
  assert.equal((await call('computer.observe')).error,undefined);assert.equal(scans,2);
  scans=0;
  const r=await call('computer.action',{action:'wait',selector:{role:'button',name:'Absent'},state:'visible',timeout_ms:220});
  assert.equal(r.result.state,'timeout');assert.ok(r.result.elapsed_ms>=220);
  assert.ok(r.result.samples>=2);assert.ok(scans<=r.result.samples+2);
  assert.equal(r.result.title,undefined);assert.equal(r.result.requested_state,'visible');
}));

test('browser node actions do not guess supported input from role',()=>fixture('<table aria-label="Data"><tr><th>Metric</th></tr><tr><td>Count</td></tr></table>',async({call})=>{
  const r=await call('computer.observe');const cell=r.result.observation.nodes.find(n=>n.role==='cell');
  assert.equal(cell.actions_scope,'declared_only');
  assert.deepEqual(cell.actions,['read']);
  assert.equal((await call('computer.action',{action:'click',selector:{ref:cell.ref}})).result.action_executed,true);
}));

test('attribute href preserves source while summary is explicitly redacted',()=>fixture('<a href="https://user:pass@example.test/report?period=7#daily">Report</a>',async({call})=>{
  const args={action:'attribute',selector:{role:'link',name:'Report'},attribute:'href'};
  const raw=await call('computer.action',args);
  assert.equal(raw.result.value,'https://example.test/report?period=7#daily');
  assert.deepEqual(raw.result.redacted,['url_credentials']);
  const summary=await call('computer.action',{...args,summary:true});
  assert.equal(summary.result.value,'https://example.test/report');
  assert.equal(summary.result.value_kind,'link_summary');
}));

for(const transition of ['scan_failure','private_input','permission','cancel']) {
  test('acknowledged input retains the '+transition+' boundary',()=>fixture('<button>Act</button>',async({controller,tab,session,call})=>{
    const action=controller.page.action.bind(controller.page);
    let dispatched=0;const send=session.send.bind(session);
    session.send=(method,args)=>{if(method==='Input.dispatchMouseEvent'&&args.type==='mousePressed')dispatched++;return send(method,args);};
    controller.page.action=async args=>{
      const result=await action(args);
      if(transition==='scan_failure')controller.page.safety=async()=>{throw new Error('unavailable');};
      if(transition==='private_input')await tab.evaluate(()=>{const input=document.createElement('input');input.type='password';document.body.append(input);});
      if(transition==='permission')controller.page.requiredURL='https://ungranted.test/';
      if(transition==='cancel')controller.page.operationCancelled=true;
      return result;
    };
    const result=await call('computer.action',{action:'click',selector:{role:'button',name:'Act'}});
    assert.equal(dispatched,1);assert.equal(result.result.action_executed,true);
    assert.equal(result.result.title,undefined);assert.equal(result.result.observation,undefined);
    if(transition==='scan_failure'){
      assert.equal(result.error,undefined);assert.equal(result.result.post_action_check.state,'unavailable');
      assert.equal(result.safety.safe_to_send_to_model,false);
    }else if(transition==='private_input')assert.equal(result.safety.level,'takeover');
    else assert.equal(result.error,transition==='permission'?'TARGET_PERMISSION_REQUIRED':'TARGET_OBSERVATION_UNAVAILABLE');
  }));
}

test('table cell references reach complete source text beyond its displayed prefix',()=>fixture('<table aria-label="Data"><tr><th>Metric</th></tr><tr><td>'+ 'x'.repeat(2100) +'TAIL</td></tr></table>',async({call})=>{
  const result=await call('computer.action',{action:'table',selector:{role:'table',name:'Data'}});
  const cell=result.result.rows[1].cells[0];
  assert.equal(cell.text_truncated,true);assert.ok(cell.ref);
  const source=await call('computer.action',{action:'source',selector:{ref:cell.ref},source:'dom',field:'textContent'});
  assert.equal(source.result.value.endsWith('TAIL'),true);assert.equal(source.result.truncated,false);
}));
