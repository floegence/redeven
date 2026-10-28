import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chromium } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';

// Explicit qualification host only. Requires SSH and passwordless sudo, Docker,
// setfacl, Python, mkcert and Chrome. Never touches an installed Runtime service.
const [host, stagedRoot, address, image] = process.argv.slice(2);
if (!host || !address || !image || !/^\/var\/lib\/redeven-center-[a-z0-9-]+-qualification$/.test(stagedRoot ?? '')) {
  throw new Error('Usage: node scripts/check_center_linux_deployment.mjs <ssh-host> <private staged /var/lib/redeven-center-*-qualification> <host-address> <staged-linux-image>');
}
const root = await mkdtemp(path.join(tmpdir(), 'redeven-center-linux-'));
const quote = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
function ssh(command, input) {
  return execFileSync('ssh', ['-x', '-o', 'BatchMode=yes', host, command], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const binary = stagedRoot + '/release/redeven-center';
const unit = path.basename(stagedRoot).replace('-qualification', '-package');
const container = unit + '-docker';
const connectorUnit = unit + '-connector';
const connectorContainer = container + '-connector';
const connectorDir = '/run/' + connectorUnit;
const connectorSocket = connectorDir + '/connector.sock';
const report = { scope: 'Linux amd64 package on an explicitly authorized host; systemd hardening and nonroot Docker; real Chrome', host, startedAt: new Date().toISOString(), cases: [], status: 'running' };
const password = 'linux-deployment-qualification-password';
let browser;
function tokenCode(secret) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(step).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function setup(page, token) {
  await page.getByLabel('One-time setup credential', { exact: true }).fill(token);
  await page.getByLabel('Entry password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const secret = await page.getByTestId('totp-secret').textContent();
  await page.getByLabel('Authenticator code', { exact: true }).fill(tokenCode(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  const codes = (await page.getByTestId('recovery-codes').textContent()).trim().split(/\s+/);
  await page.getByLabel('I saved these recovery codes', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  return codes;
}
async function login(page, code) {
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await page.getByLabel('Entry password', { exact: true }).fill(password);
  const [response] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/center/v1/authenticate'), page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
  if (response.status() !== 200) throw new Error('Package password challenge returned ' + response.status());
  await page.locator('input[autocomplete="one-time-code"]').waitFor();
  const recovery = page.getByRole('button', { name: 'Recovery code', exact: true });
  if (await recovery.count()) await recovery.click();
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('heading', { name: 'Environments', exact: true }).first().waitFor();
}
async function ready(page, origin) {
  for (let i = 0; i < 100; i++) {
    try { const response = await page.goto(origin); if (response?.status() === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Linux package did not become browser-ready');
}
const baseline = ssh('systemctl show redeven-desktop.service --property=MainPID --property=ActiveState');
try {
  ssh('sudo -n docker image inspect ' + quote(image) + ' >/dev/null');
  report.manifest = JSON.parse(ssh('cat ' + quote(stagedRoot + '/release/manifest.json')));
  assert.equal(ssh('uname -m'), 'x86_64');
  const uid = ssh('id -u'), gid = ssh('id -g');
  const template = await readFile(new URL('../packaging/center/redeven-center.service', import.meta.url), 'utf8');
  const port = Number(ssh('python3 -c ' + quote('import socket; s=socket.socket(); s.bind(("0.0.0.0",0)); print(s.getsockname()[1])')));
  const origin = 'https://center-linux.qualification.localhost:' + port;
  const unitText = template.replace('User=redeven-center', 'User=' + uid).replace('Group=redeven-center', 'Group=' + gid)
    .replace('StateDirectory=redeven-center', 'StateDirectory=' + path.basename(stagedRoot) + '/state')
    .replaceAll('/etc/redeven-center/center.env', stagedRoot + '/center.env').replaceAll('/opt/redeven-center', stagedRoot + '/release')
    .replace('ReadWritePaths=/var/lib/redeven-center', 'ReadWritePaths=' + stagedRoot + '/state').replace('--state-root /var/lib/redeven-center ', '--state-root ' + stagedRoot + '/state ')
    .replace('--connector-user redeven-connector', '--connector-user nobody').replaceAll('redeven-center-connector.service', connectorUnit + '.service').replaceAll('/run/redeven-connector/connector.sock', connectorSocket);
  const connectorTemplate = await readFile(new URL('../packaging/center/redeven-center-connector.service', import.meta.url), 'utf8');
  const connectorText = connectorTemplate.replace('User=redeven-connector', 'User=nobody').replace('Group=redeven-center', 'Group=' + gid)
    .replaceAll('/opt/redeven-center', stagedRoot + '/release').replace('RuntimeDirectory=redeven-connector', 'RuntimeDirectory=' + connectorUnit)
    .replaceAll('/run/redeven-connector/connector.sock', connectorSocket).replace('--center-user redeven-center', '--center-user ' + uid)
    .replace('InaccessiblePaths=-/var/lib/redeven-center -/etc/redeven-center', 'InaccessiblePaths=' + stagedRoot + '/state ' + stagedRoot + '/tls-key.pem');
  // This explicit task fixture exposes only immutable binaries to nobody.
  // The service sandbox also denies the state and TLS-key paths by name.
  ssh('chmod 711 ' + quote(stagedRoot));
  ssh('sudo -n tee ' + quote('/run/systemd/system/' + connectorUnit + '.service') + ' >/dev/null', connectorText);
  const newline = String.fromCharCode(10);
  ssh('cat > ' + quote(stagedRoot + '/center.env'), ['CENTER_ORIGIN=' + origin, 'CENTER_LISTEN=0.0.0.0:' + port, 'CENTER_TLS_CERT=' + stagedRoot + '/tls.pem', 'CENTER_TLS_KEY=' + stagedRoot + '/tls-key.pem', ''].join(newline));
  ssh('sudo -n tee ' + quote('/run/systemd/system/' + unit + '.service') + ' >/dev/null', unitText);
  ssh('sudo -n systemctl daemon-reload && sudo -n systemctl start ' + quote(unit));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--host-resolver-rules=MAP center-linux.qualification.localhost ' + address, '--no-proxy-server'] });
  report.browser = await browser.version();
  const context = await browser.newContext({ locale: 'en-US' }), page = await context.newPage();
  await ready(page, origin);
  let codes = await setup(page, ssh(quote(binary) + ' setup --state-root ' + quote(stagedRoot + '/state')));
  await login(page, codes[0]);
  report.cases.push('Packaged systemd service with original hardening completes real Chrome setup and sign-in without a Runtime dependency');
  ssh('sudo -n systemctl restart ' + quote(unit));
  await ready(page, origin);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await login(page, codes[1]);
  report.cases.push('systemd restart preserves administrator factors and invalidates old browser sessions');
  const centerPID = ssh('systemctl show ' + quote(unit) + ' --property=MainPID --value');
  const workerPID = ssh('systemctl show ' + quote(connectorUnit) + ' --property=MainPID --value');
  assert.notEqual(workerPID, '0');
  assert.equal(ssh('ps -o user= -p ' + workerPID).trim(), 'nobody');
  assert.equal(ssh('sudo -n -u nobody test -r ' + quote(stagedRoot + '/state/center.key') + ' && echo readable || echo denied'), 'denied');
  assert.equal(ssh('sudo -n -u nobody curl --silent --unix-socket ' + quote(connectorSocket) + " -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' http://connector/v1/leases"), '403');
  ssh('sudo -n systemctl restart ' + quote(connectorUnit));
  assert.equal(ssh('systemctl show ' + quote(unit) + ' --property=MainPID --value'), centerPID);
  await page.reload();
  await page.getByRole('heading', { name: 'Environments', exact: true }).first().waitFor();
  report.cases.push('Separate low-privilege Connector UID cannot read Center key or admit itself; independent restart preserves Center PID and browser login');
  // Deliberately allow socket traversal for this fixture, so denial proves
  // SO_PEERCRED rather than only filesystem permissions. Restore immediately.
  ssh('chmod 711 ' + quote(stagedRoot) + ' && sudo -n setfacl -m u:nobody:--x ' + quote(stagedRoot + '/state') + ' && sudo -n setfacl -m u:nobody:rw- ' + quote(stagedRoot + '/state/owner.sock'));
  try {
    const denied = ssh('sudo -n -u nobody curl --silent --unix-socket ' + quote(stagedRoot + '/state/owner.sock') + " -H 'Content-Type: application/json' -H 'X-Forwarded-User: root' -d '{\"action\":\"recover\"}' -o /dev/null -w '%{http_code}' http://owner/owner/setup");
    assert.equal(denied, '403');
  } finally {
    ssh('sudo -n setfacl -x u:nobody ' + quote(stagedRoot + '/state/owner.sock') + ' && sudo -n setfacl -x u:nobody ' + quote(stagedRoot + '/state'));
  }
  report.cases.push('Actual unauthorized Linux UID is denied by owner socket despite explicit test-only socket ACL and forged header');
  ssh('sudo -n systemctl stop ' + quote(unit));
  ssh('sudo -n systemctl stop ' + quote(connectorUnit));
  const recovery = ssh(quote(binary) + ' recover --offline --origin ' + quote(origin) + ' --state-root ' + quote(stagedRoot + '/state'));
  ssh('sudo -n systemctl start ' + quote(unit));
  await ready(page, origin);
  codes = await setup(page, recovery);
  await login(page, codes[0]);
  report.cases.push('Stopped systemd state supports exclusive offline recovery and browser completion');
  await context.close();
  ssh('sudo -n systemctl stop ' + quote(unit));
  ssh('sudo -n install -d -m 700 ' + quote(stagedRoot + '/docker-state') + ' ' + quote(stagedRoot + '/docker-tls') + ' && sudo -n install -m 600 ' + quote(stagedRoot + '/tls.pem') + ' ' + quote(stagedRoot + '/docker-tls/tls.pem') + ' && sudo -n install -m 600 ' + quote(stagedRoot + '/tls-key.pem') + ' ' + quote(stagedRoot + '/docker-tls/tls-key.pem'));
  ssh('sudo -n python3 -c ' + quote('import os; root=' + JSON.stringify(stagedRoot) + '; paths=[root+"/docker-state",root+"/docker-tls",root+"/docker-tls/tls.pem",root+"/docker-tls/tls-key.pem"]; [os.chown(p,10001,10001) for p in paths]'));
  ssh('sudo -n install -d -m 750 ' + quote(stagedRoot + '/docker-ipc') + ' && sudo -n chown 10002:10001 ' + quote(stagedRoot + '/docker-ipc'));
  ssh('sudo -n docker run -d --name ' + quote(connectorContainer) + ' --label ' + quote('redeven.qualification=' + unit) + ' --user 10002:10001 --read-only --security-opt no-new-privileges --cap-drop ALL -v ' + quote(stagedRoot + '/docker-ipc:/run/redeven-connector') + ' ' + quote(image) + ' connector --connector-socket /run/redeven-connector/connector.sock --center-user 10001');
  ssh('sudo -n docker run -d --name ' + quote(container) + ' --label ' + quote('redeven.qualification=' + unit) + ' --read-only --security-opt no-new-privileges --cap-drop ALL -p ' + port + ':8443 -v ' + quote(stagedRoot + '/docker-state:/var/lib/redeven-center') + ' -v ' + quote(stagedRoot + '/docker-tls:/tls:ro') + ' -v ' + quote(stagedRoot + '/docker-ipc:/run/redeven-connector:ro') + ' ' + quote(image) + ' serve --state-root /var/lib/redeven-center --listen 0.0.0.0:8443 --origin ' + quote(origin) + ' --tls-cert /tls/tls.pem --tls-key /tls/tls-key.pem --assets /opt/redeven-center/ui --connector-socket /run/redeven-connector/connector.sock --connector-user 10002');
  const dockerContext = await browser.newContext({ locale: 'en-US' }), dockerPage = await dockerContext.newPage();
  await ready(dockerPage, origin);
  const owner = command => ssh('sudo -n docker exec ' + quote(container) + ' /opt/redeven-center/redeven-center ' + command + ' --state-root /var/lib/redeven-center');
  codes = await setup(dockerPage, owner('setup'));
  await login(dockerPage, codes[0]);
  assert.equal(ssh('sudo -n docker inspect --format ' + quote('{{.Config.User}}') + ' ' + quote(container)), '10001:10001');
  assert.equal(ssh('sudo -n docker inspect --format ' + quote('{{.Config.User}}') + ' ' + quote(connectorContainer)), '10002:10001');
  const workerMounts = JSON.parse(ssh('sudo -n docker inspect --format ' + quote('{{json .Mounts}}') + ' ' + quote(connectorContainer)));
  assert.ok(workerMounts.every(mount => mount.Destination !== '/tls' && mount.Destination !== '/var/lib/redeven-center'));
  ssh('sudo -n docker restart ' + quote(connectorContainer));
  await dockerPage.reload();
  await dockerPage.getByRole('heading', { name: 'Environments', exact: true }).first().waitFor();
  report.cases.push('Separate Connector container uses UID 10002, receives no Center state/TLS mounts, and restarts without invalidating Center login');
  ssh('sudo -n docker restart ' + quote(container));
  await ready(dockerPage, origin);
  await dockerPage.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  await login(dockerPage, codes[1]);
  report.cases.push('Linux amd64 Docker image runs UID 10001 with dropped capabilities, persistent private state and browser setup/restart');
  const online = owner('recover');
  await dockerPage.reload();
  codes = await setup(dockerPage, online);
  await login(dockerPage, codes[0]);
  report.cases.push('Container owner CLI performs recovery while serving, fences old devices, and commits replacement factors');
  await dockerContext.close();
  assert.equal(ssh('systemctl show redeven-desktop.service --property=MainPID --property=ActiveState'), baseline);
  report.cases.push('Existing production Runtime remains active with identical PID throughout independent Center lifecycle operations');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await browser?.close();
  const cleanup = [];
  for (const command of ['sudo -n docker rm -f -v ' + quote(container) + ' ' + quote(connectorContainer), 'sudo -n systemctl stop ' + quote(unit) + ' ' + quote(connectorUnit), 'sudo -n rm -f ' + quote('/run/systemd/system/' + unit + '.service') + ' ' + quote('/run/systemd/system/' + connectorUnit + '.service') + ' && sudo -n systemctl daemon-reload', 'chmod 700 ' + quote(stagedRoot)]) {
    try { ssh(command); cleanup.push('completed'); } catch { cleanup.push('not present or failed'); }
  }
  report.cleanup = cleanup; report.finishedAt = new Date().toISOString();
  const output = process.env.REDEVEN_CENTER_REPORT_DIR ?? root;
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, 'linux-deployment-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, cases: report.cases, report: path.join(output, 'linux-deployment-report.json') }));
  if (output !== root) await rm(root, { recursive: true, force: true });
}
