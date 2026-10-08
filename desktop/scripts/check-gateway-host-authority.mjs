import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { GatewayClient } = require('../dist/main/gatewayClient.js');
const trust = require('../dist/main/gatewayTrust.js');
const { startRuntimePlacementBridgeSession } = require('../dist/main/runtimePlacementBridgeSession.js');
const { DefaultDesktopSSHTransportManager } = require('../dist/main/sshTransportManager.js');
const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-authority-'));
const output = path.join(root, 'desktop/dist/gateway-host-authority');
await mkdir(output, { recursive: true });
const marker = 'redeven-gateway-authority-' + randomUUID().slice(0, 8);
const image = marker + ':test';
const sshHost = marker + '-ssh';
const container = marker + '-container';
const nativeBinary = path.join(temp, 'gateway-native');
const linuxBinary = path.join(temp, 'gateway-linux');
const state = path.join(temp, 'native-state');
const secrets = new Map();
const secretStore = { readSecret: key => secrets.get(key) ?? '', writeSecret: (key, value) => secrets.set(key, value), deleteSecret: key => secrets.delete(key) };
const ssh = new DefaultDesktopSSHTransportManager();
const bridges = [];
const report = { status: 'running', marker, sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), nodeVersion: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), cases: [] };
const run = promisify(execFile);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 });
const originalPath = process.env.PATH;
let nativeStarted = false;
async function enroll(record, client, code) {
  const material = trust.createGatewayPairingMaterial(record);
  const request = code ? trust.pairingChallengeRequestWithCode(material, code) : trust.pairingChallengeRequest(material);
  const challenge = await client.pairingChallenge(record, { ...request, client_name: 'Qualification Desktop' });
  trust.assertGatewayPairingChallenge({ record, material, challenge });
  const proof = trust.buildPairingCompleteRequest(material, challenge);
  const complete = await client.completePairing(record, proof);
  trust.assertGatewayPairingCompleteResponse(material, challenge, complete);
  assert.deepEqual(complete.permissions, { access: true, manage_members: false, configure_cloud: false });
  assert.deepEqual(await client.completePairing(record, proof), complete, 'Lost completion response is retryable');
  return { ...record, trust_profile: await trust.completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }) };
}
try {
  docker('info');
  const arch = docker('version', '--format', '{{.Server.Arch}}').trim();
  for (const [goos, goarch, binary] of [[process.platform, process.arch === 'x64' ? 'amd64' : process.arch, nativeBinary], ['linux', arch, linuxBinary]]) {
    execFileSync(path.join(root, 'scripts/build_runtime_binary.sh'), ['--goos', goos, '--goarch', goarch, '--output', binary, '--command', './cmd/redeven-gateway', '--version', 'v0.0.0-dev', '--commit', report.commit, '--build-time', new Date().toISOString()], { cwd: root, stdio: 'inherit', timeout: 600000 });
  }
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(temp, 'key')]);
  await copyFile(path.join(temp, 'key.pub'), path.join(temp, 'authorized_keys'));
  await copyFile(path.join(root, 'desktop/scripts/fixtures/gateway-authority.Dockerfile'), path.join(temp, 'Dockerfile'));
  docker('build', '-t', image, temp);
  docker('run', '-d', '--name', container, '-v', linuxBinary + ':/gateway:ro', image, 'sleep', 'infinity');
  docker('run', '-d', '--name', sshHost, '-p', '127.0.0.1::22', '-p', '127.0.0.1::20000', '-v', linuxBinary + ':/gateway:ro', '-v', '/var/run/docker.sock:/var/run/docker.sock', image);
  const port = Number(docker('port', sshHost, '22/tcp').trim().split(':').at(-1));
  const adminPort = Number(docker('port', sshHost, '20000/tcp').trim().split(':').at(-1));
  const wrapper = path.join(temp, 'bin');
  await mkdir(wrapper);
  await writeFile(path.join(wrapper, 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -i "' + path.join(temp, 'key') + '" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="' + path.join(temp, 'known_hosts') + '" "$@"\n', { mode: 0o700 });
  process.env.PATH = wrapper + path.delimiter + originalPath;
  const nativeStatus = JSON.parse(execFileSync(nativeBinary, ['service-start', '--state-root', state, '--member-listen', '127.0.0.1:0'], { encoding: 'utf8' }));
  nativeStarted = true;
  docker('exec', container, '/gateway', 'service-start', '--state-root', '/root/gateway-state', '--member-listen', '127.0.0.1:0');
  docker('exec', sshHost, '/gateway', 'service-start', '--state-root', '/root/gateway-state', '--listen', '0.0.0.0:20000', '--member-listen', '127.0.0.1:0');
  const sshAccess = user => ({ kind: 'ssh_host', ssh: { ssh_destination: user + '@127.0.0.1', ssh_port: port, auth_mode: 'key_agent', connect_timeout_seconds: 10 } });
  const containerPlacement = { kind: 'container_process', runtime_root: '/root/gateway-state', container_engine: 'docker', container_id: container, container_ref: container, container_label: container, bridge_strategy: 'exec_stream' };
  const placements = [
    { name: 'local', host: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: state }, binary: nativeBinary, baseURL: 'http://' + nativeStatus.listen + '/' },
    { name: 'ssh', host: sshAccess('root'), placement: { kind: 'host_process', runtime_root: '/root/gateway-state' }, binary: '/gateway', baseURL: 'http://127.0.0.1:' + adminPort + '/' },
    { name: 'local-container', host: { kind: 'local_host' }, placement: containerPlacement, binary: '/gateway' },
    { name: 'ssh-container', host: sshAccess('root'), placement: containerPlacement, binary: '/gateway' },
  ];
  for (const placement of placements) {
    console.log('Checking Gateway host placement: ' + placement.name);
    const bridge = await startRuntimePlacementBridgeSession({ host_access: placement.host, placement: placement.placement, runtime_binary_path: placement.binary, bridge_command_kind: 'gateway', require_local_ui: false, ssh_transport_manager: ssh, ssh_credential_scope: marker });
    bridges.push(bridge);
    assert.equal(JSON.stringify(bridge.hello).includes('host_admin'), false);
    const client = new GatewayClient(secretStore, bridge);
    const hostCoordinates = { runtime_root: placement.placement.runtime_root, ...(placement.host.ssh ?? {}) };
    const containerCoordinates = placement.placement.kind === 'container_process'
      ? { container_engine: placement.placement.container_engine, container_id: placement.placement.container_id, container_ref: placement.placement.container_ref, container_label: placement.placement.container_label } : {};
    const connection = { kind: { local: 'local_host', ssh: 'ssh_host', 'local-container': 'local_container', 'ssh-container': 'ssh_container' }[placement.name], ...hostCoordinates, ...containerCoordinates };
    const invokeCLI = async args => {
      const command = placement.name === 'local' ? nativeBinary : 'docker';
      const commandArgs = placement.name === 'local' ? [...args, '--state-root', state]
        : ['exec', placement.name === 'ssh' ? sshHost : container, '/gateway', ...args, '--state-root', '/root/gateway-state'];
      return (await run(command, commandArgs, { encoding: 'utf8', timeout: 30000 })).stdout;
    };
    console.log('Checking host CLI authorization: ' + placement.name);
    assert.equal(JSON.parse(await invokeCLI(['clients', 'access-code'])).access_code.length > 0, true, 'Host CLI issues a ten-minute code');
    console.log('Checking signed host identity: ' + placement.name);
    const record = await enroll({ schema_version: 4, gateway_id: randomUUID(), display_name: placement.name, local_enabled: true, connection, created_at_ms: 1, updated_at_ms: 1 }, client);
    await client.verifyAddress(record);
    const catalog = await client.catalog(record);
    assert.deepEqual(catalog.gateway.permissions, { access: true, manage_members: true, configure_cloud: true });
    assert.equal((await client.listClients(record)).length, 0, 'Host management is not a revocable URL grant');
    if (placement.baseURL) {
      const code = await client.issueAccessCode(record);
      const persisted = placement.name === 'local' ? await readFile(path.join(state, 'gateway-trust.json'), 'utf8') : docker('exec', sshHost, 'cat', '/root/gateway-state/gateway-trust.json');
      assert.equal(persisted.includes(code.access_code), false, 'Access code persisted only as a digest');
      const urlClient = new GatewayClient(secretStore);
      const consumer = await enroll({ schema_version: 4, gateway_id: randomUUID(), display_name: 'URL consumer', local_enabled: true, connection: { kind: 'url', base_url: placement.baseURL, allow_loopback_http: true }, created_at_ms: 1, updated_at_ms: 1 }, urlClient, code.access_code);
      await urlClient.verifyAddress(consumer);
      assert.deepEqual((await urlClient.catalog(consumer)).gateway.permissions, { access: true, manage_members: false, configure_cloud: false });
      await assert.rejects(urlClient.listClients(consumer), { code: 'HOST_MANAGEMENT_REQUIRED' });
      const headers = await trust.createGatewayAuthHeaders({ record: consumer, method: 'POST', route: '/gateway/v5/clients/access-codes', body: { protocol_version: 'redeven-gateway-v5' }, secret_store: secretStore });
      const forbidden = await fetch(new URL('gateway/v5/clients/access-codes', placement.baseURL), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Redeven-Gateway-Transport': 'desktop_bridge' }, body: JSON.stringify({ protocol_version: 'redeven-gateway-v5' }) });
      assert.equal(forbidden.status, 403, 'Direct HTTP cannot bypass main-process management restriction');
      assert.equal((await client.listClients(record)).length, 1);
      assert.equal(JSON.parse(await invokeCLI(['clients', 'list'])).clients.length, 1, 'Host CLI lists the same authorized client');
      await client.revokeClient(record, consumer.trust_profile.paired_client_key_id);
      await assert.rejects(urlClient.catalog(consumer), { code: 'UNAUTHORIZED' });
      assert.equal((await client.listClients(record))[0].revoked_at_unix_ms > 0, true);
      assert.equal((await client.catalog(record)).gateway.permissions.manage_members, true);
      await invokeCLI(['clients', 'revoke', '--client', consumer.trust_profile.paired_client_key_id]);
      assert.equal((await client.listClients(record))[0].revoked_at_unix_ms > 0, true, 'Host CLI revocation is idempotent');
    }
    report.cases.push({ placement: placement.name, privateHostProof: true, identityRetained: true, consumerOnly: Boolean(placement.baseURL), revocation: Boolean(placement.baseURL) });
    await bridge.disconnect();
  }
  await assert.rejects(startRuntimePlacementBridgeSession({ host_access: sshAccess('visitor'), placement: { kind: 'host_process', runtime_root: '/root/gateway-state' }, runtime_binary_path: '/gateway', bridge_command_kind: 'gateway', require_local_ui: false, ssh_transport_manager: ssh, ssh_credential_scope: marker, signal: AbortSignal.timeout(15000) }));
  report.deniedUnprivilegedHost = true;

  report.status = 'passed';
  console.log('PASS real local/SSH/container/SSH-container host authority, URL access, revocation and denied host');
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally {
  for (const bridge of bridges) await bridge.disconnect().catch(() => {});
  await ssh.dispose();
  if (nativeStarted) { try { execFileSync(nativeBinary, ['service-stop', '--state-root', state], { stdio: 'ignore' }); } catch {} }
  for (const name of [sshHost, container]) { try { docker('rm', '-f', name); } catch {} }
  try { docker('rmi', image); } catch {}
  process.env.PATH = originalPath;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await rm(temp, { recursive: true, force: true });
}
