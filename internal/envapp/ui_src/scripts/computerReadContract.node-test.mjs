import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserComputerController } from './computerBrowserController.mjs';

const reads = ['read', 'text', 'query', 'table', 'attribute', 'wait'];
const safe = { level: 'routine', safe_to_capture: true, safe_to_send_to_model: true };
function fixture(action) {
  let calls = 0, closes = 0, releases = 0;
  const controller = new BrowserComputerController({ send: async () => ({ frameTree: { frame: { url: 'https://fixture.test' } } }) });
  const page = controller.page;
  Object.assign(page, {
    beginObservation: async () => ({}), safety: async () => safe,
    inFrame: async () => 'Fixture', releaseInput: async () => { releases++; },
    close: () => { closes++; },
    action: async () => { calls++; return action(page, calls); },
  });
  const run = operation => controller.execute({ target_id: 'fixture', tool_name: 'computer.action', script_operation: true,
    args: { action: operation, selector: { role: 'button', name: 'Fixture' }, ...(operation === 'attribute' ? { attribute: 'title' } : {}) } });
  return { run, facts: () => ({ calls, closes, releases }) };
}

for (const operation of reads) {
  test(operation + ' keeps a complete failure contract and permits a later fresh read', async () => {
    let failing = true;
    const f = fixture(() => { if (failing) throw new Error('TARGET_OBSERVATION_UNAVAILABLE'); return { verified: true }; });
    assert.deepEqual(await f.run(operation), { error: 'TARGET_OBSERVATION_UNAVAILABLE', result: {
      action_executed: false, needs_observation: true, observation_stage: 'semantic_read',
    } });
    assert.deepEqual(f.facts(), { calls: 1, closes: 0, releases: 1 });
    failing = false;
    const recovered = await f.run(operation);
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.result.verified, true);
    assert.equal(f.facts().closes, 0);
  });
  test(operation + ' sanitizes unexpected read failures at the same boundary', async () => {
    const f = fixture(() => { throw new Error('private debugger content'); });
    const result = await f.run(operation);
    assert.equal(result.error, 'TARGET_OBSERVATION_UNAVAILABLE');
    assert.equal(result.result.observation_stage, 'semantic_read');
    assert.equal(JSON.stringify(result).includes('private debugger content'), false);
    assert.equal(f.facts().closes, 0);
    assert.equal(f.facts().calls, 1);
  });
  test(operation + ' rejects stale input without retry and stops an invalidated observation', async () => {
    const rejected = fixture(() => { throw new Error('STALE_REFERENCE'); });
    assert.equal((await rejected.run(operation)).error, 'STALE_REFERENCE');
    assert.equal(rejected.facts().calls, 1);
    const invalidated = fixture(page => { page.revision++; return { invalid: true }; });
    const result = await invalidated.run(operation);
    assert.equal(result.result.observation_invalidated, true);
    assert.equal(result.safety.safe_to_send_to_model, false);
    assert.equal(result.result.invalid, undefined);
    assert.equal(invalidated.facts().calls, 1);
  });
}

test('the read boundary never retries a mutating action', async () => {
  const f = fixture(() => { throw new Error('action failed'); });
  assert.equal((await f.run('click')).error, 'TARGET_ACTION_FAILED');
  assert.equal(f.facts().calls, 1);
});
