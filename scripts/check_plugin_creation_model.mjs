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
const executable = path.join(binaryRoot, 'redeven');
report.binarySHA256 = digest(await readFile(executable));
report.runtimeSHA256 = digest(await readFile(path.join(binaryRoot, 'redevplugin-runtime')));
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' });
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
  await expect(workspace.locator('.plugin-creation-intro h2')).toBeVisible();
  await expect(workspace.locator('textarea').first()).toBeEnabled();
  await expect(page.locator('[data-redeven-plugin-creation-page] .display-mode-page-shell')).toHaveCount(0);
  await page.screenshot({ path: path.join(reportRoot, 'creation-entry.png') });
  await workspace
    .locator('textarea')
    .first()
    .fill(
      'Create a compact focus timer plugin in this dedicated draft. Read the redeven-plugin-authoring skill and plugin_author_get_status, initialize a web template with slug focus-timer and display_name Focus Timer. Implement a 25-minute timer showing 25:00 initially, with accessible buttons named Start, Pause and Reset, a live mm:ss display, and a compact 13px interface following the host light/dark theme. Compose it directly on the host canvas without an enclosing card, border, shadow or repeated page header. Use normal tools to edit the managed source and install dependencies, then plugin_author_build. Keep the original generated bindings and real tests. Do not delegate, start another preview server, install the plugin or grant permissions; I will review it in this workspace. Continue until a successful artifact is returned.',
    );
  const send = workspace.getByRole('button', { name: 'Send', exact: true });
  report.sendAction = await send.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const describe = node => {
      const style = getComputedStyle(node);
      return { tag: node.tagName, class: node.className, inert: node.inert, pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex, rect: node.getBoundingClientRect().toJSON() };
    };
    return { button: describe(element), hits: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8).map(describe) };
  });
  await send.click();
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
  await expect(workspace.getByRole('button', { name: 'Preview versions', exact: true })).toBeEnabled();
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', /.+/, { timeout: 30000 });
  await frame.getByText('25:00', { exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Start', exact: true }).click();
  await frame.getByText('24:59', { exact: true }).waitFor({ timeout: 5000 });
  await frame.getByRole('button', { name: 'Pause', exact: true }).click();
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await frame.getByText('25:00', { exact: true }).waitFor();
  report.assertions.push('Actual Flower submission produces a runnable package through approved author tools');
  await expect(workspace.getByRole('heading', { level: 1 })).toHaveText('Focus Timer');
  await expect(workspace.locator('.plugin-creation-toolbar')).toHaveCount(1);
  await expect(workspace.locator('.plugin-creation-section-header')).toHaveCount(0);
  const toolbarBounds = await workspace.locator('.plugin-creation-toolbar').boundingBox();
  assert.ok(toolbarBounds && toolbarBounds.height <= 48, 'one compact workspace toolbar');
  report.applicationAppearance = await frame.locator('body').evaluate(element => ({
    fontSize: getComputedStyle(element).fontSize,
    background: getComputedStyle(element).backgroundColor,
    viewport: { width: innerWidth, height: innerHeight },
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(report.applicationAppearance.overflow, false, 'desktop application fits its canvas');
  assert.ok(parseFloat(report.applicationAppearance.fontSize) >= 12 && parseFloat(report.applicationAppearance.fontSize) <= 14, 'application body uses compact readable typography');
  const enclosingFrames = await frame.getByRole('button', { name: 'Start', exact: true }).evaluate(element => {
    const result = [];
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelectorAll('button').length < 3) continue;
      const style = getComputedStyle(node);
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none');
      if (bordered || style.boxShadow !== 'none') result.push(node.tagName + '.' + node.className);
    }
    return result;
  });
  assert.deepEqual(enclosingFrames, [], 'application controls belong to an unboxed composition');
  await expect(workspace.locator('.plugin-creation-flower-conversation [data-media-kind="html"]')).toHaveCount(0);
  report.previewOrigin = new URL(await workspace.locator('iframe').getAttribute('src')).origin;
  assert.notEqual(new URL(report.previewOrigin).hostname, new URL(page.url()).hostname);
  await phase('Generated preview verified');
  await page.screenshot({
    path: path.join(reportRoot, 'generated-preview.png'),
  });
  const previewInstance = await workspace.locator('[data-plugin-surface-host]').getAttribute('data-surface-instance-id');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect.poll(() => frame.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe('dark');
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', previewInstance);
  await page.screenshot({ path: path.join(reportRoot, 'generated-preview-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByRole('button', { name: 'Start', exact: true }).waitFor();
  assert.equal(await frame.locator('html').evaluate(element => element.scrollWidth > innerWidth), false, 'narrow application has no horizontal overflow');
  assert.equal(await workspace.evaluate(element => element.scrollWidth > innerWidth), false, 'narrow workspace has no horizontal overflow');
  await page.screenshot({
    path: path.join(reportRoot, 'generated-preview-mobile.png'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect.poll(() => frame.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe('light');
  await phase('Generating a revision from a real canvas comment');
  const ordinaryDraft = 'Keep this unrelated unfinished idea in the composer';
  await workspace.locator('.plugin-creation-flower-composer textarea').fill(ordinaryDraft);
  await frame.getByRole('button', { name: 'Start', exact: true }).click({ button: 'right' });
  const comment = workspace.getByRole('dialog', { name: 'Comment', exact: true });
  await expect(comment).toBeVisible();
  await expect(comment.locator('.plugin-canvas-comment-target')).toContainText('Start');
  await comment.getByRole('textbox').fill(
    'Change the selected Start button label to Begin focus. Add a compact heading with the exact text Focus session ready. Keep this same plugin identity, Pause, Reset and the initial 25:00 display. Set the package version to 0.1.1, update the real tests and run plugin_author_build. Do not install or grant permissions. Continue until the new successful artifact is returned.',
  );
  await expect(comment.getByRole('button', { name: 'Ask Flower to change', exact: true })).toBeEnabled({ timeout: 120000 });
  await page.screenshot({ path: path.join(reportRoot, 'canvas-comment.png') });
  await comment.getByRole('button', { name: 'Ask Flower to change', exact: true }).click();
  await expect(workspace.locator('.plugin-creation-flower-composer textarea')).toHaveValue(ordinaryDraft);
  await frame.getByText('Focus session ready', { exact: true }).waitFor({ timeout: 900000 });
  await phase('Canvas comment produced an automatically displayed revision');
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByText('Focus session ready', { exact: true }).waitFor({ timeout: 60000 });
  await expect(workspace.locator('[data-plugin-surface-host]')).toHaveAttribute('data-surface-instance-id', /.+/, { timeout: 30000 });
  await workspace.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preview versions', exact: true }).click();
  await expect(page.getByRole('menuitem').filter({ hasText: '0.1.1' }).first()).toBeVisible();
  await page.getByRole('menuitem').filter({ hasText: '0.1.0' }).first().click();
  await frame.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await expect(frame.getByText('Focus session ready', { exact: true })).toHaveCount(0);
  await page.reload();
  await workspace.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await workspace.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preview versions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Follow latest', exact: true }).click();
  await frame.getByText('Focus session ready', { exact: true }).waitFor();
  report.assertions.push('Real generated history restores earlier UI, retains its selection on reload and returns to the newest build');
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await expect(workspace.locator('[data-plugin-surface-diagnostics]')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Begin focus', exact: true }).waitFor();
  await page.screenshot({ path: path.join(reportRoot, 'revised-preview-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(reportRoot, 'revised-preview.png') });
  await expect(workspace.locator('.plugin-creation-flower-composer textarea')).toHaveValue(ordinaryDraft);
  await workspace.locator('.plugin-creation-flower-composer textarea').fill('');
  report.assertions.push('A native sandbox right-click comment changes the selected element through the same real Flower thread, preserves unsent composer text and builds an automatically displayed revision');
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
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  const installedWindow = page.locator('[data-redeven-plugin-activity-window]').filter({ visible: true });
  const installedFrame = installedWindow.frameLocator('iframe');
  await installedFrame.getByRole('button', { name: 'Begin focus', exact: true }).waitFor();
  await installedFrame.getByText('25:00', { exact: true }).waitFor();
  await installedFrame.getByText('Focus session ready', { exact: true }).waitFor();
  report.installedOrigin = new URL(await installedWindow.locator('iframe').getAttribute('src')).origin;
  assert.notEqual(report.installedOrigin, report.previewOrigin);
  await page.screenshot({
    path: path.join(reportRoot, 'installed-application.png'),
  });
  const localizedContext = await browser.newContext({
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light',
  });
  try {
    const localizedURL = new URL('_redeven_proxy/env/', restarted.local_ui_url);
    localizedURL.searchParams.set('plugin_draft', report.draftID);
    const { page: localizedPage } = await openEnvPage(localizedContext, localizedURL.href);
    localizedPage.on('pageerror', error => errors.push({ phase: 'Chinese canvas review', message: error.message, stack: error.stack }));
    const localizedWorkspace = localizedPage.locator('[data-plugin-creation-workspace]');
    await expect(localizedWorkspace).toHaveAttribute('data-thread-id', report.threadID);
    await expect(localizedWorkspace.getByRole('button', { name: '适应画布', exact: true })).toBeVisible();
    const localizedFrame = localizedWorkspace.frameLocator('iframe');
    await localizedFrame.getByRole('button', { name: 'Begin focus', exact: true }).waitFor({ timeout: 60000 });
    await localizedPage.screenshot({ path: path.join(reportRoot, 'revised-preview-zh-CN.png') });
    await localizedFrame.getByRole('button', { name: 'Begin focus', exact: true }).click({ button: 'right' });
    const localizedComment = localizedWorkspace.getByRole('dialog', { name: '评论', exact: true });
    await expect(localizedComment).toBeVisible();
    await localizedComment.getByRole('textbox', { name: '你希望 Flower 如何修改这里？', exact: true }).fill('让这个按钮更简洁，并与计时器对齐。');
    await expect(localizedComment.getByRole('button', { name: '让 Flower 修改', exact: true })).toBeEnabled({ timeout: 30000 });
    await localizedPage.screenshot({ path: path.join(reportRoot, 'canvas-comment-zh-CN.png') });
    await localizedComment.getByRole('textbox').fill('');
    await localizedComment.getByRole('button', { name: '收起评论', exact: true }).click();
    await localizedPage.setViewportSize({ width: 390, height: 844 });
    await localizedWorkspace.getByRole('tab', { name: '预览', exact: true }).click();
    await expect(localizedFrame.getByRole('button', { name: 'Begin focus', exact: true })).toBeVisible();
    assert.equal(await localizedWorkspace.evaluate(element => element.scrollWidth > innerWidth), false, 'Chinese canvas fits a narrow viewport');
    await localizedPage.screenshot({ path: path.join(reportRoot, 'revised-preview-mobile-zh-CN.png') });
    await localizedWorkspace.locator('.plugin-creation-toolbar > button').first().click();
    await localizedWorkspace.waitFor({ state: 'detached' });
    report.assertions.push('The actual restored draft renders Chinese canvas controls and native right-click comments at desktop and mobile widths');
  } finally {
    await localizedContext.close();
  }
  report.assertions.push(
    'Product review installs the current preview, survives reload and opens the formal application',
  );
  await phase('Formal application verified after reload');
  await installedWindow.getByRole('button', { name: 'Close', exact: true }).click();
  await installedWindow.waitFor({ state: 'detached' });
  await workspace.getByRole('button', { name: 'Back to creation history', exact: true }).click();
  await page.locator('[data-plugin-history-entry="' + report.draftID + '"]').click();
  await expect(workspace).toHaveAttribute('data-project-id', report.draftID);
  await expect(workspace).toHaveAttribute('data-thread-id', report.threadID);
  await workspace.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByText('Delete project', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await workspace.waitFor({ state: 'detached' });
  await page.locator('[data-plugin-draft-library]').getByRole('button', { name: 'Back to Plugin Center', exact: true }).click();
  await page.getByRole('tab', { name: /^Installed/ }).click();
  const installedCard = page.locator('[data-plugin-directory-card]').filter({ hasText: 'Focus Timer' });
  const pin = installedCard.locator('[data-plugin-quick-pin]');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await installedCard.locator('[data-plugin-center-item]').hover();
  await expect.poll(() => pin.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  assert.deepEqual(await pin.evaluate(element => ({
    border: getComputedStyle(element).borderWidth,
    shadow: getComputedStyle(element).boxShadow,
    filled: getComputedStyle(element.querySelector('svg')).fill !== 'none',
  })), { border: '0px', shadow: 'none', filled: true });
  await page.reload();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(reportRoot, 'installed-pinned-icon.png') });
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  report.assertions.push('Installed plugin pin persists across reload and uses only a filled icon, without a resting button enclosure');
  await installedCard.getByRole('button', { name: 'Open', exact: true }).click();
  const reopenedFrame = page.frameLocator('iframe').last();
  await reopenedFrame.getByRole('button', { name: 'Begin focus', exact: true }).click();
  await reopenedFrame.getByText('24:59', { exact: true }).waitFor({ timeout: 5000 });
  await reopenedFrame.getByRole('button', { name: 'Pause', exact: true }).click();
  await reopenedFrame.getByRole('button', { name: 'Reset', exact: true }).click();
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
