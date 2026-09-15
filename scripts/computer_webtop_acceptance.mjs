import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scopes = {
  complete: 'linux-webtop-browser-and-x11-ui',
  lifecycle: 'computer-stop-and-follow-up-ui',
  recovery: 'computer-isolation-fork-restart-ui',
};

export function summarizeWebtopQualification({ scenario, exitCode, manifest, hashes, evidence, cleanup }) {
  const failures = [];
  const require = (condition, reason) => { if (!condition) failures.push(reason); };
  require(exitCode === 0, 'test_process_failed');
  require(Boolean(scopes[scenario]) && evidence?.scope === scopes[scenario], 'scope_missing_or_mismatched');
  require(/^[a-f0-9]{40}$/u.test(manifest?.commit ?? '') && manifest?.gowork === 'off' && manifest?.host_input_used === false, 'build_identity_missing');
  for (const name of ['redeven', 'computer/manifest.json', '.redevplugin-release-artifacts-verified.json']) require(/^[a-f0-9]{64}$/u.test(hashes?.[name] ?? ''), 'artifact_hash_missing');
  for (const key of ['container_removed', 'source_state_unchanged', 'temporary_provider_state_removed', 'ports_released']) require(cleanup?.[key] === true, `cleanup_${key}_unverified`);
  require(cleanup?.secret_leak_found === false && cleanup?.host_input_used === false, 'privacy_boundary_unverified');
  const protocol = evidence?.protocol ?? [];
  require(protocol.length > 0 && protocol.every((entry) => entry.model === 'deepseek-v4-flash-vision-exp' && entry.httpStatus >= 200 && entry.httpStatus < 300), 'provider_qualification_failed');
  require(protocol.every((entry) => entry.streamStatus === 'complete' || entry.streamStatus === 'canceled'), 'provider_stream_unverified');
  require(protocol.some((entry) => entry.imageToolOutput), 'tool_result_image_unverified');
  if (scenario !== 'recovery') {
    const lifecycle = evidence?.lifecycleEvidence ?? [];
    for (const phase of ['takeover', 'navigation']) require(lifecycle.some((entry) => entry.phase === phase && entry.follow_up && entry.decoded_frame && entry.no_stop_notice && entry.no_automatic_replay), `lifecycle_${phase}_missing`);
  }
  if (scenario !== 'lifecycle') {
    const recovery = evidence?.recoveryEvidence ?? [];
    for (const name of ['cross-thread-media', 'fork', 'runtime-restart']) require(recovery.some((entry) => entry.scenario === name), `recovery_${name}_missing`);
  }
  if (scenario === 'complete') {
    require(evidence?.evidence?.length === 3 && evidence?.linuxEvidence?.turns?.length === 2, 'browser_or_x11_matrix_incomplete');
    const turns = [...(evidence?.evidence ?? []), ...(evidence?.linuxEvidence?.turns ?? [])];
    require(turns.length === 5 && turns.every((turn) => turn.frame?.blob && turn.frame?.visibleText === '' && turn.live?.decodedFrames >= 3 && turn.live?.distinctImages >= 2), 'decoded_live_pixels_unverified');
    require(evidence?.settingsToggle === 'on-off-on' && evidence?.disabledToolsAbsent && evidence?.reenabledVisualExecution, 'settings_unverified');
    require(evidence?.takeoverEvidence?.inputVerified && evidence?.takeoverEvidence?.nativeIME && evidence?.takeoverEvidence?.privateInputExcluded && evidence?.takeoverEvidence?.continued, 'private_takeover_unverified');
    require(evidence?.stageCloseHonoredAcrossTurn && evidence?.stageReopened, 'viewer_visibility_unverified');
  }
  return {
    scope: scopes[scenario] ?? 'unknown', passed: failures.length === 0, failures: [...new Set(failures)],
    commit: manifest?.commit, model: evidence?.model, provider_requests: protocol.length,
    cleanup_verified: Boolean(cleanup) && !failures.some((reason) => reason.startsWith('cleanup_') || reason === 'privacy_boundary_unverified'),
    does_not_qualify: ['macos-native-desktop', 'connected-chrome-extension', 'flower-control-plane', 'long-action-continuous-video', 'all-sensitive-pages-and-external-effect-approvals'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [report, scenario, status] = process.argv.slice(2);
  const read = (file) => readFile(path.join(report, file), 'utf8').then(JSON.parse).catch(() => undefined);
  const [manifest, hashes, evidence, cleanup] = await Promise.all(['manifest.json', 'build-hashes.json', 'computer/evidence.json', 'cleanup.json'].map(read));
  const summary = summarizeWebtopQualification({ scenario, exitCode: Number(status), manifest, hashes, evidence, cleanup });
  await writeFile(path.join(report, 'acceptance-summary.json'), JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
