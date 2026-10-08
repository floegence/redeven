import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(desktop, '..');
const require = createRequire(import.meta.url);
const { GatewayLifecycleManager } = require('../dist/main/gatewayLifecycleManager.js');
const { RuntimeLifecycleCoordinator } = require('../dist/main/runtimeLifecycleCoordinator.js');
const { DefaultDesktopSSHTransportManager } = require('../dist/main/sshTransportManager.js');
const { probeManagedGatewayServiceDeep } = require('../dist/main/gatewayServiceHost.js');
const trust = require('../dist/main/gatewayTrust.js');
const state = await mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-local-update-'));
const output = path.join(desktop, 'dist/gateway-local-update');
await mkdir(output, { recursive: true });
const marker = randomUUID();
const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const secrets = new Map();
const secretStore = { readSecret: key => secrets.get(key) ?? '', writeSecret: (key, value) => secrets.set(key, value), deleteSecret: key => secrets.delete(key) };
const ssh = new DefaultDesktopSSHTransportManager();
const sessionCache = new Map();
const options = {
  ssh_transport_manager: ssh, secret_store: secretStore, runtime_release_tag: 'v0.0.0-dev',
  release_base_url: '', cloud_origin: '', source_runtime_root: root, target_commit: commit,
  asset_cache_root: path.join(state, 'cache'), temp_root: path.join(state, 'temp'),
  lifecycle_coordinator: new RuntimeLifecycleCoordinator(), session_cache: sessionCache,
};
await mkdir(options.temp_root);
const lifecycle = new GatewayLifecycleManager(options);
let record = { schema_version: 4, gateway_id: marker, display_name: 'Local update qualification',
  local_enabled: true, connection: { kind: 'local_host', runtime_root: state }, created_at_ms: 1, updated_at_ms: 1 };
const stateRoot = path.join(state, 'gateways', record.gateway_id, 'state');
const seedBinary = path.join(state, 'seed-gateway');
const probe = () => probeManagedGatewayServiceDeep({
  hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: state },
  sshTransportManager: ssh, sshCredentialScope: marker, stateRoot,
  releaseTag: options.runtime_release_tag, targetCommit: commit, releaseBaseURL: '',
  assetCacheRoot: options.asset_cache_root, tempRoot: options.temp_root,
});
const report = { status: 'running', marker, commit, state, stateRoot, cases: [] };
try {
  execFileSync(path.join(root, 'scripts/build_runtime_binary.sh'), [
    '--goos', process.platform, '--goarch', process.arch === 'x64' ? 'amd64' : process.arch,
    '--output', seedBinary, '--command', './cmd/redeven-gateway', '--version', options.runtime_release_tag,
    '--commit', commit, '--build-time', new Date().toISOString(),
  ], { cwd: root, stdio: 'inherit', timeout: 600_000 });
  const seed = JSON.parse(execFileSync(seedBinary, ['service-start', '--state-root', stateRoot, '--member-listen', '127.0.0.1:0'], { encoding: 'utf8' }));
  report.seed = { pid: seed.pid, listen: seed.listen, memberListen: seed.member_listen };
  execFileSync(seedBinary, ['service-stop', '--state-root', stateRoot], { stdio: 'ignore' });
  assert.equal((await lifecycle.inspectService(record)).can_start, true);
  const session = await lifecycle.startGateway(record);
  const material = trust.createGatewayPairingMaterial(record);
  const challenge = await session.client.pairingChallenge(record, trust.pairingChallengeRequest(material));
  trust.assertGatewayPairingChallenge({ record, material, challenge });
  const request = trust.buildPairingCompleteRequest(material, challenge);
  const completion = await session.client.completePairing(record, request);
  trust.assertGatewayPairingCompleteResponse(material, challenge, completion);
  record = { ...record, trust_profile: await trust.completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }) };
  const endpoints = [{ endpoint_id: 'lan', address: 'https://localhost:7443', scope: 'lan', priority: 0 }];
  await session.client.updateEndpoints(record, endpoints);
  const catalog = await lifecycle.catalog(record);
  const before = await probe();
  assert.equal(before.service_status, 'running');
  assert.equal(before.commit, commit);
  report.initial = { pid: before.service_pid, listen: before.service_listen, commit: before.commit };
  for (const action of ['updateGateway', 'restartGateway']) {
    const failing = new GatewayLifecycleManager({ ...options, source_runtime_root: path.join(state, 'missing-source'), target_commit: 'unavailable-source' });
    const phases = [];
    await assert.rejects(failing[action](record, { onProgress: event => phases.push(event.phase) }));
    assert.ok(phases.includes('preparing_gateway_package'));
    assert.ok(!phases.includes('stopping_gateway'));
    assert.equal((await probe()).service_pid, before.service_pid);
    assert.equal((await lifecycle.catalog(record)).gateway.gateway_id, catalog.gateway.gateway_id);
    assert.equal((await lifecycle.client(record)), session.client, 'Existing Desktop bridge survives package failure');
    report.cases.push({ action, packageFailurePreservesServiceAndBridge: true, phases });
  }
  const phases = [];
  await lifecycle.updateGateway(record, { onProgress: event => phases.push(event.phase) });
  assert.ok(phases.indexOf('preparing_gateway_package') < phases.indexOf('stopping_gateway'));
  const updated = await probe();
  assert.equal(updated.service_status, 'running');
  assert.equal(updated.package_status, 'ready');
  assert.notEqual(updated.service_pid, before.service_pid);
  assert.equal(updated.commit, commit);
  let restored = await lifecycle.catalog(record);
  assert.equal(restored.gateway.gateway_id, catalog.gateway.gateway_id);
  assert.deepEqual(restored.gateway.permissions, { access: true, manage_members: true, configure_cloud: true });
  assert.deepEqual(restored.gateway.member_endpoints, endpoints);
  report.cases.push({ updatePassed: true, identityAndPermissionsPreserved: true, pid: updated.service_pid, phases });
  const restartPhases = [];
  await lifecycle.restartGateway(record, { onProgress: event => restartPhases.push(event.phase) });
  assert.ok(!restartPhases.includes('preparing_gateway_package'), 'Matching package is not rebuilt for restart');
  restored = await lifecycle.catalog(record);
  assert.equal(restored.gateway.gateway_id, catalog.gateway.gateway_id);
  assert.deepEqual(restored.gateway.member_endpoints, endpoints);
  const invitation = await (await lifecycle.client(record)).invite(record);
  assert.equal(invitation.gateway_id, catalog.gateway.gateway_id);
  assert.deepEqual(invitation.endpoints, endpoints);
  report.cases.push({ restartPassed: true, invitationPassed: true, noCloudRequired: true, phases: restartPhases });
  report.status = 'passed';
  console.log('PASS real local Gateway update, restart, identity preservation and failed-package service retention');
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error); report.failure = error.presentation;
  throw error;
} finally {
  const errors = [];
  await lifecycle.stopGateway(record).catch(error => errors.push(String(error)));
  await lifecycle.clear(record).catch(error => errors.push(String(error)));
  await ssh.dispose().catch(error => errors.push(String(error)));
  try { execFileSync(seedBinary, ['service-stop', '--state-root', stateRoot], { stdio: 'ignore' }); }
  catch (error) { errors.push(String(error)); }
  const stopped = await probe().catch(error => { errors.push(String(error)); return undefined; });
  if (stopped?.service_status === 'running') errors.push('Owned Gateway did not stop');
  if (!errors.length) await rm(state, { recursive: true, force: true });
  report.cleanup = { temporaryStateRemoved: errors.length === 0, errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(`Local Gateway update cleanup failed: ${errors.join('; ')}`);
}
