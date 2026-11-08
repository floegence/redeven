import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDesktopTestSession, processIdentity, sameProcess } from '../../scripts/desktop_test_session.mjs';
import { waitFor } from '../../scripts/smoke_desktop_plugins.mjs';
import { selectSurface, createSession, sendTerminalCommand } from '../../internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 240000 });
await session.run(async () => {
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const root = path.resolve(desktop, '..');
  const require = createRequire(path.join(desktop, 'package.json'));
  const { _electron } = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'))('playwright');
  const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
  assert.ok(bundle && path.isAbsolute(bundle), 'Select a verified published-source development bundle');
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const directory = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-author-restart-')));
  const evidence = path.resolve(process.env.REDEVEN_PLUGIN_RESTART_REPORT_DIR ?? path.join(desktop, 'dist/plugin-author-restart'));
  await mkdir(evidence, { recursive: true });
  await session.target(path.join(bundle, 'redeven'), path.join(directory, 'state'));
  const home = path.join(directory, 'home');
  const environment = path.join(directory, 'state/local-environment');
  await mkdir(environment, { recursive: true });
  await mkdir(home);
  await writeFile(path.join(environment, 'config.json'), JSON.stringify({
    runtime_config_version: 1, agent_home_dir: home, shell: '/bin/sh',
    permission_policy: { schema_version: 1, local_max: { read: true, write: true, execute: true } },
  }), { mode: 0o600 });
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  await session.port(port);
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
  const application = await session.launchElectron(_electron, {
    executablePath: require('electron'), args: [desktop, `--user-data-dir=${directory}/profile`], cwd: directory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_STATE_ROOT: path.join(directory, 'state'), REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(directory, 'profile'),
      REDEVEN_DESKTOP_CACHE_ROOT: path.join(directory, 'cache'), REDEVEN_DESKTOP_TEMP_ROOT: path.join(directory, 'temp'),
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
      REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${port}`, REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle,
      REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
    },
  });
  const report = { status: 'running', scope: 'Production Desktop, verified runtime, real terminal child and persisted author draft', bundle: manifest, assertions: [] };
  let page;
  try {
    const context = application.context();
    await context.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
    const welcome = await waitFor(() => context.pages().find((entry) => entry.url().includes('/welcome/')), 60000, 'Desktop welcome');
    const open = async (activeDraft = false) => {
      await welcome.getByRole('button', { name: /^((Open|Show) window|(打开|显示)窗口)$/ }).first().click({ timeout: 60000 });
      const target = await waitFor(() => context.pages().find((entry) => entry.url().includes('/_redeven_proxy/env/')), 30000, 'Desktop environment window');
      target.setDefaultTimeout(30000);
      if (activeDraft) await target.locator('[data-plugin-creation-workspace]').waitFor();
      else await target.getByRole('tab', { name: 'Activity', exact: true }).waitFor();
      return target;
    };
    page = await open();
    const assertInventory = async () => {
      let credential;
      const observe = async (request) => {
        if (new URL(request.url()).pathname === '/api/local/plugin/session/ready') credential = (await request.allHeaders())['x-redeven-plugin-session'];
      };
      page.on('request', observe);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(() => credential, 30000, 'fresh product plugin session');
      const result = await page.evaluate(async (credential) => {
        const response = await fetch('/_redevplugin/api/plugins/catalog/query', { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-redevplugin-csrf': 'redeven-env-v1', 'x-redeven-plugin-session': credential }, body: '{}' });
        return { status: response.status, body: await response.json() };
      }, credential);
      page.off('request', observe);
      assert.equal(result.status, 200, JSON.stringify(result));
      await page.getByRole('tab', { name: 'Activity', exact: true }).click();
      await page.locator('[aria-controls="redeven-plugin-switcher"]').filter({ visible: true }).first().click();
      const panel = page.locator('#redeven-plugin-switcher');
      await panel.waitFor();
      assert.doesNotMatch(await panel.innerText(), /Plugins are unavailable|插件暂不可用/);
      await page.locator('[data-plugin-center-market-action]').click();
      await page.locator('[data-plugin-center-view]').waitFor();
    };
    const readComposerStorage = async () => page.evaluate(async () => {
      const databases = await indexedDB.databases();
      if (!databases.some(item => item.name === 'redeven-plugin-composer')) return { origin: location.origin, drafts: [] };
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('redeven-plugin-composer'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction('drafts', 'readonly'); const store = transaction.objectStore('drafts');
          const keys = store.getAllKeys(); const values = store.getAll();
          transaction.oncomplete = () => resolve({ origin: location.origin, drafts: keys.result.map((key, index) => ({ key, scope: values.result[index]?.scope_id, text: values.result[index]?.value?.text })) });
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { db.close(); }
    });
    await assertInventory();
    await page.locator('[data-plugin-center-create-plugin]').click();
    const workspace = page.locator('[data-plugin-creation-workspace]');
    await workspace.locator('textarea').first().fill('Keep this author draft across the Runtime restart.');
    await waitFor(() => workspace.getAttribute('data-project-id').then((id) => /^draft_/.test(id ?? '') && id), 30000, 'persisted author draft');
    const draft = await workspace.getAttribute('data-project-id');
    report.draft = draft;
    await page.getByRole('button', { name: 'Back to creation history', exact: true }).click();
    report.beforeRestartStorage = await readComposerStorage();
    const terminal = await selectSurface(page, 'panel');
    await createSession(page, terminal);
    const childScript = path.join(directory, 'surviving-child.cjs');
    const childPID = path.join(directory, 'child.pid');
    await writeFile(childScript, `process.on('SIGHUP',()=>{});require('fs').writeFileSync(${JSON.stringify(childPID)},String(process.pid));setInterval(()=>{},1000);`);
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    await sendTerminalCommand(page, `nohup ${quote(process.execPath)} ${quote(childScript)} >/dev/null 2>&1 &`, terminal);
    const pid = await waitFor(async () => Number(await readFile(childPID, 'utf8').catch(() => '')) || false, 10000, 'terminal child process');
    const identity = processIdentity(pid);
    assert.ok(identity);
    report.childPID = pid;
    await session.command('Stop surviving acceptance child', process.execPath, ['--input-type=module', '-e',
      `import { stopOwnedProcess } from ${JSON.stringify(new URL('../../scripts/desktop_test_session.mjs', import.meta.url).href)}; await stopOwnedProcess({ identity: ${JSON.stringify(identity)}, group: false });`]);
    const restart = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'restart_environment_runtime', environment_id: 'local' }));
    assert.equal(restart.ok, true, JSON.stringify(restart));
    assert.equal(restart.outcome, 'restarted_environment_runtime');
    assert.ok(sameProcess(identity, processIdentity(pid)), 'The terminal child must survive the actual Runtime restart');
    page = await open();
    report.afterRestartStorage = await readComposerStorage();
    await assertInventory();
    report.afterReloadStorage = await readComposerStorage();
    assert.ok(sameProcess(identity, processIdentity(pid)), 'Inventory recovery must not depend on the child exiting');
    report.assertions.push('Plugin inventory and launcher remain available after Runtime restart with a surviving terminal child');
    await page.locator('[data-plugin-center-drafts]').click();
    await page.locator('[data-plugin-history-entry="' + draft + '"]').click();
    await waitFor(() => page.locator('[data-plugin-creation-workspace]').getAttribute('data-project-id').then((id) => id === draft), 30000, 'same retained author draft');
    await waitFor(() => page.locator('[data-plugin-creation-workspace] textarea').first().inputValue().then((value) => value === 'Keep this author draft across the Runtime restart.'), 30000, 'asynchronously restored composer draft');
    assert.equal(await page.locator('[data-plugin-creation-workspace] textarea').first().inputValue(), 'Keep this author draft across the Runtime restart.');
    report.assertions.push('The same managed author workspace reopens after restart without deleting state');
    const edited = 'Keep the latest edit while this canvas is still open.';
    await page.locator('[data-plugin-creation-workspace] textarea').first().fill(edited);
    const activeRestart = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'restart_environment_runtime', environment_id: 'local' }));
    assert.equal(activeRestart.ok, true, JSON.stringify(activeRestart));
    assert.equal(activeRestart.outcome, 'restarted_environment_runtime');
    page = await open(true);
    await waitFor(() => page.locator('[data-plugin-creation-workspace] textarea').first().inputValue().then(value => value === edited), 30000, 'active draft restored without navigating away');
    assert.equal(await page.locator('[data-plugin-creation-workspace]').getAttribute('data-project-id'), draft);
    await page.locator('[data-plugin-creation-workspace] [role="status"]').filter({ hasText: /^Saved$/ }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => page.locator('[data-plugin-creation-workspace] textarea').first().inputValue().then(value => value === edited), 30000, 'restored draft retained after document reload');
    await page.locator('[data-plugin-creation-workspace] [role="status"]').filter({ hasText: /^Saved$/ }).waitFor();
    assert.ok(sameProcess(identity, processIdentity(pid)), 'The same terminal child survives both restarts');
    report.assertions.push('An active canvas saves its latest edit before restart, returns to the same draft and survives a subsequent reload');
    await page.screenshot({ path: path.join(evidence, 'desktop-author-restarted.png') });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    report.pageText = await page?.locator('body').innerText().catch(() => null);
    const diagnostics = page?.getByRole('button', { name: 'View diagnostics', exact: true });
    if (await diagnostics?.isVisible().catch(() => false)) {
      await diagnostics.click();
      report.readinessDiagnostics = await page.locator('body').innerText();
    }
    report.runtimeLogs = [];
    for (const entry of await readdir(path.join(directory, 'temp'), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith('redeven-desktop-')) continue;
      const stderr = await readFile(path.join(directory, 'temp', entry.name, 'stderr.log'), 'utf8').catch(() => null);
      if (stderr !== null) report.runtimeLogs.push({ runtime: entry.name, stderr });
    }
    await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await session.writeEvidence(path.join(evidence, 'report.json'), report);
    await session.closeElectron(application);
  }
});
