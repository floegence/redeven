import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { installInspectedPackage, waitFor } from '../../scripts/smoke_desktop_plugins.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 300000 });
await session.run(async () => {
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const root = path.resolve(desktop, '..');
  const require = createRequire(path.join(desktop, 'package.json'));
  const { _electron } = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'))('playwright');
  const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
  assert.ok(bundle && path.isAbsolute(bundle), 'Select a verified published-source development bundle');
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const directory = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-plugin-storage-')));
  const fixtureRoot = path.join(directory, 'fixture');
  const evidence = path.resolve(process.env.REDEVEN_PLUGIN_STORAGE_REPORT_DIR ?? path.join(desktop, 'dist/plugin-storage-recovery'));
  await mkdir(evidence, { recursive: true });
  execFileSync('go', ['test', './internal/redevpluginintegration', '-run', '^TestSeedDesktopPluginRelocation$', '-count=1', '-v'], {
    cwd: root, stdio: 'inherit', timeout: 90000,
    env: { ...process.env, GOWORK: 'off', REDEVEN_PLUGIN_RELOCATION_FIXTURE: fixtureRoot, REDEVEN_TEST_PLUGIN_RUNTIME: path.join(bundle, 'redevplugin-runtime') },
  });
  const fixture = JSON.parse(await readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  const stateRoot = path.join(fixtureRoot, 'state');
  const environment = path.join(stateRoot, 'local-environment');
  await session.target(path.join(bundle, 'redeven'), stateRoot);
  const home = path.join(directory, 'home');
  await mkdir(home);
  await writeFile(path.join(environment, 'config.json'), JSON.stringify({
    runtime_config_version: 1, agent_home_dir: home, shell: '/bin/sh',
    permission_policy: { schema_version: 1, local_max: { read: true, write: true, execute: true } },
  }), { mode: 0o600 });
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await session.port(port);
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
  const application = await session.launchElectron(_electron, {
    executablePath: require('electron'), args: [desktop, `--user-data-dir=${directory}/profile`], cwd: directory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_STATE_ROOT: stateRoot, REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(directory, 'profile'),
      REDEVEN_DESKTOP_CACHE_ROOT: path.join(directory, 'cache'), REDEVEN_DESKTOP_TEMP_ROOT: path.join(directory, 'temp'),
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
      REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${port}`, REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle,
      REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
    },
  });
  const report = { status: 'running', scope: 'Native Desktop; published runtime and worker; legacy state created through owner APIs; real sandbox, update and restart', bundle: manifest, assertions: [] };
  let page, credential;
  const phase = value => { report.phase = value; console.log(`[plugin-storage] ${value}`); };
  try {
    const context = application.context();
    await context.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
    context.on('request', async request => {
      if (new URL(request.url()).pathname === '/api/local/plugin/session/ready') credential = (await request.allHeaders())['x-redeven-plugin-session'];
    });
    const welcome = await waitFor(() => context.pages().find(entry => entry.url().includes('/welcome/')), 60000, 'Desktop welcome');
    const open = async () => {
      await welcome.getByRole('button', { name: /^((Open|Show) window|(打开|显示)窗口)$/ }).first().click({ timeout: 60000 });
      page = await waitFor(() => context.pages().find(entry => entry.url().includes('/_redeven_proxy/env/')), 30000, 'Desktop environment');
      page.setDefaultTimeout(30000);
      await waitFor(() => credential, 30000, 'authenticated plugin session');
      return page;
    };
    const request = async (pathname, body = {}) => {
      const result = await page.evaluate(async ({ pathname, body, credential }) => {
        const response = await fetch(pathname, { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-redevplugin-csrf': 'redeven-env-v1', 'x-redeven-plugin-session': credential }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }, { pathname, body, credential });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.ok, true, JSON.stringify(result));
      return result.body.data;
    };
    const inventory = () => request('/_redevplugin/api/plugins/catalog/query');
    const current = async () => (await inventory()).plugins.find(item => item.plugin_instance_id === fixture.plugin_instance_id);
    phase('Reproduce unavailable plugins on retained legacy storage');
    await open();
    await assert.rejects(inventory, /PLUGIN_RUNTIME_UNAVAILABLE/);
    await page.screenshot({ path: path.join(evidence, 'before-recovery.png') });
    report.assertions.push('The real Desktop reproduces PLUGIN_RUNTIME_UNAVAILABLE with legacy storage');
    phase('Stop the isolated Runtime and relocate opaque bytes');
    const stopped = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'stop_environment_runtime', environment_id: 'local' }));
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    const relocated = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/relocate_prerelease_storage.py'), '--state-dir', environment, '--apply'], { encoding: 'utf8' }));
    assert.equal(relocated.status, 'complete');
    report.relocatedEntries = relocated.operations.map(item => item.source);
    execFileSync('python3', [path.join(root, 'scripts/relocate_prerelease_storage.py'), '--state-dir', environment, '--check-plugins']);
    credential = undefined;
    const started = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'start_environment_runtime', environment_id: 'local' }));
    assert.equal(started.ok, true, JSON.stringify(started));
    await open();
    let installed = await current();
    assert.equal(installed.package_hash, fixture.package_sha256);
    assert.equal(installed.enable_state, 'enabled');
    report.assertions.push('Offline relocation preserves the exact installed instance and package');
    const launchWorker = async () => {
      await page.getByRole('tab', { name: 'Activity', exact: true }).filter({ visible: true }).click();
      await page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first().click();
      await page.locator('[data-plugin-panel-tile]').filter({ hasText: 'Retained worker' }).first().click();
      const host = page.locator('[data-plugin-surface-host]').filter({ visible: true }).last();
      await waitFor(() => host.getAttribute('data-surface-instance-id').catch(() => null), 40000, 'real plugin surface');
      const frame = host.frameLocator('iframe');
      await frame.getByRole('button', { name: 'Send to worker', exact: true }).waitFor();
      assert.notEqual(new URL(await host.locator('iframe').getAttribute('src')).hostname, new URL(page.url()).hostname);
      return frame;
    };
    phase('Execute a real WASM worker through the sandbox bridge');
    let frame = await launchWorker();
    const echo = async (frame, value) => {
      await frame.getByLabel('Message', { exact: true }).fill(value);
      await frame.getByRole('button', { name: 'Send to worker', exact: true }).click();
      await frame.getByText(value, { exact: true }).waitFor();
      await frame.getByText('Answered by backend', { exact: true }).waitFor();
    };
    await echo(frame, 'Retained plugin executes after relocation');
    report.assertions.push('Published Rust runtime executes the retained WASM worker over the real sandbox bridge');
    await page.screenshot({ path: path.join(evidence, 'worker-restored.png') });
    phase('Inspect and update the same installed plugin');
    const bytes = (await readFile(path.join(fixtureRoot, 'update.redevplugin'))).toString('base64');
    installed = await current();
    const inspected = await page.evaluate(async ({ credential, bytes, installed }) => {
      const response = await fetch(`/_redevplugin/api/plugins/${installed.plugin_instance_id}/external-packages/upload/inspect`, { method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/vnd.redevplugin.package+zip', 'x-redevplugin-csrf': 'redeven-env-v1', 'x-redeven-plugin-session': credential, 'x-redevplugin-expected-management-revision': String(installed.management_revision), 'x-redevplugin-allow-source-change': 'true' },
        body: Uint8Array.from(atob(bytes), value => value.charCodeAt(0)) });
      return { status: response.status, body: await response.json() };
    }, { credential, bytes, installed });
    assert.equal(inspected.status, 200, JSON.stringify(inspected));
    await installInspectedPackage(request, inspected.body.data);
    assert.equal((await current()).version, '0.2.0');
    report.assertions.push('Exact-byte inspected update commits version 0.2.0 to the original instance');
    phase('Restart Desktop Runtime and recheck worker and creation history');
    credential = undefined;
    const restarted = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'restart_environment_runtime', environment_id: 'local' }));
    assert.equal(restarted.ok, true, JSON.stringify(restarted));
    await open();
    assert.equal((await current()).version, '0.2.0');
    frame = await launchWorker();
    await echo(frame, 'Updated plugin survives Runtime restart');
    phase('Disable and explicitly re-enable the retained plugin');
    installed = await current();
    await request('/_redevplugin/api/plugins/disable', {
      plugin_instance_id: installed.plugin_instance_id, expected_management_revision: installed.management_revision, reason: 'user_disabled',
    });
    installed = await current();
    assert.equal(installed.enable_state, 'disabled_by_user');
    // Use the user-facing action so the ordinary coordinator owns both the
    // mutation and its inventory refresh, just as in an actual retained window.
    await page.getByRole('button', { name: 'Enable plugin', exact: true }).click();
    await waitFor(async () => (await current()).enable_state === 'enabled', 30000, 'explicit re-enable');
    const restoredHost = page.locator('[data-plugin-surface-host]').filter({ visible: true }).last();
    frame = restoredHost.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Send to worker', exact: true }).waitFor();
    await echo(frame, 'Explicitly re-enabled worker executes');
    report.assertions.push('Disable revokes execution and explicit re-enable restores the retained surface');
    await page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first().click();
    await page.locator('[data-plugin-center-market-action]').click();
    await page.locator('[data-plugin-center-drafts]').click();
    await page.locator(`[data-plugin-history-entry="${fixture.draft_id}"]`).click();
    await waitFor(() => page.locator('[data-plugin-creation-workspace]').getAttribute('data-project-id').then(value => value === fixture.draft_id), 30000, 'retained author workspace');
    await page.screenshot({ path: path.join(evidence, 'author-restored.png') });
    report.assertions.push('Restart retains the updated worker, author workspace and creation history');
    phase('Uninstall only the isolated acceptance plugin');
    installed = await current();
    await request('/_redevplugin/api/plugins/uninstall', {
      plugin_instance_id: installed.plugin_instance_id, expected_management_revision: installed.management_revision, delete_data: true,
    });
    assert.equal(await current(), undefined);
    report.assertions.push('Explicit uninstall removes the isolated plugin from authoritative inventory');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await session.writeEvidence(path.join(evidence, 'report.json'), report);
    await session.closeElectron(application);
  }
});
