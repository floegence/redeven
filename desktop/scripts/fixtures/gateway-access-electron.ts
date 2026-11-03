import http from 'node:http';
import { decodeGatewayClientAccessPackage } from '../../src/main/gatewayClientAccess';
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
import { prepareRuntimeAttachmentPartition, closeRuntimeAttachmentTransport } from '../../src/main/gatewayMemberPartition';
import type { RuntimeAttachmentTransport } from '../../src/main/gatewayMemberTransport';
import { createGatewayPairingMaterial, pairingChallengeRequestWithCode, buildPairingCompleteRequest,
  assertGatewayPairingCompleteResponse, completeGatewayPairing } from '../../src/main/gatewayTrust';
import type { GatewayRecord } from '../../src/main/gatewayStore';

const fixture = JSON.parse(readFileSync(process.env.REDEVEN_GATEWAY_FIXTURE!, 'utf8'));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const cases: string[] = [];
  const windows: BrowserWindow[] = [];
  const transports: RuntimeAttachmentTransport[] = [];
  const output = process.env.REDEVEN_GATEWAY_OUTPUT!;
  const secrets = new Map<string, string>();
  const secretStore = { writeSecret: (key: string, value: string) => { secrets.set(key, value); },
    readSecret: (key: string) => secrets.get(key) ?? '', deleteSecret: (key: string) => { secrets.delete(key); } };
  const client = new GatewayClient(secretStore);
  let record: GatewayRecord = { schema_version: 5, connection_id: 'pending', display_name: 'Qualification Gateway', local_enabled: true,
    connection: { kind: 'url', base_url: fixture.gateway, allow_loopback_http: false }, created_at_ms: 1, updated_at_ms: 1 };
  const access = decodeGatewayClientAccessPackage(fixture.accessCode);
  const material = createGatewayPairingMaterial(record);
  const challenge = await client.pairingChallenge(record, pairingChallengeRequestWithCode(material, access.access_code), {tlsRootPEM: access.tls_root_pem});
  assert.equal(challenge.gateway_id, access.gateway_id);
  assert.equal(challenge.gateway_public_key.trim(), access.gateway_public_key.trim());
  const completed = await client.completePairing(record, buildPairingCompleteRequest(material, challenge), {tlsRootPEM: access.tls_root_pem});
  assertGatewayPairingCompleteResponse(material, challenge, completed);
  record = { ...record, trust_profile: { ...await completeGatewayPairing({ record, material, challenge, trust_accepted: true, secret_store: secretStore }), tls_root_pem: access.tls_root_pem } };
  const catalog = await client.catalog(record);
  assert.equal(catalog.attachments.length, 2);
  assert.ok(catalog.attachments.every(member => member.connected));
  cases.push('v6 client enrollment and automatic directory from two outbound Runtime members without Cloud');
  const open = async (memberID: string) => {
    const member = catalog.attachments.find(member => member.attachment_id === memberID)!;
    const access = await prepareGatewayEnvironmentAccess(record, member, catalog, client);
    transports.push(access.transport);
    const webSession = session.fromPartition(`gateway-qualification:${randomUUID()}`);
    await prepareRuntimeAttachmentPartition(webSession, access.transport);
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
    if (process.env.REDEVEN_PLUGIN_WEB_QUALIFICATION === '1') {
      const pluginBrowser = readFileSync(path.join(output, 'plugin-web.js'), 'utf8');
      const packageBytes = readFileSync(path.join(output, 'web-application.redevplugin')).toString('base64');
      cases.push(...await secure.window.webContents.executeJavaScript(`${pluginBrowser}\nPluginWebAcceptance.verifyPluginWebApplication(${JSON.stringify(packageBytes)}, false)`));
    }
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
      app.focus({ steal: true });
      native.window.focus();
      native.window.webContents.focus();
      const editorPoint = await native.window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.part.editor .monaco-editor .view-lines').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10)}})()`);
      native.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...editorPoint });
      native.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...editorPoint });
      await native.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000;let focusedSince=0;const editor=document.querySelector('.part.editor .monaco-editor');const check=()=>{const focused=document.hasFocus() && editor?.contains(document.activeElement);if(focused){if(!focusedSince)focusedSince=Date.now();if(Date.now()-focusedSince>=250){resolve(true);return;}}else{focusedSince=0;editor?.querySelector('textarea.inputarea')?.focus();}if(Date.now()>deadline)reject(new Error('Gateway document editor did not retain focus'));else setTimeout(check,20)};check()})`);
      await native.window.webContents.insertText('Saved through Gateway ');
      await native.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const check=()=>{if(document.querySelector('.part.editor .monaco-editor .view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('Saved through Gateway '))resolve(true);else if(Date.now()>deadline)reject(new Error('Gateway text did not reach the document editor'));else setTimeout(check,20)};check()})`);
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
    await prepareRuntimeAttachmentPartition(incorrect, { ...secure.transport, service: { ...secure.transport.service, certificate_sha256: '0'.repeat(64) } });
    const rejected = new BrowserWindow({ show: false, webPreferences: { session: incorrect, contextIsolation: true, sandbox: true } });
    windows.push(rejected);
    await assert.rejects(rejected.loadURL(`${secure.transport.origin}/api/local/health`));
    cases.push('production partition verifier rejects a different Runtime certificate');
    const member = catalog.attachments.find(member => member.attachment_id === fixture.plainMember)!;
    await assert.rejects(client.removeMember(record, member.attachment_id, member.attachment_version), { code: 'HOST_MANAGEMENT_REQUIRED' });
    await new Promise<void>((resolve,reject)=>{
      const request=http.request({socketPath:fixture.managementSocket,path:'/gateway/v6/attachments/remove',method:'POST',headers:{'Content-Type':'application/json','X-Redeven-Gateway-Host-Token':fixture.hostToken,'X-Redeven-Operation-ID':'qualification-remove-attachment'}},response=>{
        response.resume();response.once('end',()=>response.statusCode===200?resolve():reject(new Error('Host removal failed: '+response.statusCode)));
      });request.once('error',reject);request.end(JSON.stringify({protocol_version:'redeven-gateway-v6',attachment_id:member.attachment_id,expected_attachment_version:member.attachment_version}));
    });
    await assert.rejects(prepareGatewayEnvironmentAccess(record, member, catalog, client));
    assert.equal((await client.catalog(record)).attachments.length, 1);
    assert.equal(await unlocked(secure), true);
    cases.push('member removal rejects new access while other members keep serving');
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'running', scenarioStatus: 'passed', cases }, null, 2));
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await Promise.all(transports.map(closeRuntimeAttachmentTransport));
  }
  app.exit(0);
}).catch(error => { console.error('Gateway qualification failed:', redactGatewayDiagnosticValue(error instanceof Error ? error.stack : String(error))); app.exit(1); });
