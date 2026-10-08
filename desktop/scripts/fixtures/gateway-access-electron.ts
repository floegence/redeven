import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createLocalNativeCodeSpaceRoute } from '../../src/main/codespaceNativeRoute';
import { createNativeFixtureWindow } from './codespace-native-window';
import { GatewayClient } from '../../src/main/gatewayClient';
import { redactGatewayDiagnosticValue } from '../../src/shared/gatewayDiagnostics';
import { prepareGatewayEnvironmentAccess } from '../../src/main/gatewayEnvironmentAccess';
import { prepareGatewayMemberPartition, closeGatewayMemberTransport } from '../../src/main/gatewayMemberPartition';
import type { GatewayMemberTransport } from '../../src/main/gatewayMemberTransport';
import { createGatewayPairingMaterial, pairingChallengeRequestWithCode, buildPairingCompleteRequest,
  assertGatewayPairingCompleteResponse, completeGatewayPairing } from '../../src/main/gatewayTrust';
import type { GatewayRecord } from '../../src/main/gatewayStore';

const fixture = JSON.parse(readFileSync(process.env.REDEVEN_GATEWAY_FIXTURE!, 'utf8'));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const cases: string[] = [];
  const windows: BrowserWindow[] = [];
  const transports: GatewayMemberTransport[] = [];
  const output = process.env.REDEVEN_GATEWAY_OUTPUT!;
  const secrets = new Map<string, string>();
  const secretStore = { writeSecret: (key: string, value: string) => { secrets.set(key, value); },
    readSecret: (key: string) => secrets.get(key) ?? '', deleteSecret: (key: string) => { secrets.delete(key); } };
  const client = new GatewayClient(secretStore);
  let record: GatewayRecord = { schema_version: 4, gateway_id: 'pending', display_name: 'Qualification Gateway', local_enabled: true,
    connection: { kind: 'url', base_url: fixture.gateway, allow_loopback_http: true }, created_at_ms: 1, updated_at_ms: 1 };
  const material = createGatewayPairingMaterial(record);
  const challenge = await client.pairingChallenge(record, pairingChallengeRequestWithCode(material, fixture.accessCode));
  record = { ...record, gateway_id: challenge.gateway_id };
  const completed = await client.completePairing(record, buildPairingCompleteRequest(material, challenge));
  assertGatewayPairingCompleteResponse(material, challenge, completed);
  record = { ...record, trust_profile: await completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }) };
  const catalog = await client.catalog(record);
  assert.equal(catalog.members.length, 2);
  assert.ok(catalog.members.every(member => member.connected));
  cases.push('v5 client enrollment and automatic directory from two outbound Runtime members without Cloud');
  const open = async (memberID: string) => {
    const member = catalog.members.find(member => member.member_id === memberID)!;
    const access = await prepareGatewayEnvironmentAccess(record, member, catalog, client);
    transports.push(access.transport);
    const webSession = session.fromPartition(`gateway-qualification:${randomUUID()}`);
    await prepareGatewayMemberPartition(webSession, access.transport);
    const window = new BrowserWindow({ show: false, webPreferences: { session: webSession, contextIsolation: true, sandbox: true } });
    windows.push(window);
    await window.loadURL(`${access.transport.origin}/_redeven_proxy/env/`);
    assert.equal(new URL(window.webContents.getURL()).origin, access.transport.origin);
    return { window, webSession, transport: access.transport, startup: access.startup };
  };
  type View = Awaited<ReturnType<typeof open>>;
  const call = (view: Pick<View, 'window'>, route: string, body?: unknown) => view.window.webContents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(route)}, ${JSON.stringify(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })});
    return { status: response.status, body: await response.json() };
  })()`);
  const unlocked = async (view: View) => (await call(view, '/api/local/access/status')).body.data.unlocked;
  const password = { password: 'gateway-fixture-password' };
  try {
    const first = await open(fixture.plainMember);
    assert.equal(await unlocked(first), false);
    assert.equal((await call(first, '/api/local/runtime')).status, 423);
    assert.equal((await call(first, '/api/local/access/unlock', password)).body.data.unlocked, true);
    assert.equal((await call(first, '/api/local/runtime')).status, 200);
    await new Promise<void>(resolve => { first.window.webContents.once('did-finish-load', () => resolve()); first.window.reload(); });
    assert.equal(await unlocked(first), true);
    cases.push('Runtime password and reload remain authoritative through reverse TLS');
    const second = await open(fixture.plainMember);
    assert.equal(await unlocked(second), false);
    cases.push('two member windows isolate Runtime cookies');
    await call(first, '/api/local/access/logout', {});
    assert.equal(await unlocked(first), false);
    cases.push('Runtime logout closes its own application access');
    const secure = await open(fixture.secureMember);
    const login = await call(secure, '/api/local/access/unlock', password);
    assert.ok(login.body.data.challenge_id);
    assert.equal(await unlocked(secure), false);
    const verified = await call(secure, '/api/local/access/unlock', { challenge_id: login.body.data.challenge_id, recovery_code: fixture.recoveryCodes[0] });
    assert.equal(verified.body.data.unlocked, true);
    const cookies = await secure.webSession.cookies.get({ url: secure.transport.origin });
    assert.ok(cookies.some(cookie => cookie.name.startsWith('redeven_local_access') && cookie.secure && cookie.httpOnly));
    assert.equal(await secure.window.webContents.executeJavaScript('window.isSecureContext'), true);
    cases.push('stable logical HTTPS origin, MFA and secure HttpOnly cookie without global certificate exceptions');
    const runtimeVerification = readFileSync(path.join(output, 'runtime-browser.js'), 'utf8');
    cases.push(...await secure.window.webContents.executeJavaScript(`${runtimeVerification}\nGatewayAcceptance.verifyRuntimeServices()`));
    const forward = await call(secure, '/_redeven_proxy/api/forwards', { target: fixture.webService, name: 'Gateway web service' });
    assert.equal(forward.status, 200);
    const forwardPath = `/pf/${forward.body.data.forward_id}/`;
    const content = await secure.window.webContents.executeJavaScript(`fetch(${JSON.stringify(forwardPath)}).then(r => r.text())`);
    assert.equal(content, 'Gateway web service qualification');
    const echo = await secure.window.webContents.executeJavaScript(`fetch(${JSON.stringify(forwardPath)}, {method:'POST',body:'private service payload'}).then(r => r.text())`);
    assert.equal(echo, 'private service payload');
    cases.push('Runtime-owned Web Service and port forwarding preserve request and response bodies');
    const space = await call(secure, '/_redeven_proxy/api/spaces', { path: fixture.workspace, name: 'Gateway editor' });
    assert.equal(space.status, 200);
    const spaceID = space.body.data.code_space_id;
    const started = await call(secure, `/_redeven_proxy/api/spaces/${spaceID}/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const nativeLifetime = new AbortController();
    const base = secure.transport.origin;
    const native = createNativeFixtureWindow({ identity: createHash('sha256').update(spaceID).digest('hex'), profileFile: path.join(fixture.state, 'native-profiles.json'), show: true, route: () => createLocalNativeCodeSpaceRoute({
      transport: { kind: 'gateway_member', baseURL: base, allowedBaseURL: base, entryURL: base, displayURL: base, proxyPolicy: 'gateway', partition: 'gateway-editor-fixture' },
      startup: secure.startup, webSession: secure.webSession, codeSpaceID: spaceID, signal: nativeLifetime.signal, connectionAgent: secure.transport.agent,
    }) });
    windows.push(native.window);
    native.window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Gateway editor:', event.message); });
    try {
      await native.owner.showLoading({});
      await native.owner.open();
      assert.equal(native.ready, true);
      await native.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Gateway editor workbench unavailable: '+document.body.innerText.slice(0,1500))),20000);const check=()=>{for(const button of document.querySelectorAll('button'))if(button.innerText.includes('Yes, I trust'))button.click();if(document.querySelector('.monaco-workbench') && document.body.innerText.includes('gateway-member.txt')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`);
      const point = await native.window.webContents.executeJavaScript(`(()=>{const label=Array.from(document.querySelectorAll('.label-name')).find(e=>e.textContent==='gateway-member.txt');if(!label)throw new Error('Missing workspace file');const r=label.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      native.window.focus();
      native.window.webContents.focus();
      native.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 2, ...point });
      native.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 2, ...point });
      await native.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Gateway editor file unavailable')),10000);const check=()=>{if(document.querySelector('.monaco-editor .view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('Gateway editor qualification')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`);
      const editorPoint = await native.window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.monaco-editor .view-lines').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10)}})()`);
      native.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...editorPoint });
      native.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...editorPoint });
      await native.window.webContents.insertText('Saved through Gateway ');
      const modifiers = [process.platform === 'darwin' ? 'meta' as const : 'control' as const];
      native.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers });
      native.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers });
      const deadline = Date.now() + 10_000;
      while (!readFileSync(path.join(fixture.workspace, 'gateway-member.txt'), 'utf8').includes('Saved through Gateway ')) {
        if (Date.now() > deadline) throw new Error('Gateway editor did not save the Runtime workspace file');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      cases.push('real CodeSpace editor opens and saves workspace files over member TLS and WebSocket');
    } catch (error) { await writeFile(path.join(output, 'editor-failure.png'), (await native.window.webContents.capturePage()).toPNG()); throw error; } finally { nativeLifetime.abort(); await native.owner.close(true); }

    for (const route of ['/v2/gateway/status', '/v2/runtime/access', '/v2/runtime/stop']) {
      const code = await secure.window.webContents.executeJavaScript(`fetch(${JSON.stringify(route)}, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}).then(r => r.status)`);
      assert.equal(code, 404);
    }
    cases.push('member reverse stream cannot reach trusted Runtime management');
    const incorrect = session.fromPartition(`gateway-incorrect-certificate:${randomUUID()}`);
    await prepareGatewayMemberPartition(incorrect, { ...secure.transport, service: { ...secure.transport.service, certificate_sha256: '0'.repeat(64) } });
    const rejected = new BrowserWindow({ show: false, webPreferences: { session: incorrect, contextIsolation: true, sandbox: true } });
    windows.push(rejected);
    await assert.rejects(rejected.loadURL(`${secure.transport.origin}/api/local/health`));
    cases.push('production partition verifier rejects a different Runtime certificate');
    const member = catalog.members.find(member => member.member_id === fixture.plainMember)!;
    await assert.rejects(client.removeMember(record, member.member_id, member.member_version), { code: 'HOST_MANAGEMENT_REQUIRED' });
    const removal = await fetch(new URL('gateway/v5/members/remove', fixture.gateway), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Redeven-Gateway-Host-Token': fixture.hostToken }, body: JSON.stringify({ protocol_version: 'redeven-gateway-v5', member_id: member.member_id, expected_member_version: member.member_version }) });
    assert.equal(removal.status, 200);
    await assert.rejects(prepareGatewayEnvironmentAccess(record, member, catalog, client));
    assert.equal((await client.catalog(record)).members.length, 1);
    assert.equal(await unlocked(secure), true);
    cases.push('member removal rejects new access while other members keep serving');
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', cases }, null, 2));
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await Promise.all(transports.map(closeGatewayMemberTransport));
  }
  app.exit(0);
}).catch(error => { console.error('Gateway qualification failed:', redactGatewayDiagnosticValue(error instanceof Error ? error.stack : String(error))); app.exit(1); });
