/* global document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { evaluate, evaluationValue } from './computerBrowserEvaluation.mjs';
import { chromium } from 'playwright';
import { createComputerBrowserSource } from './computerBrowserSource.mjs';

class EvaluationFixture extends EventEmitter {
  installations = 0;
  failInstallation = true;
  installed = false;
  async send(method, args = {}) {
    if (method === 'Page.getFrameTree') return {frameTree:{frame:{id:'frame',loaderId:'loader',url:'https://fixture.invalid/'}}};
    if (method === 'Page.createIsolatedWorld') return {executionContextId:1};
    if (method === 'Runtime.evaluate') {
      if (args.expression.includes('const guard =')) {
        this.installations++;
        if (this.failInstallation) return {exceptionDetails:{text:'private installation text'}};
        this.installed = true;
        return {result:{type:'undefined'}};
      }
      if (!this.installed) return {exceptionDetails:{text:'private missing observer text'}};
      if (args.expression.endsWith('.begin()')) return {result:{type:'undefined'}};
      return {result:{type:args.expression === 'document.title'?'string':'object',value:args.expression === 'document.title'?'Fixture':[]}};
    }
    if (method === 'DOMSnapshot.captureSnapshot') return {documents:[],strings:[]};
    if (method === 'Accessibility.getFullAXTree') return {nodes:[]};
    return {};
  }
}

test('failed observer installation remains unprepared until the next explicit observation', async () => {
  const transport = new EvaluationFixture();
  const controller = new BrowserComputerController(transport);
  const request = {target_id:'fixture',tool_name:'computer.observe',args:{},full_access:true,script_operation:true};
  try {
    const failure = await controller.execute(request);
    assert.equal(failure.error, 'TARGET_OBSERVATION_UNAVAILABLE');
    assert.equal(failure.result.observation_stage, 'frame_inventory');
    assert.deepEqual(failure.result.diagnostic, {phase:'evaluation',method:'Runtime.evaluate',reason:'exception'});
    assert.equal(transport.installations, 1);
    assert.equal(controller.page.observedFrames.size, 0);
    assert.equal(JSON.stringify(failure).includes('private'), false);
    transport.failInstallation = false;
    const recovered = await controller.execute(request);
    assert.equal(recovered.error, undefined);
    assert.equal(transport.installations, 2);
    assert.equal(controller.page.observedFrames.size, 1);
  } finally { controller.page.releaseSession(transport); }
});

for (const method of ['Runtime.evaluate', 'Runtime.callFunctionOn']) {
  test(method + ' distinguishes empty data, missing results and execution exceptions', async () => {
    for (const value of ['', false, 0, [], null]) {
      assert.deepEqual(evaluationValue({result:{value}}, method), value);
    }
    assert.equal(evaluationValue({result:{type:'undefined'}}, method, value => value === undefined), undefined);
    for (const response of [undefined, null, [], {}, {result:null}, {result:{}}, {result:{type:'object'}}, {result:{type:'undefined'}}]) {
      assert.throws(() => evaluationValue(response, method), error => {
        assert.deepEqual(error.protocolDiagnostic, {phase:'evaluation',method,reason:'invalid_result'});
        return true;
      });
    }
    assert.throws(() => evaluationValue({result:{value:true},exceptionDetails:{text:'private'}}, method), error => {
      assert.deepEqual(error.protocolDiagnostic, {phase:'evaluation',method,reason:'exception'});
      assert.equal(error.message, 'TARGET_OBSERVATION_UNAVAILABLE');
      return true;
    });
    let calls = 0;
    const rejection = Object.assign(new Error('transport failure'), {protocolDiagnostic:{phase:'protocol',method,code:-32000}});
    await assert.rejects(evaluate({send:async () => { calls++; throw rejection; }}, method, {}), error => error === rejection);
    assert.equal(calls, 1);
  });
}

test('document invalidation during successful installation cannot publish readiness', async () => {
  const transport = new EvaluationFixture();
  transport.failInstallation = false;
  const controller = new BrowserComputerController(transport);
  const send = transport.send.bind(transport);
  transport.send = async (method, args) => {
    const result = await send(method, args);
    if (method === 'Runtime.evaluate' && args.expression.includes('const guard =')) controller.page.invalidate();
    return result;
  };
  try {
    await assert.rejects(controller.page.frames(), /OBSERVATION_INVALIDATED/);
    assert.equal(controller.page.observedFrames.size, 0);
    assert.equal(transport.installations, 1);
  } finally { controller.page.releaseSession(transport); }
});

test('malformed installation responses never publish readiness or retry internally', async () => {
  for (const response of [null, {}, {result:{}}, {result:{value:true}}]) {
    const transport = new EvaluationFixture();
    const controller = new BrowserComputerController(transport);
    const send = transport.send.bind(transport);
    let attempts = 0;
    transport.send = async (method, args) => {
      if (method === 'Runtime.evaluate' && args.expression.includes('const guard =')) { attempts++; return response; }
      return send(method, args);
    };
    try {
      const result = await controller.execute({target_id:'fixture',tool_name:'computer.observe',args:{},full_access:true,script_operation:true});
      assert.equal(result.error, 'TARGET_OBSERVATION_UNAVAILABLE');
      assert.deepEqual(result.result.diagnostic, {phase:'evaluation',method:'Runtime.evaluate',reason:'invalid_result'});
      assert.equal(controller.page.observedFrames.size, 0);
      assert.equal(attempts, 1);
    } finally { controller.page.releaseSession(transport); }
  }
});

test('real browser evaluation failures retain facts, never input and allow explicit recovery', async () => {
  const browser = await chromium.launch({headless:true});
  let owner;
  try {
    const page = await browser.newPage();
    await page.setContent('<input aria-label="Plain search"><input type="search" aria-label="Native search"><input role="combobox" aria-label="Suggested search"><section aria-label="Report">Confirmed</section><button>Save</button>');
    owner = await createComputerBrowserSource(page, 'fixture');
    const controller = owner.controller;
    const run = (tool_name, args = {}) => controller.execute({target_id:'fixture',tool_name,args,full_access:true,script_operation:true});
    const initial = await run('computer.observe');
    assert.equal(initial.error, undefined);
    for (const [name, role] of [['Plain search','textbox'],['Native search','searchbox'],['Suggested search','combobox']]) {
      assert.equal(initial.result.observation.nodes.find(node => node.name === name)?.role, role);
    }
    const send = controller.transport.send.bind(controller.transport);
    const cases = [
      {stage:'safety_scan',method:'Runtime.evaluate',match:p=>p.expression?.includes('secretChanged()'),tool:'computer.observe'},
      {stage:'semantic_read',method:'Runtime.callFunctionOn',match:p=>p.functionDeclaration?.includes('rendered_element'),tool:'computer.action',args:{action:'text',selector:{role:'region',name:'Report'}}},
      {stage:'capture',method:'Runtime.evaluate',match:p=>p.expression?.includes('innerWidth-document'),tool:'computer.screenshot'},
      {stage:'metadata',method:'Runtime.evaluate',match:p=>p.expression==='document.title',tool:'computer.observe'},
    ];
    for (const item of cases) for (const reason of ['exception','invalid_result']) {
      let injections = 0, inputs = 0;
      controller.transport.send = async (method, parameters = {}) => {
        if (method.startsWith('Input.')) inputs++;
        if (method === item.method && item.match(parameters)) {
          injections++;
          return reason === 'exception' ? {exceptionDetails:{text:'private exception',exception:{description:'private stack'}}} : {result:{}};
        }
        return send(method, parameters);
      };
      const failure = await run(item.tool, item.args);
      assert.equal(failure.error, 'TARGET_OBSERVATION_UNAVAILABLE');
      assert.equal(failure.result.observation_stage, item.stage);
      assert.deepEqual(failure.result.diagnostic, {phase:'evaluation',method:item.method,reason});
      assert.equal(failure.result.action_executed, false);
      assert.equal(failure.screenshot, undefined);
      assert.equal(JSON.stringify(failure).includes('private'), false);
      assert.equal(injections, 1);
      assert.equal(inputs, 0);
      controller.transport.send = send;
      assert.equal((await run('computer.observe')).error, undefined);
    }
    // An acknowledged input remains a fact even if its evaluation response
    // reports an exception. Inspect it explicitly; never dispatch it twice.
    let edits = 0;
    controller.transport.send = async (method, parameters = {}) => {
      const result = await send(method, parameters);
      if (method === 'Runtime.callFunctionOn' && parameters.functionDeclaration?.includes('execCommand')) {
        edits++;
        return {exceptionDetails:{text:'private post-input exception'}};
      }
      return result;
    };
    const edited = await run('computer.action', {action:'fill',selector:{role:'textbox',name:'Plain search'},text:'Confirmed edit'});
    assert.equal(edited.error, 'TARGET_OBSERVATION_UNAVAILABLE');
    assert.equal(edited.result.action_executed, true);
    assert.deepEqual(edited.result.diagnostic, {phase:'evaluation',method:'Runtime.callFunctionOn',reason:'exception'});
    assert.equal(edits, 1);
    assert.equal(await page.getByRole('textbox',{name:'Plain search',exact:true}).inputValue(), 'Confirmed edit');
    controller.transport.send = send;
    assert.equal((await run('computer.observe')).error, undefined);
    // Privacy evidence still takes precedence over an unavailable scan.
    await page.locator('body').evaluate(body => { const input = document.createElement('input'); input.type = 'password'; body.append(input); });
    controller.transport.send = async (method, parameters = {}) => {
      if (method === 'Runtime.evaluate' && parameters.expression?.includes('secretChanged()')) return {exceptionDetails:{text:'private'}};
      return send(method, parameters);
    };
    const paused = await run('computer.observe');
    assert.equal(paused.safety.level, 'takeover');
    assert.equal(paused.result.observation, undefined);
    assert.equal(paused.result.diagnostic, undefined);
  } finally { await owner?.dispose(); await browser.close(); }
});
