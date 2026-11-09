import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { waitFor } from '../../scripts/smoke_desktop_plugins.mjs';

// Actual product, production catalog, default Desktop transfer and Runtime.
// Only this isolated profile and its explicitly created service are mutated.
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 600000 });
await session.run(async () => {
  const desktop = path.resolve(import.meta.dirname, '..');
  const require = createRequire(path.join(desktop, 'package.json'));
  const { _electron } = createRequire(path.join(desktop, '../internal/envapp/ui_src/package.json'))('playwright');
  const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
  const sourceEvidence = process.env.REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE;
  const kind = process.env.REDEVEN_TEMPLATE_DEPLOYMENT_KIND || 'container';
  assert.ok(['host', 'container', 'compose'].includes(kind));
  assert.ok(bundle && sourceEvidence && path.isAbsolute(bundle) && path.isAbsolute(sourceEvidence));
  const evidence = path.join(sourceEvidence, 'product-' + randomUUID());
  await mkdir(evidence);
  console.log('Product evidence', evidence);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  // Public container inspection intentionally redacts macOS /private paths.
  // Use the shared home, matching the native Docker acceptance contract.
  const directory = await session.directory(await mkdtemp(path.join(homedir(), '.redeven-template-product-')));
  const state = path.join(directory, 'state');
  const home = path.join(directory, 'home');
  await mkdir(path.join(state, 'local-environment'), { recursive: true });
  await mkdir(home);
  await writeFile(path.join(state, 'local-environment/config.json'), JSON.stringify({ runtime_config_version: 1, agent_home_dir: home, shell: '/bin/sh', permission_policy: { schema_version: 1, local_max: { read: true, write: true, execute: true } } }), { mode: 0o600 });
  await session.target(path.join(bundle, 'redeven'), state);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await session.port(port);
  const application = await session.launchElectron(_electron, {
    executablePath: require('electron'), args: [desktop, `--user-data-dir=${directory}/profile`], cwd: directory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, GITHUB_TOKEN: undefined, GH_TOKEN: undefined,
      REDEVEN_STATE_ROOT: state, REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(directory, 'profile'),
      REDEVEN_DESKTOP_CACHE_ROOT: path.join(directory, 'cache'), REDEVEN_DESKTOP_TEMP_ROOT: path.join(directory, 'temp'),
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1', REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0', REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${port}`,
      REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle, REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version, REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit },
  });
  const context = application.context();
  await context.addInitScript(() => localStorage.setItem('redeven_ui_language_preference', 'en-US'));
  let page, welcome, opened, serviceID;
  const report = { status: 'running', kind, manifest, token: false, steps: [] };
  const api = async (suffix, method = 'GET', body) => page.evaluate(async ({ suffix, method, body }) => {
    const response = await fetch('/_redeven_proxy/api/managed-web-services' + suffix, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Managed service request ${response.status}: ${JSON.stringify(data)}`);
    return data.data ?? data;
  }, { suffix, method, body });
  const cleanup = async () => {
    if (!serviceID || !page || page.isClosed()) return;
    const inventory = await api('');
    if (!inventory.services?.some(service => service.service_id === serviceID)) return;
    const request = { action: 'uninstall', delete_data: true, delete_workspace: true };
    const plan = await api(`/${serviceID}/management-plans`, 'POST', request);
    assert.equal(plan.blockers.length, 0);
    await api(`/${serviceID}/operations`, 'POST', { ...request, request_id: randomUUID(), plan_digest: plan.plan_digest });
    await waitFor(async () => !(await api('')).services.some(service => service.service_id === serviceID), 90000, 'owned service uninstall');
  };
  try {
    welcome = await waitFor(() => context.pages().find(page => page.url().includes('/welcome/')), 60000, 'production Welcome');
    await welcome.getByRole('button', { name: /^((Open|Show) window|(打开|显示)窗口)$/ }).first().click({ timeout: 90000 });
    page = await waitFor(() => context.pages().find(page => page.url().includes('/_redeven_proxy/env/')), 60000, 'production Environment');
    page.setDefaultTimeout(30000);
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'Web Services', exact: true }).click();
    await page.getByRole('button', { name: 'Service templates', exact: true }).click();
    if (kind === 'compose') {
      const image = process.env.REDEVEN_TEMPLATE_MARKET_IMAGE;
      assert.match(image || '', /^busybox:1\.36\.1@sha256:[a-f0-9]{64}$/);
      await page.getByRole('button', {name: 'New service template', exact: true}).click();
      await page.getByRole('menuitem', {name: 'New Compose template', exact: true}).click();
      await page.locator('#template-editor-name').fill('Acceptance Compose');
      await page.locator('#template-editor-compose-port').fill('8080');
      await page.locator('#template-editor-compose-yaml').fill(`services:
  web:
    image: ${image}
    command: [sh, -c, 'mkdir -p /www; echo compose-product-verified > /www/index.html; exec httpd -f -p 8080 -h /www']
`);
      await page.getByRole('button', {name: 'Save template', exact: true}).click();
      await page.getByRole('option', {name: /Acceptance Compose/}).click();
      report.steps.push('create and save independent Compose template through the real editor');
    } else {
      const catalog = JSON.parse(await readFile(path.join(sourceEvidence, 'desktop-catalog.json'), 'utf8'));
      const item = catalog.data.find(item => item.document_template_id === `deepseek-harness-${kind}`);
      assert.ok(item);
      const row = page.locator(`[data-testid="service-template-row"][data-template-id="${item.template_id}"]`);
      await row.waitFor(); await row.click();
    }
    const sourceTransfers = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/source-previews')) {
        const body = request.postDataJSON();
        sourceTransfers.push({snapshot: Boolean(body.snapshot), token: Boolean(body.token), sourceKeys: Object.keys(body.source || {}).sort(), commit_sha: body.expected?.commit_sha});
      }
    });
    await page.getByTestId('service-template-primary').click();
    const form = page.getByTestId('managed-install-form');
    await waitFor(async () => await form.isVisible() || await page.getByTestId('managed-install-blocker').isVisible(), 60000, 'automatic template acquisition');
    assert.equal(await page.getByTestId('managed-install-blocker').count(), 0, await page.getByTestId('managed-install-blocker').allTextContents().then(lines => lines.join(' ')));
    await form.waitFor();
    assert.equal(await page.getByRole('dialog', {name: 'Review template', exact: true}).count(), 0);
    assert.equal(await page.getByRole('button', {name: 'Continue to deployment', exact: true}).count(), 0);
    if (kind !== 'compose') {
      assert.equal(sourceTransfers.length, 1);
      assert.equal(sourceTransfers[0].snapshot, true);
      assert.equal(sourceTransfers[0].token, false);
      assert.deepEqual(sourceTransfers[0].sourceKeys, ['path', 'ref', 'repository']);
      assert.match(sourceTransfers[0].commit_sha, /^[a-f0-9]{40}$/);
      report.sourceTransfers = sourceTransfers;
      report.steps.push('production catalog -> automatic anonymous Desktop acquisition -> configuration');
    }
    await page.screenshot({path: path.join(evidence, 'product-prepared.png')});
    for (const checkbox of await form.getByRole('checkbox').all()) await checkbox.check();
    const submit = page.getByTestId('managed-install-submit');
    await waitFor(() => submit.isEnabled(), 60000, 'real install preflight');
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/managed-web-services'));
    await page.evaluate(() => {
      window.__deploymentRows = {pending: false};
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="managed-install-submission"]')) {window.__deploymentRows.pending = true; observer.disconnect();}
      });
      observer.observe(document.body, {childList: true, subtree: true});
    });
    await submit.click();
    assert.equal(await page.evaluate(() => window.__deploymentRows.pending), true, 'a visible pending row must precede reconciliation');
    const response = await createdResponse; const envelope = await response.json();
    assert.ok(response.ok(), JSON.stringify(envelope));
    serviceID = (envelope.data ?? envelope).service.service_id; assert.ok(serviceID);
    report.service_id = serviceID;
    report.receipt = envelope.data ?? envelope;
    console.log('Created owned service', serviceID);
    await waitFor(async () => { const inspected = await api(`/${serviceID}/inspection`); report.last_inspection = inspected; return inspected.status === 'running' || Boolean(inspected.last_failure); }, 180000, `real ${kind} installation`);
    assert.equal(report.last_inspection.status, 'running', JSON.stringify(report.last_inspection.last_failure));
    report.steps.push(`install form -> preflight -> pending row -> ${kind} running`);
    await page.screenshot({ path: path.join(evidence, 'product-running.png') });
    const service = page.locator(`[data-testid="managed-service-row"][data-managed-service-id="${serviceID}"]`);
    await page.getByRole('button', { name: 'Web Services', exact: true }).click();
    console.log('Opening owned service');
    await service.getByRole('button', { name: 'Open', exact: true }).click();
    console.log('Open action clicked');
    opened = await waitFor(() => context.pages().find(candidate => candidate !== page && candidate !== welcome && /^https?:/.test(candidate.url())), 30000, 'actual service browser');
    await opened.waitForFunction(() => Boolean(document.body?.innerText.trim()));
    await opened.reload(); await opened.waitForFunction(() => Boolean(document.body?.innerText.trim()));
    if (kind === 'container') {
      await opened.getByRole('button', { name: 'Continue', exact: true }).click();
      await opened.getByRole('button', { name: 'Continue', exact: true }).waitFor({ state: 'hidden' });
      await opened.getByText('Get started', { exact: true }).waitFor();
      await opened.keyboard.press('Escape');
      await opened.getByText('Get started', { exact: true }).waitFor({ state: 'hidden' });
      report.defaultWorkspaceNotice = await opened.getByText('Unable to create default workspace. Use Choose workspace to select a folder.', { exact: true }).count() > 0;
      await opened.getByRole('button', { name: 'Add workspace', exact: true }).click();
      const directoryPicker = opened.getByRole('dialog', { name: 'Select Workspace Directory', exact: true });
      await directoryPicker.waitFor();
      await directoryPicker.getByRole('button', { name: 'New folder', exact: true }).click();
      const folderDialog = opened.getByRole('dialog', { name: 'New folder', exact: true });
      await folderDialog.getByRole('textbox', { name: 'Folder name', exact: true }).fill('acceptance-workspace');
      await folderDialog.getByRole('button', { name: 'Create', exact: true }).click();
      await folderDialog.waitFor({ state: 'hidden' });
      await directoryPicker.getByRole('button', { name: 'Open', exact: true }).click();
      await directoryPicker.waitFor({ state: 'hidden' });
      await opened.getByText('acceptance-workspace', { exact: true }).first().waitFor();
      assert.ok((await stat(path.join(report.receipt.service.workspace_path, 'acceptance-workspace'))).isDirectory());
      report.steps.push('application onboarding -> select workspace -> create folder on the managed mount');
      await opened.reload();
      await opened.getByText('acceptance-workspace', { exact: true }).first().waitFor();
    }
    if (kind === 'compose') assert.ok((await opened.locator('body').innerText()).includes('compose-product-verified'));
    await opened.screenshot({ path: path.join(evidence, 'product-service-open.png') });
    await opened.close();
    report.steps.push('actual Desktop service window open and reload');
    console.log('Cleaning up owned service');
    await cleanup();
    report.steps.push('uninstall owned service, workspace and data');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error);
    console.error('Product assertion failed', report.error);
    await writeFile(path.join(evidence, 'failure-before-cleanup.json'), JSON.stringify(report, null, 2));
    report.pages = context.pages().map(candidate => candidate.url());
    if (opened && !opened.isClosed()) { report.application = await opened.locator('body').innerText(); await opened.screenshot({ path: path.join(evidence, 'application-failure.png') }); }
    if (welcome && !welcome.isClosed()) { report.welcome = await welcome.locator('body').innerText(); await welcome.screenshot({path:path.join(evidence, 'welcome-failure.png')}); }
    if (serviceID && page && !page.isClosed()) report.inventory = await api('');
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(evidence, 'product-failure.png') }); report.visible = await page.locator('body').innerText(); }
    throw error;
  } finally {
    if (opened && !opened.isClosed()) await opened.close();
    try { await cleanup(); } catch (error) { report.cleanup_error = String(error); report.status = 'failed'; }
    await session.writeEvidence(path.join(evidence, 'product-deployment.json'), { ...report });
    await session.closeElectron(application);
  }
  assert.equal(report.status, 'passed', report.cleanup_error);
  console.log('Assertions complete: actual Desktop template preparation, deploy, open and cleanup');
});
