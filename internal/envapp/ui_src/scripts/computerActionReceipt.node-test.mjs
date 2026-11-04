/* global window */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { createComputerScript } from './redevenComputerScript.mjs';

for (const scenario of ['target', 'descendant', 'shadow', 'cover']) {
  test('pseudo-element hit ownership preserves actionability for ' + scenario, async () => {
    const browser=await chromium.launch({headless:true});let controller;
    try {
      const tab=await browser.newPage();
      const style='<style>a{display:block;position:relative;width:200px;height:40px}a::before,span::after,.cover::before{content:"";position:absolute;inset:0}.cover{position:absolute;left:8px;top:8px;width:200px;height:40px;z-index:10}</style>';
      const link='<a href="#report" onclick="window.deliveries=(window.deliveries||0)+1">'+(scenario==='descendant'?'<span>Report</span>':'Report')+'</a>';
      await tab.setContent(scenario==='shadow'?'<div id="host"></div>':style+link+(scenario==='cover'?'<div class="cover"></div>':''));
      if(scenario==='shadow')await tab.locator('#host').evaluate((host,html)=>{host.attachShadow({mode:'open'}).innerHTML=html;},style+link);
      const session=await tab.context().newCDPSession(tab);controller=new BrowserComputerController(session);await controller.initialize();
      const send=session.send.bind(session);const pseudoHits=[];let posted=0;
      session.send=async(method,args)=>{
        if(method.startsWith('Input.'))posted++;
        const result=await send(method,args);
        if(method==='DOM.getNodeForLocation'){const {node}=await send('DOM.describeNode',{backendNodeId:result.backendNodeId});pseudoHits.push(node.pseudoType);}
        return result;
      };
      const result=await controller.execute({tool_name:'computer.action',args:{action:'click',selector:{role:'link',name:'Report',exact:true}},full_access:true,script_operation:true});
      if(scenario!=='cover')assert.ok(pseudoHits.some(Boolean),'fixture must exercise a real CSS pseudo-element hit');
      if(scenario==='cover'){assert.equal(result.error,'ELEMENT_NOT_ACTIONABLE');assert.equal(posted,0);}
      else {assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.action_executed,true);assert.equal(await tab.evaluate(()=>window.deliveries),1);}
    } finally {if(controller){await controller.page.releasePage();controller.close();}await browser.close();}
  });
}

test('runtime SyntaxError retains execution phase while compilation errors use parse', async () => {
  for (const [code, phase, logs] of [["log('started'); JSON.parse(undefined);", 'execution', [['started']]], ['const broken = ;', 'parse', []]]) {
    const script = await createComputerScript();
    try {
      await assert.rejects(script.execute(code, async () => assert.fail()), error => {
        assert.equal(error.result.diagnostic.phase, phase);
        assert.equal(error.result.diagnostic.code, 'SCRIPT_SYNTAX_ERROR');
        assert.deepEqual(error.result.logs, logs);
        return true;
      });
    } finally { script.dispose(); }
  }
});

for (const boundary of ['before_preparation', 'hit_test', 'after_pointer_move', 'after_input', 'release']) {
  test('click receipt separates preparation and delivery at ' + boundary, async () => {
    const browser = await chromium.launch({headless:true});
    let controller;
    try {
      const tab = await browser.newPage();
      await tab.setContent('<a href="#report">Report</a>');
      const session = await tab.context().newCDPSession(tab);
      controller = new BrowserComputerController(session);
      await controller.initialize();
      const send = session.send.bind(session);
      let inputs = 0;
      session.send = async (method, params = {}) => {
        if (boundary === 'before_preparation' && method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('getClientRects'))
          return {exceptionDetails:{text:'private exception'}};
        if (boundary === 'hit_test' && method === 'Runtime.callFunctionOn' && params.functionDeclaration.startsWith('function(hit,'))
          return {exceptionDetails:{text:'private exception'}};
        if (boundary === 'release' && method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') throw new Error('lost reply');
        const result = await send(method, params);
        if (method.startsWith('Input.')) inputs++;
        if (boundary === 'after_pointer_move' && method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') controller.page.stopped = true;
        return result;
      };
      if (boundary === 'after_input') {
        const safety = controller.page.safety.bind(controller.page);
        controller.page.safety = (...args) => inputs ? Promise.reject(new Error('unavailable')) : safety(...args);
      }
      const result = await controller.execute({tool_name:'computer.action',args:{action:'click',selector:{role:'link',name:'Report',exact:true}},full_access:true,script_operation:true});
      assert.equal(JSON.stringify(result).includes('private exception'), false);
      if (boundary === 'after_input') {
        assert.equal(result.error, undefined);
        assert.equal(result.result.action_executed, true);
        assert.equal(inputs, 3);
      } else if (boundary === 'release') {
        assert.equal(result.error, 'EFFECT_OUTCOME_UNKNOWN');
        assert.notEqual(result.result.action_executed, true);
      } else {
        assert.equal(result.result.action_executed, false);
        assert.equal(result.result.preparation_executed === true, boundary !== 'before_preparation');
        assert.equal(inputs, boundary === 'after_pointer_move' ? 1 : 0);
        if (boundary === 'after_pointer_move') assert.equal(result.result.input_progress.observed, 1);
        if (boundary === 'hit_test') {
          assert.equal(result.result.diagnostic.checkpoint, 'target_ancestry');
          assert.equal(result.result.needs_observation, true);
        }
      }
    } finally {
      if (controller) { await controller.page.releasePage(); controller.close(); }
      await browser.close();
    }
  });
}
