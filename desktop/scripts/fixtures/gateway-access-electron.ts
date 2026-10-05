import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { verifyRuntimeAccessIdentity } from '../../src/main/runtimeAccessIdentity';
import { probeExternalLocalUIHealth } from '../../src/main/runtimeState';
import { verifyGatewayDeployment } from './gateway-deployment';
import { GatewayURLClient, redactGatewayDiagnosticValue } from '../../src/main/gatewayClient';
import { createGatewayProxyTransport, type GatewayProxyTransport } from '../../src/main/gatewayProxyTransport';
import { createGatewayPairingMaterial, pairingChallengeRequestWithCode, buildPairingCompleteRequest,
  assertGatewayPairingCompleteResponse, completeGatewayPairing } from '../../src/main/gatewayTrust';
import type { GatewayRecord } from '../../src/main/gatewayStore';

const fixture = JSON.parse(readFileSync(process.env.REDEVEN_GATEWAY_FIXTURE!, 'utf8'));
// Pin only the test fixture certificate; production transport never changes TLS policy.
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', fixture.certificateSPKI);
app.on('window-all-closed', () => {});
const proxies = new Map<number, GatewayProxyTransport>();
app.on('login', (event, contents, _details, auth, callback) => {
  const proxy = proxies.get(auth.port);
  if (auth.isProxy && auth.host === '127.0.0.1' && proxy && contents) {
    event.preventDefault(); callback('redeven', proxy.token);
  }
});

void app.whenReady().then(async () => {
  const cases: string[] = [];
  const windows: BrowserWindow[] = [];
  const output = process.env.REDEVEN_GATEWAY_OUTPUT!;
  const secrets = new Map<string, string>();
  const secretStore = { writeSecret: (key: string, value: string) => { secrets.set(key, value); },
    readSecret: (key: string) => secrets.get(key) ?? '', deleteSecret: (key: string) => { secrets.delete(key); } };
  const client = new GatewayURLClient(secretStore);
  let record: GatewayRecord = { schema_version: 3, gateway_id: 'pending', display_name: 'Qualification Gateway', local_enabled: true,
    connection: { kind: 'url', base_url: fixture.gateway, allow_loopback_http: true }, created_at_ms: 1, updated_at_ms: 1 };
  const material = createGatewayPairingMaterial(record);
  const challenge = await client.pairingChallenge(record, pairingChallengeRequestWithCode(material, 'qualification-code'));
  record = { ...record, gateway_id: challenge.gateway_id };
  const completed = await client.completePairing(record, buildPairingCompleteRequest(material, challenge, { profileWrite: true }));
  assertGatewayPairingCompleteResponse(material, challenge, completed, { client_capability: 'env_profile_write' });
  record = { ...record, trust_profile: await completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }) };
  const nonce = randomBytes(32).toString('base64url');
  const identity = verifyRuntimeAccessIdentity(await client.checkEnvironmentProfile(record, fixture.plain, nonce), nonce);
  assert.match(identity ?? '', /^runtime:[a-f0-9]{64}$/u);
  assert.equal((await client.catalog(record)).environments.length, 0, 'verification does not publish a profile');
  for (const [id, url] of [['env_http', fixture.plain], ['env_tls', fixture.secure]]) {
    await client.upsertEnvironmentProfile(record, { gateway_env_id: id, display_name: id, access_mode: 'gateway_proxy', access_route: { kind: 'url', url } });
  }
  const catalog = await client.catalog(record);
  assert.equal(catalog.environments.length, 2);
  cases.push('signed pairing, explicit profile authorization and v3 catalog');
  const open = async (id: string, mode: 'gateway_proxy' | 'direct_url') => {
    const target = id === 'env_tls' ? fixture.secure : fixture.plain;
    const response = await client.openSession(record, { gateway_env_id: id, requested_capability: 'env_app', access_mode: mode, client_nonce: crypto.randomUUID() });
    const partition = `gateway-qualification:${crypto.randomUUID()}`;
    const webSession = session.fromPartition(partition);
    let proxy: GatewayProxyTransport | undefined;
    if (mode === 'gateway_proxy') {
      proxy = await createGatewayProxyTransport(response.connect_artifact.url!, target);
      proxies.set(Number(new URL(proxy.proxyURL).port), proxy);
      await webSession.setProxy({ mode: 'fixed_servers', proxyRules: proxy.proxyURL, proxyBypassRules: '<-loopback>' });
    } else { await webSession.setProxy({ mode: 'direct' }); }
    const window = new BrowserWindow({ show: false, webPreferences: { session: webSession, contextIsolation: true, sandbox: true } });
    windows.push(window);
    await window.loadURL(`${target}/_redeven_proxy/env/`);
    assert.equal(new URL(window.webContents.getURL()).origin, new URL(target).origin);
    assert.ok(!window.webContents.getURL().includes('/gateway/v3/access/'));
    return { window, webSession, proxy, response };
  };
  type View = Awaited<ReturnType<typeof open>>;
  const call = (view: Pick<View, 'window'>, route: string, body?: unknown) => view.window.webContents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(route)}, ${JSON.stringify(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })});
    return { status: response.status, body: await response.json() };
  })()`);
  const unlocked = async (view: View) => (await call(view, '/api/local/access/status')).body.data.unlocked;
  const password = { password: 'gateway-fixture-password' };
  try {
    const first = await open('env_http', 'gateway_proxy');
    const proxyHealth = await probeExternalLocalUIHealth(fixture.plain, { agent: first.proxy!.agent });
    assert.ok(proxyHealth.ok);
    assert.equal(proxyHealth.value.verified_runtime_identity, identity);
    if (!fixture.deployment) {
      const directHealth = await probeExternalLocalUIHealth(fixture.plain);
      assert.ok(directHealth.ok);
      assert.equal(directHealth.value.verified_runtime_identity, identity);
    }
    cases.push('signed draft verification and actual Desktop proxy readiness prove the same Runtime identity without login');
    assert.equal(await unlocked(first), false);
    assert.equal((await call(first, '/api/local/runtime')).status, 423);
    assert.equal((await call(first, '/api/local/access/unlock', password)).body.data.unlocked, true);
    assert.equal((await call(first, '/api/local/runtime')).status, 200);
    await new Promise<void>(resolve => { first.window.webContents.once('did-finish-load', () => resolve()); first.window.reload(); });
    assert.equal(await unlocked(first), true);
    cases.push('Runtime password, protected API and reload through Gateway');
    const second = await open('env_http', 'gateway_proxy');
    const direct = fixture.deployment ? undefined : await open('env_http', 'direct_url');
    assert.equal(await unlocked(second), false);
    if (direct) assert.equal(await unlocked(direct), false);
    cases.push(direct ? 'two Gateway sessions and Direct URL have independent cookie stores' : 'two isolated Gateway sessions have independent Runtime cookie stores');
    await call(first, '/api/local/access/logout', {});
    assert.equal(await unlocked(first), false);
    if (direct) assert.equal((await call(direct, '/api/local/access/unlock', password)).body.data.unlocked, true);
    cases.push(direct ? 'Runtime logout remains authoritative and Direct URL remains usable' : 'Runtime logout remains authoritative through the HTTPS reverse proxy');
    const secure = await open('env_tls', 'gateway_proxy');
    await assert.rejects(new Promise<void>((resolve, reject) => {
      const request = https.get(`${fixture.secure}/api/local/access/status`, { agent: secure.proxy!.agent }, response => {
        response.resume(); response.once('end', resolve);
      });
      request.once('error', reject);
    }), (error: unknown) => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes((error as { code: string }).code));
    cases.push('Desktop readiness transport rejects an untrusted Runtime TLS certificate');
    const login = await call(secure, '/api/local/access/unlock', password);
    assert.ok(login.body.data.challenge_id); assert.equal(await unlocked(secure), false);
    const verified = await call(secure, '/api/local/access/unlock', { challenge_id: login.body.data.challenge_id, recovery_code: fixture.recoveryCodes[0] });
    assert.equal(verified.body.data.unlocked, true);
    const cookies = await secure.webSession.cookies.get({ url: fixture.secure });
    assert.ok(cookies.some(cookie => cookie.name.startsWith('redeven_local_access') && cookie.secure && cookie.httpOnly));
    assert.equal(await secure.window.webContents.executeJavaScript('window.isSecureContext'), true);
    cases.push('original HTTPS origin, MFA challenge and secure HttpOnly Runtime cookie');
    const runtimeVerification = readFileSync(path.join(output, 'runtime-browser.js'), 'utf8');
    cases.push(...await secure.window.webContents.executeJavaScript(`${runtimeVerification}\nGatewayAcceptance.verifyRuntimeServices()`));
    // The access session does not inject Desktop's private management identity.
    for (const route of ['/v2/runtime/access', '/v2/runtime/stop', '/v2/runtime/restart']) {
      const management = await secure.window.webContents.executeJavaScript(`fetch(${JSON.stringify(route)}, {method:'PUT', headers:{'Content-Type':'application/json'}, body:'{}'}).then(r => r.status)`);
      assert.equal(management, 404);
    }
    cases.push('Gateway authorization does not become Runtime private management');
    const failure = new Promise<string>(resolve => second.proxy!.subscribeFailure(error => resolve(error.code)));
    await client.deleteEnvironmentProfile(record, { gateway_env_id: 'env_http' });
    await assert.rejects(second.proxy!.openConnection(), (error: unknown) => (error as { code: string }).code === 'GATEWAY_SESSION_EXPIRED');
    assert.equal(await failure, 'GATEWAY_SESSION_EXPIRED');
    if (direct) assert.equal(await unlocked(direct), true);
    assert.equal((await client.catalog(record)).environments.length, 1);
    cases.push(direct ? 'profile deletion revokes proxy access while direct Runtime authorization is independent' : 'profile deletion revokes proxy access and updates the catalog');
    await client.closeSession(record, secure.response.gateway_session_id);
    await client.closeSession(record, secure.response.gateway_session_id);
    await assert.rejects(secure.proxy!.openConnection());
    cases.push('signed close-session is idempotent and revokes established access');
    if (fixture.deployment) {
      console.log(`PASS production Runtime through HTTPS reverse proxy (${cases.length} cases)`);
      cases.push(...await verifyGatewayDeployment({ fixture, client, record, proxies, open, call }));
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', cases }, null, 2));
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await Promise.all([...proxies.values()].map(proxy => proxy.close()));
  }
  app.exit(0);
}).catch(error => { console.error('Gateway qualification failed:', redactGatewayDiagnosticValue(error instanceof Error ? error.stack : String(error))); app.exit(1); });
