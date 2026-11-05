import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { expect } from '../internal/envapp/ui_src/node_modules/playwright/test.mjs';
import {
  stopRuntime,
  openEnvPage,
} from '../internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs';

// Explicit opt-in qualification. Credentials are read from the selected profile
// and written only into a new private state directory; source bytes never change.
const [binaryRoot, reportRoot, sourceProfile] = process.argv.slice(2);
if (![binaryRoot, reportRoot, sourceProfile].every((value) => value && path.isAbsolute(value))) {
  throw new Error(
    'Use <absolute product binary directory> <fresh absolute report directory> <absolute source profile>',
  );
}
const report = {
  scope: 'Actual Redeven binary, supported default HTTP loopback Local UI, Flower model tools, plugin workspace and installed sandbox',
  passed: false,
  assertions: [],
};
const phase = async (value) => {
  report.phase = value;
  console.log(`[plugin-creation] ${value}`);
  await writeFile(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const originals = new Map();
for (const file of ['config.json', 'secrets.json']) originals.set(file, await readFile(path.join(sourceProfile, file)));
const source = JSON.parse(originals.get('config.json'));
const providers = source.ai.providers.filter((provider) => provider.type === 'deepseek');
assert.equal(providers.length, 1, 'exact configured provider required');
const provider = {
  ...providers[0],
  model_selection: { selected_models: ['deepseek-flash'] },
};
delete provider.models;
const credential = JSON.parse(originals.get('secrets.json')).ai.provider_api_keys[provider.id];
assert.ok(credential, 'configured credential required');
await mkdir(reportRoot, { mode: 0o700 });
const home = path.join(reportRoot, 'home');
const stateRoot = path.join(reportRoot, 'state');
const environment = path.join(stateRoot, 'local-environment');
await mkdir(home, { mode: 0o700 });
await mkdir(environment, { recursive: true, mode: 0o700 });
await writeFile(
  path.join(environment, 'config.json'),
  JSON.stringify(
    {
      runtime_config_version: 1,
      agent_home_dir: home,
      shell: '/bin/sh',
      permission_policy: {
        schema_version: 1,
        local_max: { read: true, write: true, execute: true },
      },
      filesystem_scope: {
        schema_version: 1,
        default_root_id: 'home',
        roots: [
          {
            id: 'home',
            label: 'Home',
            kind: 'home',
            path: home,
            permissions: { read: true, write: true },
          },
        ],
      },
      ai: {
        providers: [provider],
        current_model_id: provider.id + '/deepseek-flash',
        permission_type: 'full_access',
        computer_use_enabled: false,
        auto_update_model_catalog: false,
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(
  path.join(environment, 'secrets.json'),
  JSON.stringify({
    schema_version: 1,
    ai: { provider_api_keys: { [provider.id]: credential } },
  }),
  { mode: 0o600 },
);
const executable = path.join(binaryRoot, 'redeven');
report.binarySHA256 = digest(await readFile(executable));
report.runtimeSHA256 = digest(await readFile(path.join(binaryRoot, 'redevplugin-runtime')));
const processEnvironment = { ...process.env, HOME: home, GOWORK: 'off' };
let runtime, browser, page;
const errors = [];
const startProduct = async () => {
  const startup = path.join(reportRoot, 'startup.json');
  await rm(startup, { force: true });
  const child = spawn(executable, [
    'run', '--mode', 'local', '--state-root', stateRoot, '--local-ui-bind', '127.0.0.1:0',
    '--local-ui-protocol', 'http', '--presentation', 'machine', '--startup-report-file', startup,
  ], { env: processEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { exited: false, stdout: '', stderr: '' };
  runtime = { child, state };
  child.stdout.on('data', chunk => { state.stdout = (state.stdout + chunk).slice(-65536); });
  child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-65536); });
  child.once('exit', () => { state.exited = true; });
  let ready;
  await expect.poll(async () => {
    assert.equal(state.exited, false, 'runtime exited before readiness');
    ready = await readFile(startup, 'utf8').then(JSON.parse).catch(() => null);
    return ready?.status;
  }, { timeout: 60000 }).toBe('ready');
  return ready;
};
const openProduct = async (ready, draftID) => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const url = new URL('_redeven_proxy/env/', ready.local_ui_url);
  if (draftID) url.searchParams.set('plugin_draft', draftID);
  ({ page } = await openEnvPage(context, url.href));
  page.on('pageerror', error => errors.push({ phase: report.phase, message: error.message, stack: error.stack }));
  page.on('framenavigated', frame => {
    const url = new URL(frame.url() || 'about:blank');
    (report.frameNavigations ??= []).push({ phase: report.phase, at: new Date().toISOString(), main: frame === page.mainFrame(), origin: url.origin, pathname: url.pathname });
  });
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400 && pathname.includes('/plugin-creation/')) {
      const body = await response.text().catch(() => 'Response body unavailable');
      (report.failedRequests ??= []).push({ pathname, status: response.status(), body });
    }
  });
};
try {
  const ready = await startProduct();
  await phase('Product runtime ready');
  await openProduct(ready);
  const activity = page.getByRole('tab', { name: 'Activity', exact: true });
  if ((await activity.getAttribute('aria-selected')) !== 'true') await activity.click();
  await page
    .locator('nav[data-floe-shell-slot="activity-bar"]')
    .getByRole('button', { name: 'Plugins', exact: true })
    .click();
  await page.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-create-plugin]').click();
  let workspace = page.locator('[data-plugin-creation-workspace]');
  await workspace
    .locator('textarea')
    .first()
    .fill(
      'Create a compact focus timer plugin in this dedicated draft. Read the redeven-plugin-authoring skill and plugin_author.status, initialize a web template with plugin_id dev.redeven.qualification.productfocus and display_name Focus Timer. Implement a 25-minute timer showing 25:00 initially, with accessible buttons named Start, Pause and Reset, a live mm:ss display, and a compact 13px interface following the host light/dark theme. Use normal tools to edit the managed source and install dependencies, then plugin_author.build. Keep the original generated bindings and real tests. Do not delegate, start another preview server, install the plugin or grant permissions; I will review it in this workspace. Continue until a successful artifact is returned.',
    );
  const createDirectly = workspace.getByRole('button', { name: 'Create directly', exact: true });
  report.directAction = await createDirectly.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const describe = node => {
      const style = getComputedStyle(node);
      return { tag: node.tagName, class: node.className, inert: node.inert, pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex, rect: node.getBoundingClientRect().toJSON() };
    };
    return { button: describe(element), hits: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8).map(describe) };
  });
  await createDirectly.click();
  await expect(workspace).toHaveAttribute('data-thread-id', /.+/, {
    timeout: 30000,
  });
  report.draftID = await workspace.getAttribute('data-project-id');
  report.threadID = await workspace.getAttribute('data-thread-id');
  await phase('Dedicated Flower turn accepted');
  let frame = workspace.frameLocator('iframe');
  await Promise.race([
    frame.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 900000 }),
    workspace.locator('[data-plugin-surface-diagnostics]').waitFor({ state: 'attached', timeout: 900000 }).then(async () => { throw new Error('Generated preview failed: ' + await workspace.locator('[aria-label="Preview"]').innerText()); }),
  ]);
  // A successful first artifact can appear while Flower is still running its
  // checks. Review its completed result before exercising the retained preview.
  await expect(workspace.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 900000 });
  const completedUpdate = workspace.getByRole('button', { name: 'Update preview', exact: true });
  if (await completedUpdate.isVisible()) await completedUpdate.click();
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', /.+/, { timeout: 30000 });
  await frame.getByText('25:00', { exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Start', exact: true }).click();
  await frame.getByText('24:59', { exact: true }).waitFor({ timeout: 5000 });
  await frame.getByRole('button', { name: 'Pause', exact: true }).click();
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await frame.getByText('25:00', { exact: true }).waitFor();
  report.assertions.push('Actual Flower submission produces a runnable package through approved author tools');
  report.previewOrigin = new URL(await workspace.locator('iframe').getAttribute('src')).origin;
  assert.notEqual(new URL(report.previewOrigin).hostname, new URL(page.url()).hostname);
  await phase('Generated preview verified');
  await page.screenshot({
    path: path.join(reportRoot, 'generated-preview.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await page.screenshot({
    path: path.join(reportRoot, 'generated-preview-mobile.png'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await phase('Generating a revision after responsive preview');
  await workspace.locator('textarea').first().fill(
    'Keep this same plugin draft and timer. Add a compact visible heading with the exact text Focus session ready. Preserve Start, Pause, Reset and the initial 25:00 display. Set the plugin package version to 0.1.1, keep the original plugin identity and bindings, update the real tests as needed, and run plugin_author.build. Do not install or grant permissions. Continue until a new successful artifact is returned.',
  );
  const send = workspace.getByRole('button', { name: 'Send', exact: true });
  await send.waitFor({ timeout: 120000 });
  await send.click();
  const apply = workspace.getByRole('button', { name: 'Update preview', exact: true });
  await apply.waitFor({ timeout: 900000 });
  await expect(workspace.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 900000 });
  await expect(apply).toBeEnabled();
  await phase('Applying the generated revision');
  await apply.click();
  await frame.getByText('Focus session ready', { exact: true }).waitFor({ timeout: 60000 });
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', /.+/, { timeout: 30000 });
  await expect(workspace.locator('.plugin-creation-section-header')).toContainText('0.1.1');
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await expect(workspace.locator('[data-plugin-surface-diagnostics]')).toHaveCount(0);
  report.assertions.push('A second real Flower turn builds and explicitly applies a revision within the same draft and thread');
  await phase('Generated revision applied');
  await workspace.getByRole('button', { name: 'Install in this environment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm installation', exact: true }).click();
  await workspace.getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 30000 });
  await page.reload();
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await browser.close();
  browser = undefined;
  await stopRuntime(runtime);
  assert.equal(runtime.state.exited, true, 'first product process stopped before restart');
  await writeFile(path.join(reportRoot, 'runtime-before-restart.log'), runtime.state.stdout + runtime.state.stderr, { mode: 0o600 });
  const restarted = await startProduct();
  await openProduct(restarted, report.draftID);
  workspace = page.locator('[data-plugin-creation-workspace]');
  frame = workspace.frameLocator('iframe');
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await frame.getByText('Focus session ready', { exact: true }).waitFor({ timeout: 60000 });
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', /.+/, { timeout: 30000 });
  await workspace.getByRole('button', { name: 'Open', exact: true }).click();
  report.assertions.push('A complete product process restart restores the durable draft, canonical thread, revision and installation');
  await workspace.waitFor({ state: 'detached' });
  const installedFrame = page.frameLocator('iframe').last();
  await installedFrame.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await installedFrame.getByText('25:00', { exact: true }).waitFor();
  await installedFrame.getByText('Focus session ready', { exact: true }).waitFor();
  report.installedOrigin = new URL(await page.locator('iframe').last().getAttribute('src')).origin;
  assert.notEqual(report.installedOrigin, report.previewOrigin);
  await page.screenshot({
    path: path.join(reportRoot, 'installed-application.png'),
  });
  report.assertions.push(
    'Product review installs the current preview, survives reload and opens the formal application',
  );
  await phase('Formal application verified after reload');
  const restoredActivity = page.getByRole('tab', { name: 'Activity', exact: true });
  if ((await restoredActivity.getAttribute('aria-selected')) !== 'true') await restoredActivity.click();
  await page
    .locator('nav[data-floe-shell-slot="activity-bar"]')
    .getByRole('button', { name: 'Plugins', exact: true })
    .click();
  await page.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-drafts]').click();
  await page.locator('[data-plugin-draft-library] .divide-y > button').first().click();
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await workspace.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByText('Delete draft', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete draft', exact: true }).click();
  await workspace.waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: /^Installed/ }).click();
  const installedCard = page.locator('[data-plugin-directory-card]').filter({ hasText: 'Focus Timer' });
  await installedCard.getByRole('button', { name: 'Open', exact: true }).click();
  await installedFrame.getByRole('button', { name: 'Start', exact: true }).click();
  await installedFrame.getByText('24:59', { exact: true }).waitFor({ timeout: 5000 });
  await installedFrame.getByRole('button', { name: 'Pause', exact: true }).click();
  await installedFrame.getByRole('button', { name: 'Reset', exact: true }).click();
  report.assertions.push('Deleting the dedicated draft preserves the installed application and its executable surface');
  await phase('Draft deletion preserves the formal application');
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (page) {
    report.surfaceDiagnostics = await page.locator('[data-plugin-surface-diagnostics]').allTextContents().catch(() => []);
    report.failedAction = await page.locator('.plugin-creation-submit-intents button').evaluate(element => {
      const describe = node => { const style = getComputedStyle(node); return { tag: node.tagName, class: node.className, inert: node.inert, hidden: node.hidden, attributes: Object.fromEntries(Array.from(node.attributes).filter(a => !['class', 'style'].includes(a.name)).map(a => [a.name, a.value])), pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex, rect: node.getBoundingClientRect().toJSON() }; };
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.push(describe(node));
      const rect = element.getBoundingClientRect();
      return { ancestors, hits: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8).map(describe) };
    }).catch(() => null);
    report.visibleText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    await page.screenshot({ path: path.join(reportRoot, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  report.pageErrors = errors;
  const cleanupErrors = [];
  if (browser) await browser.close().catch((error) => cleanupErrors.push(error));
  await stopRuntime(runtime).catch((error) => cleanupErrors.push(error));
  await rm(path.join(environment, 'secrets.json'), { force: true }).then(
    () => {
      report.temporaryCredentialsRemoved = true;
    },
    (error) => cleanupErrors.push(error),
  );
  report.runtimeStopped = !runtime || runtime.state.exited;
  for (const [file, before] of originals) {
    try {
      assert.equal(digest(await readFile(path.join(sourceProfile, file))), digest(before), 'Source profile changed');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    report.passed = false;
    report.cleanupErrors = cleanupErrors.map(String);
  }
  await writeFile(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  if (runtime)
    await writeFile(path.join(reportRoot, 'runtime.log'), runtime.state.stdout + runtime.state.stderr, { mode: 0o600 });
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Product qualification cleanup failed');
}
