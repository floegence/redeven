import assert from 'node:assert/strict';

// Read the production tool outputs forwarded to the real provider. This
// observer cannot dispatch tools, alter the request, or produce model replies.
export function fileAnimationFacts(input) {
  const facts = [];
  for (const item of input ?? []) {
    if (item.type !== 'function_call_output') continue;
    const texts = typeof item.output === 'string' ? [item.output] : (item.output ?? []).filter(part => part.type === 'input_text' || part.type === 'text').map(part => part.text);
    for (const text of texts) {
      let payload;
      try { payload = JSON.parse(text); } catch { continue; }
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (value.completed === true && value.observation?.semantic_schema_version === 2 && value.observation.document_id && value.observation.truncated === false) {
          for (const state of ['paused', 'running']) {
            const nodes = value.observation.nodes ?? [];
            if (nodes.some(node => node.canonical_role === 'status' && node.name === `Animation ${state}`)) facts.push({ call_id: item.call_id, completed: true, animation_state: state, action_executed: value.action_executed === true,
              image_observed: nodes.some(node => node.canonical_role === 'image' && node.name === 'Flower animation') });
          }
        }
        for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
      };
      visit(payload);
    }
  }
  return facts;
}

export function providerStreamCompleted(text) {
  return text.split(/\r?\n/u).some(line => {
    if (!line.startsWith('data:')) return false;
    try { const event = JSON.parse(line.slice(5).trim()); return event.type === 'response.completed' && event.response?.status === 'completed'; }
    catch { return false; }
  });
}

export function assertFileAnimationEvidence(protocol) {
  assert(protocol.length > 0, 'no real provider requests');
  assert(protocol.every(record => record.model === 'deepseek-v4-flash'), 'model changed');
  assert(protocol.every(record => record.httpStatus >= 200 && record.httpStatus < 300 && record.streamStatus === 'complete' && record.providerCompleted), 'provider request or stream failed');
  assert(protocol.some(record => record.imageToolOutput), 'real provider never received an image tool result');
  const calls = protocol.flatMap(record => record.calls ?? []);
  assert(!calls.some(call => /^terminal[_.]/u.test(call.tool)), 'acceptance may not use a terminal proxy or server');
  assert(calls.some(call => call.url_type === 'file:'), 'the model never navigated directly to file://');
  const facts = protocol.flatMap(record => record.animationFacts ?? []);
  assert(facts.some(fact => fact.image_observed), 'no canonical SVG image observation');
  for (const state of ['paused', 'running']) assert(facts.some(fact => fact.completed && fact.animation_state === state && fact.action_executed), `no structured completed ${state} fact`);
  return { calls, facts };
}
