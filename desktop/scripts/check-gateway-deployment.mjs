import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const output = path.join(desktop, 'dist/gateway-deployment-acceptance');
const name = `redeven-gateway-qualification-${randomUUID()}`;
const image = 'debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241';
const state = await mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-deployment-'));
await chmod(state, 0o700);
await mkdir(output, { recursive: true });
await rm(path.join(output, 'report.json'), { force: true });
const active = new Set();
const execute = (command, args, options = {}) => (execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000, ...options }) ?? '').trim();
const run = async (command, args, log, env = {}) => {
  const stream = createWriteStream(path.join(output, log));
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  active.add(child);
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal}); see ${log}`)));
    });
  } finally { active.delete(child); stream.end(); }
};
const waitFor = async (description, check, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
};
const tcp = (host, port) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
});
let nginx;
let networkCreated = false;
let containerCreated = false;
let completed = false;
let canceled = false;
const interrupted = () => { canceled = true; for (const child of active) child.kill('SIGTERM'); process.exitCode = 1; };
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
try {
  execute(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
  const daemonArchitecture = execute('docker', ['info', '--format', '{{.Architecture}}']);
  const architecture = ({ aarch64: 'arm64', arm64: 'arm64', x86_64: 'amd64', amd64: 'amd64' })[daemonArchitecture];
  assert.ok(architecture, 'qualification supports the released Linux amd64 and arm64 targets');
  const nginxInfo = spawnSync('nginx', ['-v'], { encoding: 'utf8' });
  assert.equal(nginxInfo.status, 0, 'Nginx must be installed');
  const nginxVersion = nginxInfo.stderr.trim();
  execute('openssl', ['version']);
  for (const component of ['envapp', 'codeapp']) await access(path.join(root, `internal/${component}/ui/dist`));
  console.log('Building production Runtime/Gateway handler fixture for the isolated container');
  await run('go', ['test', '-c', './internal/localui', '-o', path.join(state, 'localui.test')], 'build.log', {
    GOWORK: 'off', GOOS: 'linux', GOARCH: architecture, CGO_ENABLED: '0',
  });
  try { execute('docker', ['image', 'inspect', image], { stdio: 'ignore' }); }
  catch { await run('docker', ['pull', image], 'image-pull.log'); }
  execute('docker', ['network', 'create', '--label', `redeven.qualification=${name}`, name]);
  networkCreated = true;
  execute('docker', ['run', '-d', '--name', name, '--label', `redeven.qualification=${name}`, '--network', name,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=512m',
    '-p', '127.0.0.1::19400', '--mount', `type=bind,src=${state},dst=/fixture`,
    '-e', 'REDEVEN_GATEWAY_ACCESS_BROWSER=1', '-e', 'REDEVEN_GATEWAY_DEPLOYMENT_FIXTURE=/fixture',
    image, '/fixture/localui.test', '-test.run=^TestGatewayAccessBrowserSession$', '-test.timeout=16m', '-test.v']);
  containerCreated = true;
  await waitFor('Runtime fixture configuration', () => access(path.join(state, 'fixture.json')).then(() => true, () => false));
  const binding = execute('docker', ['port', name, '19400/tcp']);
  assert.match(binding, /^127\.0\.0\.1:\d+$/u);
  const upstreamPort = Number(binding.split(':')[1]);
  await waitFor('published Gateway listener', () => tcp('127.0.0.1', upstreamPort));
  const fixture = JSON.parse(await readFile(path.join(state, 'fixture.json'), 'utf8'));
  for (const target of [fixture.plain, fixture.secure, fixture.transport]) {
    const url = new URL(target);
    assert.equal(net.isIP(url.hostname), 4, 'isolation uses real IP addresses, not DNS failures');
    assert.equal(await tcp(url.hostname, Number(url.port)), false, 'Runtime is directly reachable; Docker must isolate its bridge from the host');
  }
  console.log('PASS OS network isolation: Runtime ports cannot be reached directly from Desktop');
  const certificate = path.join(state, 'gateway.pem');
  const key = path.join(state, 'gateway.key');
  execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Gateway qualification',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', certificate], { stdio: 'ignore' });
  const port = await freePort();
  const accessLog = path.join(output, 'nginx-access.log');
  await writeFile(accessLog, '');
  const replacements = { PID: path.join(state, 'nginx.pid'), ACCESS_LOG: accessLog, LISTEN: `127.0.0.1:${port}`,
    SERVER_NAME: 'localhost', CERTIFICATE: certificate, CERTIFICATE_KEY: key, UPSTREAM: binding };
  const template = await readFile(path.join(root, 'assets/gateway/nginx.conf.template'), 'utf8');
  const config = template.replace(/@([A-Z_]+)@/gu, (_, token) => {
    assert.ok(Object.hasOwn(replacements, token), `unknown Nginx configuration token ${token}`);
    const value = replacements[token];
    assert.ok(!/[\r\n";$]/u.test(value), 'unsafe Nginx configuration value');
    return value;
  });
  const configuration = path.join(state, 'nginx.conf');
  await writeFile(configuration, config, { mode: 0o600 });
  execute('nginx', ['-t', '-p', `${state}/`, '-c', configuration], { stdio: 'inherit' });
  nginx = spawn('nginx', ['-p', `${state}/`, '-c', configuration, '-g', 'daemon off;'], { stdio: 'ignore' });
  await waitFor('Nginx HTTPS listener', () => tcp('127.0.0.1', port));
  const gateway = `https://127.0.0.1:${port}/`;
  await assert.rejects(new Promise((resolve, reject) => {
    const request = https.get(`${gateway}gateway/v3/metadata`, response => { response.resume(); resolve(); });
    request.once('error', reject);
  }), error => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));
  const hostFixture = { ...fixture, state, gateway, accessLog };
  const hostConfig = path.join(state, 'host-fixture.json');
  await writeFile(hostConfig, JSON.stringify(hostFixture), { mode: 0o600 });
  await writeFile(path.join(output, 'deployment.json'), JSON.stringify({
    commit: execute('git', ['rev-parse', 'HEAD']), image, architecture, container: name, network: name,
    sourceDirty: Boolean(execute('git', ['status', '--porcelain'])),
    fixtureSHA256: createHash('sha256').update(await readFile(path.join(state, 'localui.test'))).digest('hex'),
    nginxTemplateSHA256: createHash('sha256').update(template).digest('hex'),
    nginxVersion, nginxPID: nginx.pid, gatewayPort: port, gatewayUpstreamPort: upstreamPort,
    runtimePortsPublished: false, certificateTrust: 'fixture CA scoped to the child process', state,
  }, null, 2));
  console.log('Running Electron login, MFA, WSS, Flower and deployment checks through Nginx HTTPS');
  await run('node', [path.join(desktop, 'scripts/check-gateway-access-electron.mjs'), hostConfig], 'electron.log', { NODE_EXTRA_CA_CERTS: certificate });
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  assert.equal(canceled, false, 'qualification was canceled');
  assert.equal(report.status, 'passed');
  assert.ok(report.cases.length >= 19);
  completed = true;
  console.log(`PASS isolated HTTPS Gateway deployment (${report.cases.length} cases)`);
} finally {
  for (const child of active) child.kill('SIGTERM');
  if (nginx && nginx.exitCode === null) {
    const exit = new Promise(resolve => nginx.once('exit', resolve));
    nginx.kill('SIGTERM');
    await Promise.race([exit, delay(5000)]);
    if (nginx.exitCode === null && nginx.signalCode === null) { nginx.kill('SIGKILL'); await exit; }
  }
  const cleanupErrors = [];
  const clean = async action => { try { await action(); } catch (error) { cleanupErrors.push(error.message); } };
  if (containerCreated) {
    await clean(async () => {
      await writeFile(path.join(state, 'finish'), '');
      await delay(200);
      const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 10_000 });
      await writeFile(path.join(output, 'gateway.log'), (logs.stdout ?? '') + (logs.stderr ?? ''));
    });
    await clean(() => execute('docker', ['rm', '-f', name], { stdio: 'ignore' }));
  }
  if (networkCreated) await clean(() => execute('docker', ['network', 'rm', name], { stdio: 'ignore' }));
  await clean(() => rm(state, { recursive: true, force: true }));
  await writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ containerRemoved: containerCreated && cleanupErrors.length === 0,
    networkRemoved: networkCreated && cleanupErrors.length === 0, nginxStopped: Boolean(nginx),
    temporaryStateRemoved: cleanupErrors.length === 0, completed, errors: cleanupErrors }, null, 2));
  if (cleanupErrors.length) throw new Error(`Qualification cleanup failed: ${cleanupErrors.join('; ')}`);
}
