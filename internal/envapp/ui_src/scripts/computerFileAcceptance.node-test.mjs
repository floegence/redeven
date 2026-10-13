import assert from 'node:assert/strict';
import test from 'node:test';
import { fileAnimationFacts, assertFileAnimationEvidence, providerStreamCompleted } from './computerFileAcceptance.mjs';

test('acceptance requires structured completed facts and a real successful provider stream', () => {
  const makeOutput = (state, completed = true) => ({ type: 'function_call_output', call_id: state,
    output: JSON.stringify({ result: { completed, action_executed: true, observation: { semantic_schema_version: 2, document_id: 'document:1', truncated: false, nodes: [{ canonical_role: 'status', name: `Animation ${state}` }, { canonical_role: 'image', name: 'Flower animation' }] } } }) });
  const facts = fileAnimationFacts([makeOutput('paused'), makeOutput('running')]);
  assert.equal(facts.length, 2);
  assert.equal(fileAnimationFacts([makeOutput('paused', false)]).length, 0);
  const record = { model: 'deepseek-v4-flash', httpStatus: 200, streamStatus: 'complete', providerCompleted: true,
    imageToolOutput: true, animationFacts: facts, calls: [{ tool: 'computer_exec', url_type: 'file:' }] };
  assertFileAnimationEvidence([record]);
  for (const change of [{ model: 'fixture' }, { httpStatus: 500 }, { streamStatus: 'interrupted' }, { providerCompleted: false },
    { imageToolOutput: false }, { animationFacts: facts.slice(0,1) }, { calls: [{ tool: 'terminal_exec', url_type: 'file:' }] }]) {
    assert.throws(() => assertFileAnimationEvidence([{ ...record, ...change }]));
  }
});

test('stream completion requires a typed completed response event', () => {
  assert(providerStreamCompleted('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
  for (const text of ['data: [DONE]', 'data: {"type":"response.failed"}', 'data: {"type":"response.output_text.delta","delta":"response.completed"}']) assert.equal(providerStreamCompleted(text), false);
});
