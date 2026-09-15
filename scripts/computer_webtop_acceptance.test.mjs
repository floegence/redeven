import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeWebtopQualification } from './computer_webtop_acceptance.mjs';

function result() {
  return { scenario: 'lifecycle', exitCode: 0,
    manifest: { commit: 'a'.repeat(40), gowork: 'off', host_input_used: false },
    hashes: Object.fromEntries(['redeven', 'computer/manifest.json', '.redevplugin-release-artifacts-verified.json'].map((name) => [name, 'b'.repeat(64)])),
    evidence: { scope: 'computer-stop-and-follow-up-ui', model: 'deepseek-v4-flash-vision-exp',
      protocol: [{ model: 'deepseek-v4-flash-vision-exp', httpStatus: 200, streamStatus: 'complete', imageToolOutput: true }],
      lifecycleEvidence: ['takeover', 'navigation'].map((phase) => ({ phase, follow_up: true, decoded_frame: true, no_stop_notice: true, no_automatic_replay: true })) },
    cleanup: { container_removed: true, source_state_unchanged: true, temporary_provider_state_removed: true, ports_released: true, secret_leak_found: false, host_input_used: false },
  };
}

test('accepts only the recorded focused scope after cleanup', () => {
  const summary = summarizeWebtopQualification(result());
  assert.equal(summary.passed, true);
  assert.equal(summary.scope, 'computer-stop-and-follow-up-ui');
  assert.equal(summary.cleanup_verified, true);
  assert(summary.does_not_qualify.length > 0);
});

for (const [name, change] of [
  ['failed process with earlier successful evidence', (value) => { value.exitCode = 1; }],
  ['missing cleanup', (value) => { delete value.cleanup; }],
  ['retained container', (value) => { value.cleanup.container_removed = false; }],
  ['occupied port', (value) => { value.cleanup.ports_released = false; }],
  ['private evidence', (value) => { value.cleanup.secret_leak_found = true; }],
  ['host input', (value) => { value.manifest.host_input_used = true; }],
  ['unidentified binary', (value) => { delete value.hashes.redeven; }],
  ['provider 400', (value) => { value.evidence.protocol[0].httpStatus = 400; }],
  ['provider stream interrupted after 200', (value) => { value.evidence.protocol[0].streamStatus = 'interrupted'; }],
  ['missing follow-up', (value) => { value.evidence.lifecycleEvidence[1].follow_up = false; }],
  ['focused report relabeled as complete', (value) => { value.scenario = 'complete'; }],
]) test(`rejects ${name}`, () => {
  const value = result(); change(value);
  assert.equal(summarizeWebtopQualification(value).passed, false);
});
