import assert from 'node:assert/strict';
import test from 'node:test';
import { fileAnimationFacts, assertFileAnimationEvidence, providerStreamCompleted, parseComputerModelOutput } from './computerFileAcceptance.mjs';

test('acceptance requires structured completed facts and a real successful provider stream', () => {
  const makeOutput = (state, completed = true) => ({ type: 'function_call_output', call_id: state,
    output: JSON.stringify({ status:'success', data: { target_id: 'fixture', completed, action_executed: true, observation: { document_id: 'document:1', truncated: false, nodes: [{ role: 'status', name: `Animation ${state}` }, { role: 'image', name: 'Flower animation' }] } } }) });
  const facts = fileAnimationFacts([makeOutput('paused'), makeOutput('running')]);
  assert.equal(facts.length, 2);
  assert.equal(fileAnimationFacts([makeOutput('paused', false)]).length, 0);
  const withImage = makeOutput('paused');
  withImage.output += '\nModel image: 756x469; original: 756x469; original_bytes=17229 model_bytes=12000. Original-backed crops use original coordinates.';
  assert.equal(fileAnimationFacts([withImage]).length, 1);
  assert.equal(parseComputerModelOutput('{"data":{}}\nunrecognized trailer'), undefined);
  const truncated = JSON.parse(makeOutput('paused').output); truncated.data.observation.output_truncated = true;
  assert.equal(fileAnimationFacts([{ type: 'function_call_output', output: JSON.stringify(truncated) }]).length, 0);
  const indexed = JSON.parse(makeOutput('paused').output);
  indexed.data.observations = [{ observation: indexed.data.observation }];
  delete indexed.data.observation;
  indexed.data.current_observation_index = 0;
  assert.equal(fileAnimationFacts([{ type: 'function_call_output', output: JSON.stringify(indexed) }]).length, 1);
  indexed.data.current_observation_index = 1;
  assert.equal(fileAnimationFacts([{ type: 'function_call_output', output: JSON.stringify(indexed) }]).length, 0);
  const spoof = {status:'success',data:{logs:[JSON.parse(makeOutput('paused').output).data]}};
  assert.equal(fileAnimationFacts([{type:'function_call_output',output:JSON.stringify(spoof)}]).length,0);
  const record = { model: 'deepseek-flash', httpStatus: 200, streamStatus: 'complete', providerCompleted: true,
    imageToolOutput: true, animationFacts: [{call_id:'pause',target_id:'fixture',completed:true,click_confirmed:true}, ...facts.slice(0,1), {call_id:'resume',target_id:'fixture',completed:true,click_confirmed:true}, ...facts.slice(1)], calls: [{ tool: 'computer_exec', url_type: 'file:' }] };
  assertFileAnimationEvidence([record]);
  for (const change of [{ model: 'fixture' }, { httpStatus: 500 }, { streamStatus: 'interrupted' }, { providerCompleted: false },
    { imageToolOutput: false }, { animationFacts: facts.slice(0,1) }, { calls: [{ tool: 'terminal_exec', url_type: 'file:' }] }]) {
    assert.throws(() => assertFileAnimationEvidence([{ ...record, ...change }]));
  }
  assert.throws(() => assertFileAnimationEvidence([{...record,animationFacts:record.animationFacts.filter(fact=>!fact.click_confirmed)}]));
  assert.throws(() => assertFileAnimationEvidence([{...record,animationFacts:record.animationFacts.map(fact=>fact.animation_state==='running'?{...fact,document_id:'another'}:fact)}]));
});

test('stream completion requires a typed completed response event', () => {
  assert(providerStreamCompleted('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
  for (const text of ['data: [DONE]', 'data: {"type":"response.failed"}', 'data: {"type":"response.output_text.delta","delta":"response.completed"}']) assert.equal(providerStreamCompleted(text), false);
});
