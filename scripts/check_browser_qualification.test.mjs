import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoTests, verifyBrowserTests, verifyNodeTests } from './check_browser_qualification.mjs';

test('package success cannot hide a skipped or missing required integration test', () => {
  const record = events => events.map(event => JSON.stringify(event)).join('\n');
  assert.throws(() => verifyGoTests(record([{ Action: 'pass', Package: 'fixture' }])));
  assert.throws(() => verifyGoTests(record([{ Action: 'skip', Test: 'Required' }, { Action: 'pass', Package: 'fixture' }])));
  assert.throws(() => verifyGoTests(record([{ Action: 'pass', Test: 'Other' }]), ['Required']));
  assert.equal(verifyGoTests(record([{ Action: 'pass', Test: 'Required' }]), ['Required']), 1);
});

test('Node reports cannot hide skipped, cancelled, zero or missing tests', () => {
  const summary = { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const render = values => Object.entries(values).map(([key, value]) => `# ${key} ${value}`).join('\n');
  assert.equal(verifyNodeTests(render(summary)), 2);
  for (const change of [{ tests: 0, pass: 0 }, { pass: 1 }, { fail: 1 }, { skipped: 1 }, { cancelled: 1 }, { todo: 1 }]) {
    assert.throws(() => verifyNodeTests(render({ ...summary, ...change })));
  }
  assert.throws(() => verifyNodeTests(''));
  assert.throws(() => verifyNodeTests(render(summary) + '\n# pass 2'));
});

test('browser reports require loaded files, passing assertions and zero skips', () => {
  const report = { success: true, numPassedTests: 1, numPendingTests: 0, numTodoTests: 0, numFailedTests: 0, testResults: [{ status: 'passed', assertionResults: [{}] }] };
  assert.equal(verifyBrowserTests(JSON.stringify(report)), 1);
  for (const change of [{ numPendingTests: 1 }, { numPassedTests: 0 }, { numFailedTests: 1 }, { testResults: [{ status: 'failed', assertionResults: [] }] }, { testResults: [] }]) {
    assert.throws(() => verifyBrowserTests(JSON.stringify({ ...report, ...change })));
  }
});
