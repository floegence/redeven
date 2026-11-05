import assert from 'node:assert/strict';

export function parseComputerModelOutput(text) {
  try { return JSON.parse(text); } catch { /* Images append a separate carrier notice. */ }
  const split = text.indexOf('\nModel image: ');
  if (split < 0) return;
  const notices = text.slice(split + 1).split('\n');
  if (!notices.every(line => /^Model image: \d+x\d+; original: \d+x\d+; original_bytes=\d+ model_bytes=\d+\./u.test(line))) return;
  try { return JSON.parse(text.slice(0, split)); } catch { return; }
}

// Read the production tool outputs forwarded to the real provider. This
// observer cannot dispatch tools, alter the request, or produce model replies.
export function fileAnimationFacts(input) {
  const facts = [];
  for (const item of input ?? []) {
    if (item.type !== 'function_call_output') continue;
    const texts = typeof item.output === 'string' ? [item.output] : (item.output ?? []).filter(part => part.type === 'input_text' || part.type === 'text').map(part => part.text);
    for (const text of texts) {
      const payload = parseComputerModelOutput(text);
      if (payload?.status !== 'success' || !payload.data || typeof payload.data !== 'object') continue;
      const visit = value => {
        const indexed = Number.isInteger(value.current_observation_index) && value.current_observation_index >= 0 && Array.isArray(value.observations)
          ? value.observations[value.current_observation_index]?.observation : undefined;
        const observation = value.observation ?? indexed;
        if (value.completed === true && value.action_executed === true && value.completed_actions?.includes('click')) {
          facts.push({ call_id: item.call_id, target_id: value.target_id, completed: true, click_confirmed: true });
        }
        if (value.completed === true && observation?.document_id && observation.truncated === false && observation.output_truncated !== true && Array.isArray(observation.nodes)) {
          for (const state of ['paused', 'running']) {
            const nodes = observation.nodes;
            if (nodes.some(node => (node.canonical_role ?? node.role) === 'status' && node.name === `Animation ${state}`)) facts.push({ call_id: item.call_id, target_id: value.target_id, document_id: observation.document_id, completed: true, animation_state: state, action_executed: value.action_executed === true,
              image_observed: nodes.some(node => (node.canonical_role ?? node.role) === 'image' && node.name === 'Flower animation') });
          }
        }
      };
      visit(payload.data);
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

export function assertFileAnimationEvidence(protocol, model = 'deepseek-flash') {
  assert(protocol.length > 0, 'no real provider requests');
  assert(protocol.every(record => record.model === model), 'model changed');
  assert(protocol.every(record => record.httpStatus >= 200 && record.httpStatus < 300 && record.streamStatus === 'complete' && record.providerCompleted), 'provider request or stream failed');
  assert(protocol.some(record => record.imageToolOutput), 'real provider never received an image tool result');
  const calls = protocol.flatMap(record => record.calls ?? []);
  assert(!calls.some(call => /^terminal[_.]/u.test(call.tool)), 'acceptance may not use a terminal proxy or server');
  assert(calls.some(call => call.url_type === 'file:'), 'the model never navigated directly to file://');
  const facts = protocol.flatMap(record => record.animationFacts ?? []);
  assert(facts.some(fact => fact.image_observed), 'no canonical SVG image observation');
  const ordered = [...new Map(facts.map(fact => [`${fact.call_id}:${fact.animation_state ?? 'click'}`, fact])).values()];
  const paused = ordered.findIndex((fact, index) => fact.animation_state === 'paused' && fact.target_id && ordered.slice(0,index).some(prior => prior.click_confirmed && prior.target_id === fact.target_id));
  assert(paused >= 0, 'no confirmed click followed by a paused observation');
  const prior = ordered[paused];
  assert(ordered.slice(paused + 1).some((fact, index) => fact.animation_state === 'running' && fact.target_id === prior.target_id && fact.document_id === prior.document_id && ordered.slice(paused+1,paused+1+index).some(action => action.click_confirmed && action.target_id === prior.target_id)), 'no confirmed click followed by a running observation on the same document');
  return { calls, facts };
}
