import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Qualification only: real SSH, Docker exec, package installation and Gateway
// bridge. The daemon socket is used only for the named test target container.
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(desktop, '..');
const require = createRequire(import.meta.url);
const { GatewayLifecycleManager } = require('../dist/main/gatewayLifecycleManager.js');
const { RuntimeLifecycleCoordinator } = require('../dist/main/runtimeLifecycleCoordinator.js');
const { DefaultDesktopSSHTransportManager } = require('../dist/main/sshTransportManager.js');
const trust = require('../dist/main/gatewayTrust.js');
const state = await mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-hosts-'));
const output = path.join(desktop, 'dist/gateway-managed-hosts-acceptance');
await mkdir(output, { recursive: true });
const marker = randomUUID();
const image = `redeven-gateway-hosts:${marker}`;
const target = `redeven-gateway-target-${marker}`;
const sshHost = `redeven-gateway-ssh-${marker}`;
const containers = [];
const kinds = process.argv.slice(2);
assert.ok(kinds.every(kind => ['local_container', 'ssh_host', 'ssh_container'].includes(kind)), 'Unknown managed-host qualification kind');
const report = { status: 'running', cases: [], marker, state,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), containers };
const execute = (command, args, options = {}) => (execFileSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 60_000, ...options,
}) ?? '').trim();
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${code ?? signal}`)));
});
const ssh = new DefaultDesktopSSHTransportManager();
let lifecycle;
let activeRecord;
let imageBuilt = false;
try {
  await writeFile(path.join(state, 'Dockerfile'), `FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server docker.io ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
`);
  await run('docker', ['build', '-t', image, state]);
  imageBuilt = true;
  execute('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(state, 'client')]);
  execute('docker', ['run', '-d', '--name', target, '--label', `redeven.qualification=${marker}`, image, 'sleep', 'infinity']);
  containers.push(target);
  execute('docker', ['run', '-d', '--name', sshHost, '--label', `redeven.qualification=${marker}`,
    '-p', '127.0.0.1::22', '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
    '--mount', `type=bind,src=${path.join(state, 'client.pub')},dst=/fixture-client.pub,readonly`, image,
    'sh', '-eu', '-c', 'cp /fixture-client.pub /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys; exec /usr/sbin/sshd -D -e -o PermitRootLogin=prohibit-password -o PasswordAuthentication=no -o SetEnv=DOCKER_API_VERSION=1.44']);
  containers.push(sshHost);
  const port = Number(execute('docker', ['port', sshHost, '22/tcp']).split(':')[1]);
  const key = execute('docker', ['exec', sshHost, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub']);
  const knownHosts = path.join(state, 'known-hosts');
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${key}\n`, { mode: 0o600 });
  const wrapper = path.join(state, 'ssh');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(knownHosts)} -o IdentitiesOnly=yes -i ${quote(path.join(state, 'client'))} "$@"\n`);
  await chmod(wrapper, 0o700);
  const secrets = new Map();
  const secretStore = { readSecret: key => secrets.get(key) ?? '', writeSecret: (key, value) => secrets.set(key, value), deleteSecret: key => secrets.delete(key) };
  lifecycle = new GatewayLifecycleManager({
    ssh_transport_manager: { acquire: input => ssh.acquire({ ...input, sshBinary: wrapper }), dispose: () => ssh.dispose() },
    secret_store: secretStore, runtime_release_tag: 'v0.0.0-dev', release_base_url: '',
    source_runtime_root: root, target_commit: execute('git', ['rev-parse', '--short=12', 'HEAD']),
    asset_cache_root: path.join(state, 'cache'), temp_root: path.join(state, 'temp'), lifecycle_coordinator: new RuntimeLifecycleCoordinator(),
  });
  await mkdir(path.join(state, 'temp'));
  const containerID = execute('docker', ['inspect', '--format', '{{.Id}}', target]);
  const coordinates = { ssh_destination: 'root@127.0.0.1', ssh_port: port, auth_mode: 'key_agent', connect_timeout_seconds: 10 };
  const container = { container_engine: 'docker', container_id: containerID, container_ref: target, container_label: target };
  for (const connection of [
    { kind: 'local_container', ...container, runtime_root: 'remote_default' },
    { kind: 'ssh_host', ...coordinates, runtime_root: 'remote_default' },
    { kind: 'ssh_container', ...coordinates, ...container, runtime_root: '/tmp/custom-gateway' },
  ].filter(connection => kinds.length === 0 || kinds.includes(connection.kind))) {
    // Deliberately preserve a local registration ID unrelated to the wire ID,
    // as happens after editing a host, URL, container or data-root coordinate.
    let record = { schema_version: 4, gateway_id: `qualification-${connection.kind}`, display_name: connection.kind,
      local_enabled: true, connection, created_at_ms: 1, updated_at_ms: 1 };
    activeRecord = record;
    const initial = await lifecycle.inspectService(record);
    assert.equal(initial.can_start, true, JSON.stringify(initial));
    await assert.rejects(lifecycle.client(record, { startPolicy: 'require_ready' }), { name: 'GatewayServiceStartRequiredError' });
    const session = await lifecycle.startGateway(record);
    const material = trust.createGatewayPairingMaterial(record);
    const challenge = await session.client.pairingChallenge(record, trust.pairingChallengeRequest(material));
    trust.assertGatewayPairingChallenge({ record, material, challenge });
    const request = trust.buildPairingCompleteRequest(material, challenge, { access: true, manage_members: true, configure_cloud: true });
    const completion = await session.client.completePairing(record, request);
    trust.assertGatewayPairingCompleteResponse(material, challenge, completion, request.permissions);
    record = { ...record, trust_profile: await trust.completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }) };
    activeRecord = record;
    const catalog = await lifecycle.catalog(record);
    assert.deepEqual(catalog.gateway.permissions, request.permissions);
    assert.deepEqual(catalog.gateway.member_endpoints, []);
    await assert.rejects(session.client.invite(record));
    const endpoints = [{ endpoint_id: 'lan', address: 'https://localhost:7443', scope: 'lan', priority: 0 }];
    await session.client.updateEndpoints(record, endpoints);
    const invitation = await session.client.invite(record);
    assert.equal(invitation.protocol_version, 'redeven-gateway-v5');
    assert.equal(invitation.gateway_id, catalog.gateway.gateway_id);
    assert.deepEqual(invitation.endpoints, endpoints);
    assert.equal(invitation.expires_at_unix_ms - invitation.issued_at_unix_ms, 600_000);
    assert.equal(catalog.members.length, 0, 'Only a Runtime can complete membership');
    await session.client.updatePolicy(record, { ...catalog.policy, default_cloud_allowed: true });
    await lifecycle.restartGateway(record);
    const restored = await lifecycle.catalog(record);
    assert.equal(restored.policy.default_cloud_allowed, true);
    assert.equal(restored.gateway.gateway_id, invitation.gateway_id);
    assert.deepEqual(restored.gateway.member_endpoints, endpoints);
    await session.client.updateEndpoints(record, []);
    await lifecycle.restartGateway(record);
    assert.deepEqual((await lifecycle.catalog(record)).gateway.member_endpoints, []);
    await lifecycle.stopGateway(record);
    assert.equal((await lifecycle.inspectService(record)).status, 'not_started');
    await lifecycle.clear(record);
    activeRecord = undefined;
    report.cases.push(`${connection.kind}: empty state, explicit install/start, explicit permissions, signed invitation, policy restart persistence, stable identity, stop`);
    console.log(`PASS ${connection.kind}`);
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); report.failure = error.presentation; throw error;
} finally {
  const errors = [];
  if (activeRecord) await lifecycle?.clear(activeRecord).catch(error => errors.push(String(error)));
  await ssh.dispose().catch(error => errors.push(String(error)));
  for (const name of containers.reverse()) {
    try { execute('docker', ['rm', '-f', name]); } catch (error) { errors.push(String(error)); }
  }
  if (imageBuilt) {
    try { execute('docker', ['image', 'rm', image]); } catch (error) { errors.push(String(error)); }
  }
  await rm(state, { recursive: true, force: true });
  report.cleanup = { temporaryStateRemoved: true, errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(`Managed host qualification cleanup failed: ${errors.join('; ')}`);
}
