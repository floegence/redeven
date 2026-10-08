import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';

// Exercise the production Welcome, preload, IPC and service owners together.
// Supply the current checkout's verified development bundle; no launcher mocks.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
assert.ok(bundle, 'Build a Desktop bundle and set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT');
execFileSync(path.join(root, '../scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const state = await mkdtemp(path.join(tmpdir(), 'redeven-gateway-setup-'));
const output = path.join(root, 'dist/gateway-setup-acceptance');
await mkdir(output, { recursive: true });
const marker = randomUUID();
const child = spawn(electron, [root, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--redeven-smoke-run=${marker}`], {
  cwd: state, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_STATE_ROOT: state,
    REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(state, 'desktop'), REDEVEN_DESKTOP_AUTO_START_RUNTIME: '0',
    REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT: path.resolve(root, '..'),
    REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG: manifest.version, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version },
});
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const report = { status: 'running', cases: [], commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), pid: child.pid, marker, state };
let logs = '';
child.stdout.on('data', bytes => { logs += bytes.toString(); });
let browser;
let page;
const stop = () => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else process.kill(-child.pid, 'SIGTERM');
};
const timer = setTimeout(stop, 12 * 60_000);
try {
  const endpoint = await Promise.race([
    new Promise(resolve => child.stderr.on('data', bytes => {
      logs += bytes.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(logs);
      if (match) resolve(match[1]);
    })),
    exited.then(result => { throw new Error(`Desktop exited before debugging became ready: ${JSON.stringify(result)}`); }),
  ]);
  report.port = Number(new URL(endpoint).port);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent('page');
  await page.waitForFunction(() => Boolean(window.redevenDesktopLauncher));
  await page.evaluate(async () => {
    window.redevenDesktopLanguage.setPreference('en-US');
    await window.redevenDesktopShell.openConnectionCenter();
  });
  const snapshot = () => page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
  const action = request => page.evaluate(request => window.redevenDesktopLauncher.performAction(request), request);
  await page.getByRole('button', { name: 'Gateways', exact: true }).click();
  await page.getByRole('button', { name: 'Add Gateway', exact: true }).first().click();
  await page.getByRole('button', { name: 'Local host', exact: true }).click();
  const dataRoot = path.join(state, 'gateway-data');
  await page.locator('#gateway-name').fill('Local qualification');
  await page.getByRole('button', { name: 'Save Gateway', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  let current = await snapshot();
  const source = current.gateway_sources.find(item => item.display_name === 'Local qualification');
  assert.ok(source, 'Saved Local Gateway must appear in the production snapshot');
  const id = source.gateway_id;
  report.gatewayID = id;
  report.cases.push('Local Gateway default form saves through production IPC and persistent store');
  assert.equal(source.runtime_root, 'remote_default');
  assert.notEqual(source.service_state?.status, 'ready', 'Save must not start a Gateway');
  const registration = { kind: 'upsert_gateway', gateway_id: id, display_name: source.display_name,
    connection_kind: 'local_host', host_access: { kind: 'local_host' },
    placement: { kind: 'host_process', runtime_root: dataRoot, release_base_url: '' } };
  assert.equal((await action(registration)).ok, true);
  assert.equal((await snapshot()).gateway_sources.find(item => item.gateway_id === id).runtime_root, dataRoot,
    'Editing the Gateway data root must be reflected in the authoritative snapshot');
  report.cases.push('Editing the default data root updates the saved source');
  const needsStart = await action({ ...registration, permissions: { access: true, manage_members: true, configure_cloud: true } });
  assert.equal(needsStart.ok, false);
  assert.equal(needsStart.code, 'gateway_start_required');
  assert.equal(needsStart.gateway_id, id);
  assert.deepEqual(needsStart.continuation_action, { kind: 'start_gateway', gateway_id: id });
  report.cases.push('Authorization on a stopped service preserves the registration and offers explicit Start');
  const run = async kind => {
    const result = await action({ kind, gateway_id: id });
    assert.equal(result.ok, true, `${kind}: ${JSON.stringify(result)}`);
    report.cases.push(kind);
  };
  await run('start_gateway');
  await run('pair_gateway');
  await run('refresh_gateway_catalog');
  assert.equal((await action({ kind: 'invite_gateway_runtime', gateway_id: id })).ok, false, 'Basic pairing grants access only');
  assert.equal((await action({ ...registration, permissions: { access: true, manage_members: true, configure_cloud: true } })).ok, true);
  const paired = (await snapshot()).gateway_sources.find(item => item.gateway_id === id);
  assert.deepEqual(paired.permissions, { access: true, manage_members: true, configure_cloud: true });
  assert.equal((await action({ kind: 'invite_gateway_runtime', gateway_id: id })).ok, false, 'Invitations require administrator-confirmed endpoints');
  const endpoints = [
    { endpoint_id: 'lan', address: 'https://localhost:7443', scope: 'lan', priority: 0 },
    { endpoint_id: 'public', address: 'https://gateway.example:9443', scope: 'public', priority: 1 },
  ];
  assert.equal((await action({ kind: 'update_gateway_endpoints', gateway_id: id, endpoints })).ok, true);
  const invited = await action({ kind: 'invite_gateway_runtime', gateway_id: id });
  assert.equal(invited.ok, true);
  assert.equal(invited.gateway_invitation.protocol_version, 'redeven-gateway-v5');
  assert.equal(invited.gateway_invitation.expires_at_unix_ms - invited.gateway_invitation.issued_at_unix_ms, 600_000);
  assert.deepEqual(invited.gateway_invitation.endpoints, endpoints);
  assert.ok(invited.gateway_invitation.gateway_name);
  assert.equal((await snapshot()).environments.some(item => item.kind === 'gateway_environment'), false, 'Invitation does not manufacture a member');
  const policy = { ...paired.policy, default_cloud_allowed: true };
  assert.equal((await action({ kind: 'update_gateway_policy', gateway_id: id, policy })).ok, true);
  await run('restart_gateway');
  const restored = (await snapshot()).gateway_sources.find(item => item.gateway_id === id);
  assert.equal(restored.policy.default_cloud_allowed, true);
  assert.equal(restored.permissions.manage_members, true);
  report.cases.push('Access-only pairing denies invitations; explicit permissions and policy survive restart');
  assert.equal((await action({ kind: 'update_gateway_endpoints', gateway_id: id, endpoints: [] })).ok, true);
  await run('restart_gateway');
  assert.equal((await action({ kind: 'invite_gateway_runtime', gateway_id: id })).ok, false, 'Restart must not restore deleted endpoints');
  report.cases.push('Confirmed multi-endpoint invitations and endpoint deletion persist without automatic address publication');
  current = await snapshot();
  await writeFile(path.join(output, 'snapshot.json'), JSON.stringify(current, null, 2));
  await run('stop_gateway');
  await run('start_gateway');
  await run('restart_gateway');
  await run('stop_gateway');
  await run('delete_gateway');
  assert.equal((await snapshot()).gateway_sources.some(item => item.gateway_id === id), false);
  await page.getByRole('button', { name: 'Add Gateway', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL', exact: true }).click();
  await page.locator('#gateway-url').fill('ftp://invalid.example/');
  await page.getByRole('button', { name: 'Save Gateway', exact: true }).click();
  await page.getByText('Gateway setup could not finish. Review the details, correct the connection, and retry.', { exact: true }).waitFor();
  await page.locator('details summary').click();
  await page.getByText('Gateway URL must use HTTP or HTTPS.', { exact: true }).waitFor();
  assert.equal((await snapshot()).gateway_sources.length, 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.cases.push('Invalid URL preserves the setup dialog and exposes the actual sanitized failure without saving a connection');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  clearTimeout(timer);
  await writeFile(path.join(output, 'desktop.log'), logs);
  const cleanupErrors = [];
  // The managed service is detached from Electron; stop only this test's root.
  if (report.gatewayID) {
    const serviceRoot = path.join(state, 'gateway-data', 'gateways', report.gatewayID, 'state');
    try { execFileSync(path.join(serviceRoot, 'managed/bin/redeven-gateway'), ['service-stop', '--state-root', serviceRoot], { timeout: 15_000, stdio: 'ignore' }); }
    catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(String(error)); }
  }
  stop();
  const gracefulExit = await Promise.race([exited, delay(5000).then(() => null)]);
  if (!gracefulExit && process.platform !== 'win32') {
    process.kill(-child.pid, 'SIGKILL');
    await exited;
  }
  await browser?.close();
  if (cleanupErrors.length === 0) await rm(state, { recursive: true, force: true });
  report.cleanup = { temporaryStateRemoved: cleanupErrors.length === 0, errors: cleanupErrors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (cleanupErrors.length) throw new Error(`Gateway setup cleanup failed: ${cleanupErrors.join('; ')}`);
}
console.log(`PASS Gateway setup qualification (${report.cases.length} cases)`);
