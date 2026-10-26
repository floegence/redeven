import { chooseGatewayPicker } from './gateway-picker-test-helpers.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession, bounded } from '../../scripts/desktop_test_session.mjs';

const desktop = path.resolve(import.meta.dirname, '..');
const repository = path.dirname(desktop);
const require = createRequire(import.meta.url);
const { createDesktopSecretCodec } = require('../dist/main/developmentSecretStorage.js');
const { defaultDesktopPreferences, defaultDesktopPreferencesPaths, saveDesktopPreferences } = require('../dist/main/desktopPreferences.js');
const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
assert.ok(bundle, 'Set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT to a real development bundle');
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const output = path.join(desktop, 'dist/gateway-enrollment-acceptance');
await mkdir(output, { recursive: true });
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 360000 });
await session.run(async () => {
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-gateway-enrollment-')));
  const marker = 'rdi-gateway-enrollment-qualification';
  const gatewayID = 'enrollment-qualification';
  const gatewayRoot = path.join(state, 'gateway-host');
  const gatewayState = path.join(gatewayRoot, 'gateways', gatewayID, 'state');
  const gatewayBinary = path.join(gatewayState, 'managed/bin/redeven-gateway');
  await mkdir(path.dirname(gatewayBinary), { recursive: true });
  const historicalBinary = process.env.REDEVEN_TEST_GATEWAY_BINARY;
  if (historicalBinary) await copyFile(historicalBinary, gatewayBinary);
  else execFileSync(path.join(repository, 'scripts/build_runtime_binary.sh'), [
    '--goos', process.platform, '--goarch', process.arch === 'x64' ? 'amd64' : process.arch,
    '--output', gatewayBinary, '--command', './cmd/redeven-gateway', '--version', manifest.version,
    '--commit', manifest.commit, '--build-time', new Date().toISOString(),
  ], { cwd: repository, stdio: 'inherit', timeout: 120000, env: { ...process.env, GOWORK: 'off' } });
  const versionOutput = execFileSync(gatewayBinary, ['version'], { encoding: 'utf8' }).trim();
  const version = /^redeven-gateway (\S+) \(([^)]+)\)/u.exec(versionOutput);
  assert.ok(version, 'Gateway must report its own real build identity');
  const gatewayVersion = version[1], gatewayCommit = version[2];
  if (historicalBinary) assert.notEqual(gatewayCommit, manifest.commit, 'Cross-version qualification needs distinct real builds');
  const binaryHash = createHash('sha256').update(await readFile(gatewayBinary)).digest('hex');
  const stampPath = path.join(gatewayState, 'managed/managed-gateway.stamp');
  const stamp = 'schema_version=3\ninstalled_by=redeven-desktop\nslot_release_tag=' + gatewayVersion + '\nsource_commit=' + gatewayCommit + '\n';
  await writeFile(stampPath, stamp);
  await session.command('Stop isolated Gateway', gatewayBinary, ['service-stop', '--state-root', gatewayState]);
  const started = JSON.parse(execFileSync(gatewayBinary, ['service-start', '--state-root', gatewayState, '--member-listen', '127.0.0.1:0'], { encoding: 'utf8' }));
  console.log('Real Gateway started', { pid: started.pid });
  const userDataRoot = path.join(state, 'desktop/user-data');
  const codec = createDesktopSecretCodec({ isPackaged: false, developmentInstanceID: marker, stateRoot: state, userDataRoot, safeStorage: null });
  const defaults = defaultDesktopPreferences();
  const preferences = { ...defaults, local_environment: { ...defaults.local_environment,
    local_hosting: { ...defaults.local_environment.local_hosting, access: { ...defaults.local_environment.local_hosting.access,
      local_ui_password: 'qualification-only-local-password', local_ui_password_configured: true } } } };
  await saveDesktopPreferences(defaultDesktopPreferencesPaths(userDataRoot, { stateRoot: state }), preferences, codec);
  await session.target(path.join(bundle, 'redeven'), state);
  const application = await session.launchElectron(_electron, {
    executablePath: electron, args: [desktop, '--redeven-dev-instance=' + marker], cwd: desktop, timeout: 30000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, GOWORK: 'off', REDEVEN_STATE_ROOT: state,
      REDEVEN_DESKTOP_USER_DATA_ROOT: userDataRoot, REDEVEN_DESKTOP_CACHE_ROOT: path.join(state, 'desktop/cache'),
      REDEVEN_DESKTOP_TEMP_ROOT: path.join(state, 'desktop/temp'), REDEVEN_DESKTOP_DEV_INSTANCE_ID: marker,
      REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
      REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
      REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT: repository },
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.redevenDesktopLauncher));
  await page.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
  const action = request => page.evaluate(request => window.redevenDesktopLauncher.performAction(request), request);
  const snapshot = () => page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
  await bounded(async () => { while (true) { const value = await snapshot();
    if (value.environments.some(entry => entry.id === 'local' && entry.runtime_health?.runtime_service?.open_readiness?.state === 'openable')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  } }, 90000, 'Real Runtime readiness');
  console.log('Real Runtime ready');
  const saved = await action({ kind: 'upsert_gateway', gateway_id: gatewayID, display_name: 'Empty-address Gateway', connection_kind: 'local_host',
    host_access: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: gatewayRoot } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const paired = await action({ kind: 'pair_gateway', gateway_id: gatewayID });
  assert.equal(paired.ok, true, JSON.stringify(paired));
  const source = await bounded(async () => { while (true) { const value = (await snapshot()).gateway_sources.find(value => value.gateway_id === gatewayID);
    if (value?.permissions?.manage_members && value.active_listener_addresses?.length) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  } }, 30000, 'Paired empty-address Gateway catalog');
  assert.deepEqual(source.member_endpoints, []);
  const before = JSON.parse(await readFile(path.join(gatewayState, 'members.json'), 'utf8'));
  const origin = 'https://' + source.active_listener_addresses[0];
  console.log('Real saved Gateway has no endpoints', { gatewayID, origin });
  const owner = page.locator('[data-owner-id="local"]');
  await owner.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Gateway access', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect and continue', exact: true }).click();
  const picker = dialog.locator('[data-gateway-picker]');
  await chooseGatewayPicker(picker, source.display_name);
  await dialog.locator('[data-gateway-endpoint-draft]').waitFor();
  await dialog.screenshot({ path: path.join(output, 'empty-address.png') });
  await dialog.locator('[data-gateway-endpoint-draft]').fill(origin);
  await dialog.getByRole('button', { name: 'Save connection address', exact: true }).click();
  await dialog.locator('[data-gateway-selected-address]').waitFor();
  assert.equal(await dialog.locator('[data-gateway-selected-address]').innerText(), origin);
  const persisted = JSON.parse(await readFile(path.join(gatewayState, 'members.json'), 'utf8'));
  assert.deepEqual(persisted.advertised_endpoints.map(endpoint => endpoint.address), [origin]);
  assert.deepEqual(persisted.listen_addresses, before.listen_addresses);
  assert.deepEqual(persisted.allowed_hosts, before.allowed_hosts);
  assert.equal((await snapshot()).gateway_sources.find(value => value.gateway_id === gatewayID).environments.length, 0);
  await dialog.getByRole('button', { name: 'Generate invitation code', exact: true }).click();
  await page.waitForFunction(() => { const input = document.querySelector('input[autocomplete="off"]:not([placeholder])'); return input?.value.length === 26; });
  await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm and enable', exact: true }).waitFor();
  assert.equal((await snapshot()).gateway_sources.find(value => value.gateway_id === gatewayID).environments.length, 0);
  await dialog.screenshot({ path: path.join(output, 'verified-before-consent.png') });
  await dialog.getByRole('button', { name: 'Confirm and enable', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await action({ kind: 'refresh_gateway', gateway_id: gatewayID });
  const joined = await bounded(async () => { while (true) {
    await action({ kind: 'refresh_gateway', gateway_id: gatewayID });
    const value = (await snapshot()).gateway_sources.find(value => value.gateway_id === gatewayID);
    if (value?.environments?.some(member => member.connected)) return value;
    console.log('Observed member state', value?.environments.map(member => ({state:member.state,connected:member.connected})));
    await new Promise(resolve => setTimeout(resolve, 1000));
  } }, 30000, 'Runtime joined and connected to the real Gateway');
  assert.equal(joined.environments.length, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'connected.png') });
  await page.getByRole('button', { name: 'Gateways', exact: true }).click();
  const gatewayCard = page.locator('[data-gateway-id="enrollment-qualification"]');
  await gatewayCard.waitFor();
  assert.ok(!(await gatewayCard.innerText()).includes('Gateway update required'));
  await gatewayCard.screenshot({ path: path.join(output, 'compatible-gateway.png') });
  const finalService = JSON.parse(execFileSync(gatewayBinary, ['service-status', '--state-root', gatewayState], { encoding: 'utf8' }));
  assert.equal(finalService.pid, started.pid, 'Pairing, refresh and enrollment must not restart a compatible Gateway');
  assert.equal(createHash('sha256').update(await readFile(gatewayBinary)).digest('hex'), binaryHash);
  assert.equal(await readFile(stampPath, 'utf8'), stamp);
  assert.equal(joined.service_state.status, 'ready');
  assert.equal(joined.status, 'online');
  await session.closeElectron(application);
  await session.writeEvidence(path.join(output, 'report.json'), { scenarioStatus: 'passed', runtimeCommit: manifest.commit, gatewayCommit, gatewayVersion,
    gatewayPIDUnchanged: finalService.pid === started.pid, gatewayBinaryUnchanged: true,
    cases: ['Existing Gateway stays online across pairing, refresh and Runtime enrollment without update or restart',
      'Actual Desktop main and renderer display a paired Gateway with no advertised addresses',
      'Wizard endpoint save persists to the real Gateway without replacing listener settings',
      'Gateway issues a real invitation; Runtime verifies it before membership exists',
      'Explicit confirmation creates one connected Runtime member'], errors });
  console.log('PASS real Desktop, Gateway and Runtime enrollment from an empty-address registration');
});
