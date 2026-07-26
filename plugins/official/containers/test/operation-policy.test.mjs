import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/operation-policy.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  write: false,
});
const moduleURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
const { cancellationFailurePolicy, mutationOutcome, submissionFailurePolicy } = await import(moduleURL);

test('only a proven not-committed submission may be retried', () => {
  assert.deepEqual(submissionFailurePolicy('not_committed'), { retryAllowed: true, phase: 'finished' });
  for (const outcome of ['committed', 'unknown', undefined]) {
    assert.deepEqual(submissionFailurePolicy(outcome), { retryAllowed: false, phase: 'submission_unknown' });
  }
});

test('an uncertain cancellation remains locked while terminal observation continues', () => {
  for (const outcome of ['committed', 'unknown', undefined]) {
    const policy = cancellationFailurePolicy(outcome);
    assert.equal(policy.retryAllowed, false);
    assert.equal(policy.phase, 'cancel_outcome_unknown');
  }
  assert.equal(cancellationFailurePolicy('not_committed').retryAllowed, true);
});

test('reads mutation outcomes without trusting unrelated values', () => {
  assert.equal(mutationOutcome({ mutationOutcome: 'unknown' }), 'unknown');
  assert.equal(mutationOutcome({ mutationOutcome: 'successful' }), undefined);
  assert.equal(mutationOutcome(new Error('network')), undefined);
});
