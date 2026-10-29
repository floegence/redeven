import { readFile, mkdtemp, rm, mkdir, writeFile, realpath, readdir, chmod } from 'node:fs/promises';
import { qualificationCounter, qualificationResources } from './qualification_protocol.mjs';
import { createHash, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from '../desktop/node_modules/esbuild/lib/main.js';
import { chromium, firefox, webkit } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightRequire = createRequire(await realpath(path.join(root, 'internal/envapp/ui_src/node_modules/playwright/package.json')));
const { PNG } = playwrightRequire(path.join(path.dirname(playwrightRequire.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
function changedDisplayPixels(before, after) {
  const a = PNG.sync.read(before), b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Display geometry changed during input verification');
  let changed = 0;
  for (let y = Math.floor(a.height * .2); y < a.height * .8; y++) {
    for (let x = Math.floor(a.width * .2); x < a.width * .8; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]) > 45) changed++;
    }
  }
  return changed;
}
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const controlURL = new URL(fixture.control);
if (controlURL.protocol !== 'http:' || controlURL.hostname !== '127.0.0.1' || controlURL.username || controlURL.password || controlURL.pathname !== '/' || controlURL.search || controlURL.hash || !controlURL.port) throw new Error('Fixture control must be an explicit loopback origin');
const controlOrigin = 'http://127.0.0.1:' + Number(controlURL.port);
const temporary = await mkdtemp(path.join(tmpdir(), 'redeven-center-browser-'));
const reportDir = process.env.REDEVEN_CENTER_REPORT_DIR;
const engine = process.env.REDEVEN_CENTER_BROWSER_ENGINE ?? 'chromium';
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType) throw new Error('Unsupported browser engine');
const report = { scope: 'Actual Center UI, real Gateway pairing and ' + fixture.targets.length + ' independent Runtime applications', engine, status: 'running', cases: [] };
let password = 'center-browser-acceptance-password';
let browser;
let recoveryCodes = [];
let recoveryIndex = 0;
let centerSecret = '';
let lastCenterTOTPStep = 0;
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(step).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
async function centerCall(page, endpoint, body) {
  return page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch('/api/center/v1/' + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Redeven-Center': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...(await response.json()) };
  }, { endpoint, body });
}
async function authenticate(page, sensitive = false) {
  const scope = sensitive ? page.getByRole('dialog', { name: 'Verify this sensitive action', exact: true }) : page;
  await scope.getByLabel('Entry password', { exact: true }).fill(password);
  await scope.getByRole('button', { name: 'Sign in', exact: true }).click();
  const next = recoveryCodes[recoveryIndex++];
  if (next) {
    await scope.locator('input[autocomplete="one-time-code"]').waitFor();
    if (await scope.getByRole('button', { name: 'Recovery code', exact: true }).count()) await scope.getByRole('button', { name: 'Recovery code', exact: true }).click();
    await scope.getByLabel('Recovery code', { exact: true }).fill(next);
  } else {
    while (Math.floor(Date.now()/30000) <= lastCenterTOTPStep) await new Promise(resolve=>setTimeout(resolve,250));
    lastCenterTOTPStep = Math.floor(Date.now()/30000);
    await scope.getByLabel('Authenticator code', {exact:true}).fill(totp(centerSecret));
  }
  await scope.getByRole('button', { name: 'Verify', exact: true }).click();
  if (sensitive) await scope.waitFor({ state: 'hidden' });
  else {
    await page.getByRole('navigation', { name: 'Redeven', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Environments', exact: true }).click();
    await page.getByRole('heading', { name: 'Environments', exact: true }).first().waitFor();
  }
}
async function openEnvironment(page, context, index) {
  const [environment] = await Promise.all([context.waitForEvent('page', {timeout:15000}),
    page.getByRole('button', { name: 'Open', exact: true }).nth(index).click({timeout:15000})]);
  await environment.waitForURL(url => url.origin === fixture.targets[index].origin && !url.pathname.startsWith('/__center/'), { timeout: 45000 });
  return environment;
}
async function runtimeStatus(page) { return page.evaluate(async () => (await fetch('/api/local/runtime')).status); }
async function verifyRuntimeWorkspace(page, navigate) {
  await page.getByTestId('redeven-workbench-page').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor({ state: 'visible', timeout: 30000 });
  await until(async () => await page.locator('[data-env-page-loading]:visible').count() === 0, 'Workbench never finished rendering');
  if (await page.locator('[data-workbench-layout-error]').count()) throw new Error('Workbench layout failed to load');
  if (!navigate) return;
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const navigation = page.locator('nav[data-floe-shell-slot="activity-bar"]');
  await navigation.getByRole('button', { name: 'File Browser', exact: true }).click();
  await page.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last().waitFor({ timeout: 30000 });
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('[data-terminal-panel-variant="panel"]:visible').last().waitFor({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
  await page.locator('[data-workbench-dock-action="tessiven"]').waitFor({ state: 'visible', timeout: 30000 });
  await until(async () => await page.locator('[data-env-page-loading]:visible').count() === 0, 'Workbench did not recover after Activity navigation');
}
async function verifyDeniedClipboardManualInput(page, context, bundle) {
  if (engine !== 'chromium') throw new Error('Permission qualification requires Chrome CDP');
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.grantPermissions', { permissions: [], origin: new URL(page.url()).origin, browserContextId: targetInfo.browserContextId });
  let sessionID = '';
  let probeStarted = false;
  try {
    await page.bringToFront();
    const permissions = await page.evaluate(async () => {
      const states = await Promise.all(['clipboard-read', 'clipboard-write'].map(async name => ({ name, state: (await navigator.permissions.query({ name })).state })));
      let readError = '';
      try { await navigator.clipboard.readText(); } catch (error) { readError = error.name; }
      return { states, readError };
    });
    if (permissions.states.some(item => item.state !== 'denied') || permissions.readError !== 'NotAllowedError') throw new Error('Chrome did not enforce clipboard denial: ' + JSON.stringify(permissions));
    await page.addScriptTag({ path: bundle });
    const probe = await page.evaluate(async () => {
      window.manualInputProbe = await GatewayAcceptance.createManualInputProbe();
      return { path: window.manualInputProbe.path, marker: window.manualInputProbe.marker, priorSessions: window.manualInputProbe.priorSessions };
    });
    probeStarted = true;
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Terminal', exact: true }).click();
    const panel = page.locator('[data-terminal-panel-variant="panel"]:visible').last();
    await panel.getByRole('button', { name: 'Create session', exact: true }).click();
    const canvas = panel.locator('[data-terminal-semantic-canvas="true"]:visible').last();
    await canvas.waitFor({ timeout: 15000 });
    const terminal = canvas.locator('xpath=ancestor::*[@data-terminal-runtime-session][1]');
    await until(async () => await terminal.getAttribute('aria-busy') === 'false' && Number(await terminal.getAttribute('data-terminal-presentation-sequence')) > 0, 'Manual terminal did not become interactive');
    sessionID = await terminal.getAttribute('data-terminal-runtime-session');
    if (!sessionID || probe.priorSessions.includes(sessionID)) throw new Error('Manual input did not create a task-owned terminal');
    await terminal.locator('textarea[data-terminal-input-bridge="semantic"]').focus();
    const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    await page.keyboard.type('printf %s ' + quote(probe.marker) + ' > ' + quote(probe.path));
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => window.manualInputProbe.verify()), 'Keyboard input did not reach the target Runtime while clipboard was denied');
    if (await runtimeStatus(page) !== 200) throw new Error('Clipboard denial disrupted Runtime authority');
    report.cases.push({ scope: 'Actual Chrome clipboard read/write permission denial and keyboard-only terminal command through Center', ...permissions, manualCommandVerified: true });
  } finally {
    try { if (probeStarted) await page.evaluate(id => window.manualInputProbe.close(id), sessionID); }
    finally { await context.clearPermissions(); await cdp.detach(); }
  }
  await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
  await verifyRuntimeWorkspace(page, false);
}
async function verifyAttachmentPicker(page) {
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Flower', exact: true }).click();
  const add = page.locator('.flower-composer-attachment-button:visible').last();
  await until(() => add.isEnabled(), 'Flower attachment control never became available');
  if (process.env.REDEVEN_CENTER_NATIVE_PICKER === '1') {
    if (process.env.REDEVEN_CENTER_HEADED !== '1' || !reportDir) throw new Error('Native picker qualification requires a visible browser and report directory');
    const composer = page.locator('[data-flower-text-entry="true"]:visible textarea').last();
    const draft = 'Keep this draft when file selection is canceled.';
    await composer.fill(draft);
    await page.evaluate(() => {
      document.title = 'Redeven Center native picker acceptance';
      window.centerNativePicker = { canceled: 0, changed: 0 };
      for (const input of document.querySelectorAll('input[type="file"]')) {
        input.addEventListener('cancel', () => { window.centerNativePicker.canceled++; });
        input.addEventListener('change', () => { window.centerNativePicker.changed++; });
      }
    });
    await page.bringToFront();
    await writeFile(path.join(reportDir, 'native-picker-ready.json'), JSON.stringify({ status: 'waiting_for_native_selection_cancel', origin: new URL(page.url()).origin }));
    await page.waitForFunction(() => window.centerNativePicker.canceled === 1, undefined, { timeout: 180000 });
    const native = await page.evaluate(() => window.centerNativePicker);
    if (native.changed !== 0 || await page.locator('.flower-attachment-item:visible').count() !== 0 || !await add.isEnabled() || await composer.inputValue() !== draft) throw new Error('Canceling native selection changed attachments or draft, or blocked retry');
    await composer.fill('');
    report.cases.push({ scope: 'Native Chrome operating-system file chooser canceled through visible desktop UI; cancel event observed, draft preserved and composer remains available', ...native, draftPreserved: true });
    await writeFile(path.join(reportDir, 'native-picker-complete.json'), JSON.stringify(native));
  }
  const content = Buffer.from('Center browser file selection integrity λ 中\n'.repeat(1024));
  const digest = createHash('sha256').update(content).digest('hex');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/_redeven_proxy/api/ai/uploads' && response.request().method() === 'POST'),
    chooser.setFiles({ name: 'center-picker.txt', mimeType: 'text/plain', buffer: content }),
  ]);
  const result = await response.json();
  if (!response.ok() || !result.ok || result.data.content_sha256 !== digest || result.data.size_bytes !== content.length) throw new Error('Flower file selection failed upload integrity');
  const item = page.locator('.flower-attachment-item:visible').filter({ hasText: 'center-picker.txt' });
  await until(async () => await item.getAttribute('data-attachment-status') === 'staged_ready', 'Flower attachment never became ready');
  const requestHeaders = await response.request().allHeaders();
  const proof = {
    url: '/_redeven_proxy/api/ai/uploads/' + encodeURIComponent(result.data.attachment_id),
    headers: { 'Upload-Staging-Scope-ID': requestHeaders['upload-staging-scope-id'], 'Upload-Staging-Capability': requestHeaders['upload-staging-capability'] },
  };
  const actual = await page.evaluate(async ({ url, headers }) => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Uploaded attachment read failed');
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
  }, proof);
  if (actual !== digest) throw new Error('Selected file bytes changed in transport');
  if (reportDir) await page.screenshot({ path: path.join(reportDir, engine + '-attachment-ready.png'), fullPage: true });
  // Removing an editor chip preserves staged bytes that a queued draft may
  // still reference. The staging owner, not this UI action, deletes them.
  await item.hover();
  await item.getByRole('button', { name: 'Remove attachment', exact: true }).click();
  await item.waitFor({ state: 'hidden' });
  const cleanup = await page.evaluate(async ({ url, headers }) => {
    const retainedStatus = (await fetch(url, { headers })).status;
    const release = await fetch('/_redeven_proxy/api/ai/upload-staging-scopes/' + encodeURIComponent(headers['Upload-Staging-Scope-ID']), { method: 'DELETE', headers });
    if (!release.ok) throw new Error('Picker qualification staging cleanup failed');
    return { retainedStatus, releasedStatus: (await fetch(url, { headers })).status };
  }, proof);
  if (cleanup.retainedStatus !== 200 || cleanup.releasedStatus !== 404) throw new Error('Attachment draft removal and staging cleanup violated ownership');
  report.cases.push({ scope: 'Actual Flower Add attachment button and Chrome filechooser selection, ready state, exact content digest, Remove attachment action with retained staged copy, then explicit staging cleanup', bytes: content.length, sha256: digest, ...cleanup, nativePickerCancellationQualified: process.env.REDEVEN_CENTER_NATIVE_PICKER === '1' });
  await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
  await verifyRuntimeWorkspace(page, false);
}
async function verifyNativeDownloadPicker(page, bundle) {
  if (engine !== 'chromium' || process.env.REDEVEN_CENTER_HEADED !== '1' || !reportDir) throw new Error('Native save qualification requires visible Chrome and a report directory');
  const permissionDirectory = path.join(temporary, 'permission-download');
  const qualifyPermissions = process.env.REDEVEN_CENTER_NATIVE_SAVE_PERMISSIONS === '1';
  if (qualifyPermissions) await mkdir(permissionDirectory, { mode: 0o700 });
  await page.addScriptTag({ path: bundle });
  const probe = await page.evaluate(async () => {
    window.centerDownloadProbe = await GatewayAcceptance.createNativeDownloadProbe();
    const { home, name, content } = window.centerDownloadProbe;
    return { home, name, content };
  });
  try {
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'File Browser', exact: true }).click();
    await page.getByTitle('Go to path', { exact: true }).filter({ visible: true }).last().click();
    const pathInput = page.getByRole('textbox', { name: 'Go to path', exact: true });
    await pathInput.fill(probe.home);
    await pathInput.press('Enter');
    const file = page.getByText(probe.name, { exact: true }).filter({ visible: true }).last();
    await file.waitFor({ timeout: 30000 });
    await file.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Download', exact: true }).waitFor();
    await page.evaluate(qualifyPermissions => {
      if (typeof window.showSaveFilePicker !== 'function') throw new Error('Native save picker is unavailable');
      document.title = 'Redeven Center native save acceptance';
      window.centerNativeSave = [];
      window.centerNativeSaveContinue = false;
      const picker = window.showSaveFilePicker.bind(window);
      // Observe the real browser promise without replacing its result or errors.
      window.showSaveFilePicker = async (...args) => {
        const result = { state: 'pending' };
        window.centerNativeSave.push(result);
        try {
          const handle = await picker(...args);
          result.state = 'selected';
          // Let the OS owner revoke access before the production sink opens
          // its writable. The real browser handle/error remains untouched.
          if (qualifyPermissions && window.centerNativeSave.length === 3) {
            await new Promise(resolve => {
              const timer = setInterval(() => {
                if (window.centerNativeSaveContinue) { clearInterval(timer); resolve(); }
              }, 20);
            });
          }
          return handle;
        } catch (error) {
          result.state = 'rejected';
          result.error = error.name;
          throw error;
        }
      };
    }, qualifyPermissions);
    await page.bringToFront();
    const destination = path.join(reportDir, 'native-center-download.txt');
    await writeFile(path.join(reportDir, 'native-save-ready.json'), JSON.stringify({ status: 'waiting_for_download_then_cancel', origin: new URL(page.url()).origin }));
    await page.waitForFunction(() => window.centerNativeSave[0]?.state === 'rejected', undefined, { timeout: 180000 });
    const canceled = await page.evaluate(() => window.centerNativeSave[0]);
    if (canceled.error !== 'AbortError') throw new Error('Native cancellation did not reject with AbortError');
    await page.getByRole('button', { name: 'Downloads', exact: true }).filter({ visible: true }).last().click();
    const task = page.locator('[data-download-task-id]').filter({ hasText: probe.name });
    await until(async () => await task.getAttribute('data-download-task-status') === 'canceled', 'Native save cancellation did not reach canceled state');
    if (!await task.getByRole('button', { name: 'Retry', exact: true }).isEnabled()) throw new Error('Canceled download cannot retry');
    const taskID = await task.getAttribute('data-download-task-id');
    const original = page.locator('[data-download-task-id="' + taskID + '"]');
    await writeFile(path.join(reportDir, 'native-save-retry-ready.json'), JSON.stringify({ status: 'waiting_for_retry_then_save', destination }));
    await page.waitForFunction(() => window.centerNativeSave[1]?.state === 'selected', undefined, { timeout: 180000 });
    const retried = page.locator('[data-download-task-id]:not([data-download-task-id="' + taskID + '"])').filter({ hasText: probe.name });
    await until(async () => await retried.getAttribute('data-download-task-status') === 'completed', 'Native save retry did not complete');
    const actual = await readFile(destination);
    const expected = Buffer.from(probe.content);
    if (!actual.equals(expected) || await original.getAttribute('data-download-task-status') !== 'canceled' || await task.count() !== 2) throw new Error('Native save retry lost canceled history or changed file bytes');
    const outcomes = await page.evaluate(() => window.centerNativeSave);
    if (outcomes.length !== 2) throw new Error('Unexpected native save picker invocation count');
    const result = { scope: 'Actual File Browser Download action and native macOS save dialog cancellation, Retry retains canceled history and saves exact bytes in a new attempt', outcomes, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), canceledHistoryPreserved: true };
    report.cases.push(result);
    await writeFile(path.join(reportDir, 'native-save-complete.json'), JSON.stringify(result));
    if (qualifyPermissions) {
      const rejectedDestination = path.join(permissionDirectory, 'permission-denied.txt');
      const recoveredDestination = path.join(permissionDirectory, 'permission-recovered.txt');
      const before = await task.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-download-task-id')));
      await writeFile(path.join(reportDir, 'native-permission-ready.json'), JSON.stringify({ status: 'retry_canceled_task_then_save', destination: rejectedDestination }));
      await page.waitForFunction(() => window.centerNativeSave[2]?.state === 'selected', undefined, { timeout: 180000 });
      await chmod(permissionDirectory, 0o500);
      await page.evaluate(() => { window.centerNativeSaveContinue = true; });
      const failed = page.locator('[data-download-task-status="failed"]').filter({ hasText: probe.name });
      try {
        await failed.waitFor({ timeout: 20000 });
        if (before.includes(await failed.getAttribute('data-download-task-id')) || !await failed.getByRole('button', { name: 'Retry', exact: true }).isEnabled()) throw new Error('Permission failure did not retain a new retryable attempt');
        await failed.getByText(/could not be modified due to the state of the underlying filesystem/).waitFor();
        if (await runtimeStatus(page) !== 200) throw new Error('Local write denial changed Runtime authority');
      } finally {
        await chmod(permissionDirectory, 0o700);
      }
      await writeFile(path.join(reportDir, 'native-permission-retry-ready.json'), JSON.stringify({ status: 'retry_failed_task_then_save', destination: recoveredDestination }));
      await page.waitForFunction(() => window.centerNativeSave[3]?.state === 'selected', undefined, { timeout: 180000 });
      const completed = page.locator('[data-download-task-status="completed"]').filter({ hasText: probe.name });
      await until(async () => await completed.count() === 2, 'Permission recovery did not complete the retry');
      const recovered = await readFile(recoveredDestination);
      if (!recovered.equals(expected) || await failed.count() !== 1 || await original.getAttribute('data-download-task-status') !== 'canceled') throw new Error('Permission retry changed content or prior outcomes');
      report.cases.push({ scope: 'Actual OS directory write permission revoked after native selection; production createWritable fails, filesystem error detail and Retry remain available, restoring access saves exact bytes', revokedMode: '0500', restoredMode: '0700', bytes: recovered.length, sha256: createHash('sha256').update(recovered).digest('hex'), canceledAndFailedHistoryPreserved: true, browserPermissionRevocationQualified: false });
    }
    if (reportDir) await page.screenshot({ path: path.join(reportDir, engine + '-download-complete.png'), fullPage: true });
    await rm(destination);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await verifyRuntimeWorkspace(page, false);
  } finally {
    try { await page.evaluate(() => window.centerDownloadProbe.close()); } finally {
      if (qualifyPermissions) {
        await chmod(permissionDirectory, 0o700);
        await rm(permissionDirectory, { recursive: true });
      }
      await rm(path.join(reportDir, 'native-center-download.txt'), { force: true });
    }
  }
}
async function verifyTerminalRecovery(page, context, portal, other, bundle) {
  if (engine !== 'chromium') throw new Error('Terminal recovery qualification requires Chrome CDP');
  await page.addScriptTag({ path: bundle });
  const probe = await page.evaluate(() => GatewayAcceptance.createTerminalRecoveryProbe());
  const cdp = await context.newCDPSession(page);
  let observer;
  let reopened;
  let offline = false;
  try {
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Terminal', exact: true }).click();
    const panel = page.locator('[data-terminal-panel-variant="panel"]:visible').last();
    await panel.getByRole('button', { name: 'Create session', exact: true }).click();
    const terminal = panel.locator('[data-terminal-semantic-canvas="true"]:visible').last().locator('xpath=ancestor::*[@data-terminal-runtime-session][1]');
    await until(async () => await terminal.getAttribute('aria-busy') === 'false' && Number(await terminal.getAttribute('data-terminal-presentation-sequence')) > 0, 'Recovery terminal not ready');
    probe.sessionID = await terminal.getAttribute('data-terminal-runtime-session');
    const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    await terminal.locator('textarea[data-terminal-input-bridge="semantic"]').focus();
    await page.keyboard.type('printf %s ' + quote(probe.marker) + ' >> ' + quote(probe.startsPath) + '; i=0; while [ "$i" -lt 90 ]; do i=$((i+1)); printf "%s:%s" ' + quote(probe.marker) + ' "$i" > ' + quote(probe.path) + '; sleep 1; done');
    await page.keyboard.press('Enter');
    let first;
    await until(async () => { first = await page.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe), probe); return first.iteration > 0; }, 'Typed remote command did not start');
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    offline = true;
    const rejected = await page.evaluate(async () => { try { await fetch('/api/local/runtime', { signal: AbortSignal.timeout(3000) }); return false; } catch { return true; } });
    if (!rejected) throw new Error('Target tab network was not actually offline');
    if (await runtimeStatus(other) !== 200 || (await centerCall(portal, 'directory')).status !== 200) throw new Error('One offline tab affected other authority');
    await new Promise(resolve => setTimeout(resolve, 4000));
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    offline = false;
    await cdp.detach();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => await runtimeStatus(page) === 200, 'Reload after offline lost authorization');
    await page.addScriptTag({ path: bundle });
    const online = await page.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe), probe);
    if (online.iteration <= first.iteration) throw new Error('Remote command stopped while browser was offline');
    observer = await openEnvironment(portal, context, 0);
    await until(async () => await runtimeStatus(observer) === 200, 'Observer could not reuse valid authority');
    await observer.addScriptTag({ path: bundle });
    await page.close();
    const closed = await observer.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe), probe);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const progressed = await observer.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe), probe);
    if (progressed.iteration <= closed.iteration) throw new Error('Closing the original page stopped the remote terminal');
    reopened = await openEnvironment(portal, context, 0);
    await until(async () => await runtimeStatus(reopened) === 200, 'Reopened page lost authority');
    await reopened.addScriptTag({ path: bundle });
    const recovered = await reopened.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe), probe);
    await reopened.getByRole('tab', { name: 'Activity', exact: true }).click();
    await reopened.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Terminal', exact: true }).click();
    await reopened.locator('[data-terminal-runtime-session="' + probe.sessionID + '"]:visible').waitFor({ timeout: 30000 });
    report.cases.push({ scope: 'Actual Chrome offline/reload and page close/reopen while one bounded remote terminal command continues; fresh Runtime catalog/file reads, same session rendered, no duplicated submission', first, online, closed, progressed, recovered, otherRuntimeUnaffected: true });
    await reopened.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await verifyRuntimeWorkspace(reopened, false);
    return reopened;
  } finally {
    if (offline) {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.detach();
    }
    const cleanup = observer ?? reopened ?? page;
    if (probe.sessionID) await cleanup.evaluate(probe => GatewayAcceptance.inspectTerminalRecoveryProbe(probe, true), probe);
    if (observer) await observer.close();
  }
}
async function verifyFlowerRecovery(page, context, portal, other, bundle) {
  if (engine !== 'chromium') throw new Error('Flower recovery qualification requires Chrome CDP');
  await page.addScriptTag({ path: bundle });
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Flower', exact: true }).click();
  const composer = page.locator('[data-flower-text-entry="true"]:visible textarea').last();
  await composer.fill('Return the bounded recovery fixture response without tools or delegation.');
  const [submitted] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/_redeven_proxy/api/ai/turns' && response.request().method() === 'POST', { timeout: 30000 }),
    composer.press('Enter'),
  ]);
  const receipt = await submitted.json();
  if (!submitted.ok() || !receipt.ok) throw new Error('UI Flower admission rejected: ' + JSON.stringify(receipt));
  const probe = { threadID: receipt.data.thread_id, runID: receipt.data.run_id };
  if (!probe.threadID || !probe.runID) throw new Error('UI Flower receipt missing identity: ' + JSON.stringify(receipt));
  const provider = async (method = 'GET') => {
    const response = await fetch(controlOrigin + '/flower-recovery', { method });
    if (!response.ok) throw new Error('Recovery provider control rejected');
    const value = await response.json();
    const status = { requests: qualificationCounter(value.requests), titles: qualificationCounter(value.titles), chunks: qualificationCounter(value.chunks), canceled: qualificationCounter(value.canceled) };
    if (status.requests > 1 || status.canceled !== 0) throw new Error('Browser lifecycle canceled or duplicated inference');
    return status;
  };
  const inspect = target => target.evaluate(id => GatewayAcceptance.inspectFlowerRecoveryProbe(id), probe.threadID);
  const showThread = async target => {
    await target.getByRole('tab', { name: 'Activity', exact: true }).click();
    await target.locator('nav[data-floe-shell-slot="activity-bar"]').getByRole('button', { name: 'Flower', exact: true }).click();
    try { await target.locator('[data-thread-id="' + probe.threadID + '"] button').first().click({ timeout: 30000 }); }
    catch (error) {
      console.error('FLOWER_RECOVERY_LIST', await target.evaluate(async () => ({ list: await (await fetch('/_redeven_proxy/api/ai/threads?limit=25')).json(), ids: [...document.querySelectorAll('[data-thread-id]')].map(element => element.getAttribute('data-thread-id')) })));
      throw error;
    }
    await target.getByText(/CENTER_FLOWER_RECOVERY_START/).first().waitFor({ timeout: 30000 });
  };
  let observer, reopened;
  let cleaned = false;
  const cdp = await context.newCDPSession(page);
  let frozen = false, offline = false, detached = false;
  try {
    await until(async () => {
      const view = await inspect(page);
      if (view.error) throw new Error('Recovery turn failed before streaming: ' + JSON.stringify(view));
      return (await provider()).chunks > 0;
    }, 'Provider never started');
    await showThread(page);
    observer = await openEnvironment(portal, context, 0);
    await until(async () => await runtimeStatus(observer) === 200, 'Flower observer could not reuse valid authority');
    await observer.addScriptTag({ path: bundle });
    const initial = await provider();
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); frozen = true;
    await portal.bringToFront();
    await until(async () => (await provider()).chunks > initial.chunks + 2, 'Frozen page stopped remote generation');
    const frozenView = await inspect(observer);
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }); frozen = false;
    await page.bringToFront();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); offline = true;
    const denied = await page.evaluate(async () => { try { await fetch('/api/local/runtime', { signal: AbortSignal.timeout(3000) }); return false; } catch { return true; } });
    if (!denied) throw new Error('Flower tab did not become offline');
    const beforeOffline = await provider();
    await until(async () => (await provider()).chunks > beforeOffline.chunks + 2, 'Offline page stopped remote generation');
    const offlineView = await inspect(observer);
    if (await runtimeStatus(other) !== 200 || (await centerCall(portal, 'directory')).status !== 200) throw new Error('Flower interruption affected another authority');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); offline = false;
    await cdp.detach(); detached = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => await runtimeStatus(page) === 200, 'Flower reload lost Runtime authority');
    await showThread(page);
    await page.close();
    const beforeClose = await provider();
    await until(async () => (await provider()).chunks > beforeClose.chunks + 2, 'Closed page stopped remote generation');
    const closedView = await inspect(observer);
    reopened = await openEnvironment(portal, context, 0);
    await until(async () => await runtimeStatus(reopened) === 200, 'Reopened Flower page lost Runtime authority');
    await reopened.addScriptTag({ path: bundle });
    await showThread(reopened);
    await provider('POST');
    let completed;
    await until(async () => { completed = await inspect(reopened); return completed.answers?.some(answer => answer.text?.includes('CENTER_FLOWER_RECOVERY_COMPLETE') && !answer.live); }, 'Recovered Flower run did not complete');
    await reopened.getByText(/CENTER_FLOWER_RECOVERY_COMPLETE/).first().waitFor({ timeout: 30000 });
    for (const view of [frozenView, offlineView, closedView, completed]) {
      if (view.threadID !== probe.threadID || view.runID !== probe.runID || view.error || view.users !== 1 || view.answers.length !== 1) throw new Error('Recovery changed canonical turn: ' + JSON.stringify(view));
    }
    const finalProvider = await provider();
    if (finalProvider.requests !== 1 || finalProvider.titles !== 1) throw new Error('Recovery duplicated the reply or automatic title');
    const cleanup = await reopened.evaluate(id => GatewayAcceptance.inspectFlowerRecoveryProbe(id, true), probe.threadID);
    cleaned = true;
    report.cases.push({ scope: 'Real Chrome Flower UI freeze/offline/reload/close/reopen, with one controlled local streaming model request through actual Runtime/Floret; no paid inference', probe, initial, finalProvider, frozenView, offlineView, closedView, completed, cleanup });
    await reopened.getByRole('tab', { name: 'Workbench', exact: true }).click();
    await verifyRuntimeWorkspace(reopened, false);
    return reopened;
  } finally {
    if (!detached && !page.isClosed()) {
      if (frozen) await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      if (offline) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.detach();
    }
    await fetch(controlOrigin + '/flower-recovery', { method: 'POST' });
    const cleanupPage = observer ?? reopened ?? page;
    if (!cleaned) await cleanupPage.evaluate(id => GatewayAcceptance.inspectFlowerRecoveryProbe(id, true), probe.threadID);
    if (observer) await observer.close();
  }
}
async function checkAccessibility(page) {
  await page.evaluate(await readFile(path.join(root, 'internal/envapp/ui_src/node_modules/axe-core/axe.min.js'), 'utf8'));
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) })));
  if (violations.length) throw new Error('Center accessibility: ' + JSON.stringify(violations));
}
async function runtimeLogin(page, target, recovery = false, negative = false) {
  if (negative) {
    await page.locator('input[autocomplete="current-password"]').fill('incorrect-qualification-password');
    await page.locator('button[type="submit"]').click();
    await page.getByText('The access password is incorrect. Check the password and try again.', { exact: true }).waitFor();
    if (await runtimeStatus(page) !== 423) throw new Error('Incorrect Runtime password authorized business');
  }
  await page.locator('input[autocomplete="current-password"]').fill('web-runtime-password');
  await page.locator('button[type="submit"]').click();
  await page.getByLabel('Authenticator code', { exact: true }).waitFor();
  if (await runtimeStatus(page) !== 423) throw new Error('Runtime password alone authorized business');
  if (negative) {
    await page.getByRole('button', { name: 'Use a recovery code', exact: true }).click();
    await page.locator('input[autocomplete="one-time-code"]').fill('invalid-qualification-recovery-code');
    await page.locator('button[type="submit"]').click();
    await page.getByText('This code is invalid or already used. Try a new code.', { exact: true }).waitFor();
    if (await runtimeStatus(page) !== 423) throw new Error('Invalid Runtime recovery factor authorized business');
    await page.getByRole('button', { name: 'Use an authenticator code', exact: true }).click();
  }
  if (recovery) await page.getByRole('button', { name: 'Use a recovery code', exact: true }).click();
  await page.locator('input[autocomplete="one-time-code"]').fill(recovery ? target.recoveryCodes.shift() : totp(target.secret));
  await page.locator('button[type="submit"]').click();
  await until(async () => await runtimeStatus(page) === 200, 'Runtime MFA did not authorize');
  if (recovery && target.label === fixture.externalHost && process.env.REDEVEN_CENTER_EXTERNAL_FIXTURE) {
    const file=process.env.REDEVEN_CENTER_EXTERNAL_FIXTURE;
    const privateFixture=JSON.parse(await readFile(file,'utf8'));
    privateFixture.recoveryCodes=target.recoveryCodes;
    await writeFile(file,JSON.stringify(privateFixture),{mode:0o600});
  }
}
async function verifyRuntimeAuthenticationBoundaries(page, target) {
  const submit = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/access/unlock')),
      page.locator('button[type="submit"]').click(),
    ]);
    const body = await response.json();
    return { status: response.status(), code: body.error?.code, factor: body.data?.second_factor_required };
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.locator('input[autocomplete="current-password"]').fill('incorrect-qualification-password');
    const result = await submit();
    const expected = attempt === 4 ? 'ACCESS_PASSWORD_RETRY_LATER' : 'ACCESS_PASSWORD_INVALID';
    if (result.code !== expected || await runtimeStatus(page) !== 423) throw new Error('Runtime password budget violated at ' + attempt + ': ' + JSON.stringify(result));
  }
  await page.getByText('Too many incorrect attempts. Wait for the cooldown, then try again.', { exact: true }).waitFor();
  if (!await page.locator('button[type="submit"]').isDisabled()) throw new Error('Runtime cooldown left submit enabled');
  await page.locator('input[autocomplete="current-password"]').fill('web-runtime-password');
  await page.locator('button[type="submit"]').waitFor({ state: 'visible' });
  const cooldownStarted = Date.now();
  while (await page.locator('button[type="submit"]').isDisabled()) {
    if (Date.now() - cooldownStarted > 45000) throw new Error('Runtime cooldown did not release');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const challenge = await submit();
  if (challenge.status !== 200) throw new Error('Runtime password did not recover after cooldown');
  await page.getByLabel('Authenticator code', { exact: true }).waitFor();
  const issued = Date.now();
  // Wait on the real server clock; browser fake time cannot certify expiry.
  await new Promise(resolve => setTimeout(resolve, 305000));
  await page.locator('input[autocomplete="one-time-code"]').fill(totp(target.secret));
  const expired = await submit();
  if (expired.code !== 'ACCESS_CHALLENGE_EXPIRED' || await runtimeStatus(page) !== 423) throw new Error('Expired Runtime challenge authorized business: ' + JSON.stringify(expired));
  await page.locator('input[autocomplete="current-password"]').waitFor();
  report.cases.push({ scope: 'Actual Runtime password throttling and challenge expiry through Chrome UI', passwordFailures: 5, cooldownObserved: true, challengeElapsedMs: Date.now() - issued, expiredCode: expired.code });
}
try {
  if (reportDir) await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const bundled = path.join(temporary, 'runtime.js');
  await build({ entryPoints: [path.join(root, 'internal/envapp/ui_src/scripts/fixtures/web-entry-browser.ts')], outfile: bundled, bundle: true, platform: 'browser', format: 'iife', globalName: 'GatewayAcceptance' });
  browser = await browserType.launch({ headless: process.env.REDEVEN_CENTER_HEADED !== '1', ...(process.env.REDEVEN_CENTER_BROWSER_CHANNEL ? {channel:process.env.REDEVEN_CENTER_BROWSER_CHANNEL} : {}) });
  report.channel = process.env.REDEVEN_CENTER_BROWSER_CHANNEL ?? 'bundled';
  report.externalHost = fixture.externalHost ?? null;
  report.version = browser.version();
  const context = await browser.newContext({ locale: 'en-US' });
  context.on('request', request => { if (new URL(request.url()).pathname === '/__center/finish') console.log('HANDOFF_HEADERS', JSON.stringify({origin: request.headers().origin, cookieNames: (request.headers().cookie ?? '').split(';').map(item => item.trim().split('=')[0])})); });
  const portal = await context.newPage();
  portal.on('pageerror', error => console.error('CENTER_PAGE_ERROR', error.message));
  portal.on('request', request => { if (new URL(request.url()).pathname === '/__center/finish') console.log('HANDOFF_ORIGIN', request.headers().origin); });
  await portal.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.setupDeliveries = {};
    window.fetch = async (input, options) => {
      const endpoint = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      const response = await original(input, options);
      if (endpoint.startsWith('/api/center/v1/setup/')) {
        const count = window.setupDeliveries[endpoint] ?? 0;
        window.setupDeliveries[endpoint] = count + 1;
        if (count === 0 && response.ok) {
          await response.arrayBuffer();
          throw new TypeError('Simulated response loss after owner commit');
        }
      }
      return response;
    };
  });
  await portal.goto(fixture.origin);
  await portal.getByLabel('One-time setup credential', { exact: true }).fill(fixture.setupToken);
  await portal.getByLabel('Entry password', { exact: true }).fill(password);
  await portal.getByRole('button', { name: 'Continue', exact: true }).click();
  const secret = await portal.getByTestId('totp-secret').textContent();
  centerSecret = secret;
  lastCenterTOTPStep = Math.floor(Date.now()/30000);
  const observedStatus = portal.waitForResponse(response => new URL(response.url()).pathname === '/api/center/v1/status');
  await portal.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await observedStatus;
  if (await portal.getByTestId('totp-secret').textContent({timeout:2000}) !== secret) throw new Error('Status refresh discarded the pending authenticator setup');
  await portal.getByLabel('Authenticator code', { exact: true }).fill(totp(secret));
  await portal.getByRole('button', { name: 'Verify', exact: true }).click();
  recoveryCodes = (await portal.getByTestId('recovery-codes').textContent()).trim().split(/\s+/);
  await portal.getByLabel('I saved these recovery codes', { exact: true }).check();
  await portal.getByRole('button', { name: 'Continue', exact: true }).click();
  if ((await centerCall(portal, 'directory')).status === 200) throw new Error('Setup silently created an authorized session');
  const setupDeliveries = await portal.evaluate(() => Object.values(window.setupDeliveries));
  if (setupDeliveries.some(count => count !== 2) || setupDeliveries.length !== 3) throw new Error('Setup lost-response retry did not retain each operation');
  await authenticate(portal);
  report.cases.push('Three-stage owner-authorized setup and password plus recovery-code login through actual UI');
  report.cases.push('Lost start, verify and commit responses recover one setup; visibility refresh preserves the pending wizard');
  if (process.env.REDEVEN_CENTER_PASSWORD_CHANGE === '1') {
    await portal.getByRole('button', { name: 'Entry security', exact: true }).click();
    await portal.getByLabel('New entry password', { exact: true }).fill('center-browser-replacement-password');
    await portal.getByRole('button', { name: 'Change entry password', exact: true }).click();
    await authenticate(portal, true);
    await portal.getByLabel('Entry password', { exact: true }).waitFor();
    if ((await centerCall(portal, 'directory')).status === 200) throw new Error('Password change left the old device session authorized');
    password = 'center-browser-replacement-password';
    await authenticate(portal);
    report.cases.push('Chrome Web Crypto password binding, current-password plus MFA approval, session revocation, and new-password login');
  }
  if (process.env.REDEVEN_CENTER_ACCESSIBILITY === '1') {
    await checkAccessibility(portal);
    await portal.setViewportSize({ width: 390, height: 844 });
    if (await portal.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Center empty directory overflows narrow viewport');
    await checkAccessibility(portal);
    const language = portal.getByLabel('Language', { exact: true });
    await language.selectOption('zh-TW');
    if (await portal.locator('html').getAttribute('lang') !== 'zh-TW') throw new Error('Locale did not update document semantics');
    await portal.locator('header select').selectOption('en-US');
    await portal.setViewportSize({ width: 1280, height: 900 });
    const add = portal.getByRole('button', { name: 'Add Gateway', exact: true }).first();
    await add.focus(); await portal.keyboard.press('Enter');
    const dialog = portal.getByRole('dialog', { name: 'Add Gateway', exact: true });
    await dialog.waitFor();
    await checkAccessibility(portal);
    await add.evaluate(element => element.focus());
    if (await add.evaluate(element => element === document.activeElement)) throw new Error('Modal left its background focusable');
    for (let i = 0; i < 12; i++) {
      await portal.keyboard.press('Tab');
      // Native dialogs may tab into browser chrome, represented as body.
      // No actual background page control may receive DOM focus.
      if (!await dialog.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement))) throw new Error('Modal keyboard focus reached the background page');
    }
    await portal.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    if (!await add.evaluate(element => element === document.activeElement)) throw new Error('Modal did not restore keyboard focus');
    report.cases.push('WCAG automated rules, 390px empty directory, Traditional Chinese document semantics, keyboard modal containment and restored focus');
  }
  if (process.env.REDEVEN_CENTER_SETUP_ONLY !== '1') {
  await portal.getByRole('button', { name: 'Add Gateway', exact: true }).first().click();
  const gatewayDialog = portal.getByRole('dialog', { name: 'Add Gateway', exact: true });
  await gatewayDialog.getByLabel('Name', { exact: true }).fill('Acceptance Gateway');
  await gatewayDialog.getByLabel('Gateway HTTPS address', { exact: true }).fill(fixture.gateway);
  await gatewayDialog.getByLabel('Client access code', { exact: true }).fill(fixture.accessCode);
  await gatewayDialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await authenticate(portal, true);
  await gatewayDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await gatewayDialog.waitFor({ state: 'hidden' });
  if(process.env.REDEVEN_CENTER_CAPACITY==='1') {
    await until(async()=>await portal.locator('.unbound').count()===100,'Signed catalog did not render 100 members');
    const directorySearch=portal.getByLabel('Search environments',{exact:true});
    await directorySearch.fill('capacity-member-099');
    if(await portal.locator('.unbound').count()!==1)throw new Error('Unbound Gateway members ignore shared directory search');
    const timings=[];
    for(let i=0;i<20;i++) {
      timings.push(await portal.evaluate(async query=>{
        const input=document.querySelector('input[aria-label="Search environments"]');
        const started=performance.now();input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return performance.now()-started;
      },i%2?'capacity-member-099':''));
    }
    await directorySearch.fill('');
    report.cases.push({scope:'100 real signed catalog members, shared search input to painted frame',samplesMs:timings});
  }
  for (const target of fixture.targets) {
    console.log('QUALIFICATION_BIND',target.runtimeID);
    const row = portal.locator('.unbound').filter({ hasText: target.label ?? target.runtimeID });
    await row.getByRole('button', { name: 'Enable Web entry', exact: true }).click();
    const routeDialog = portal.getByRole('dialog', { name: 'Enable Web entry', exact: true });
    await routeDialog.getByLabel('Environment HTTPS origin', { exact: true }).fill(target.origin);
    await routeDialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await authenticate(portal, true);
    const descriptor = JSON.parse(await portal.locator('#binding-title').locator('..').locator('pre').textContent());
    if (target === fixture.targets[0] && process.env.REDEVEN_CENTER_PORTAL_PERMISSIONS === '1') {
      const dialog = portal.getByRole('dialog', { name: 'Enable Web entry', exact: true });
      const cdp = await context.newCDPSession(portal);
      const { targetInfo } = await cdp.send('Target.getTargetInfo');
      await cdp.send('Browser.grantPermissions', { permissions: [], origin: fixture.origin, browserContextId: targetInfo.browserContextId });
      try {
        await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
        await dialog.getByText('Automatic copy is unavailable. Select the descriptor and copy it with your browser.', { exact: true }).waitFor({ timeout: 5000 });
        await dialog.getByRole('button', { name: 'Select text', exact: true }).focus();
        await portal.keyboard.press('Enter');
        if (await portal.evaluate(() => window.getSelection()?.toString()) !== JSON.stringify(descriptor, null, 2)) throw new Error('Manual binding selection did not preserve the complete descriptor');
        if ((await centerCall(portal, 'directory')).status !== 200) throw new Error('Denied clipboard disrupted Center authority');
        if (process.env.REDEVEN_CENTER_ACCESSIBILITY === '1') await checkAccessibility(portal);
        if (reportDir) await dialog.screenshot({ path: path.join(reportDir, engine + '-binding-copy-denied.png'), mask: [dialog.locator('.secret')] });
        await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: fixture.origin, browserContextId: targetInfo.browserContextId });
        await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
        await dialog.getByText('Copied to clipboard.', { exact: true }).waitFor();
        if (await portal.evaluate(() => navigator.clipboard.readText()) !== JSON.stringify(descriptor, null, 2)) throw new Error('Copy reported success without the complete binding descriptor');
        report.cases.push('Center Copy reports actual Chrome clipboard denial; keyboard manual selection preserves the complete descriptor; granting permission and retrying copies exact text');
      } finally { await context.clearPermissions(); await cdp.detach(); }
    }
    const applied = await fetch(controlOrigin + '/binding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(descriptor) });
    if (applied.status !== 204) throw new Error('Runtime owner rejected binding: HTTP ' + qualificationCounter(applied.status));
    await portal.locator('#binding-title').locator('..').getByRole('button', { name: 'Continue', exact: true }).click();
  }
  report.cases.push('Real signed Gateway pairing, explicit trust confirmation, ' + fixture.targets.length + ' independently owner-approved Runtime bindings');
  await portal.getByRole('button', {name:'Add bookmark',exact:true}).click();
  const bookmark = portal.getByRole('dialog', {name:'Add bookmark',exact:true});
  await bookmark.getByLabel('Name',{exact:true}).fill('Runtime documentation');
  await bookmark.getByLabel('Target HTTPS URL',{exact:true}).fill('https://example.com/documentation');
  await bookmark.getByRole('button',{name:'Continue',exact:true}).click();
  await authenticate(portal,true);
  await bookmark.waitFor({state:'hidden'});
  const direct = portal.getByRole('link',{name:'Open',exact:true});
  if (await direct.getAttribute('href') !== 'https://example.com/documentation') throw new Error('Bookmark URL changed');
  await direct.locator('..').getByRole('button',{name:'Remove connection',exact:true}).click();
  await until(async () => await direct.count() === 0, 'Bookmark removal did not settle');
  report.cases.push('Direct bookmark add/remove through sensitive reauthentication without server probing');
  await portal.getByRole('button',{name:'Entry security',exact:true}).click();
  await portal.getByRole('heading',{name:'Recent security activity',exact:true}).waitFor();
  await portal.getByRole('button',{name:'Environments',exact:true}).click();
  const search = portal.getByLabel('Search environments',{exact:true});
  await search.fill('center-runtime-a');
  await portal.reload();
  await until(async () => await search.inputValue() === 'center-runtime-a', 'Search state lost on reload');
  await search.fill('');
  await portal.setViewportSize({width:390,height:844});
  if (await portal.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Narrow layout overflows');
  await portal.setViewportSize({width:1280,height:900});
  const environments = [];
  for (const [index, target] of fixture.targets.entries()) {
    console.log('QUALIFICATION_RUNTIME',target.runtimeID);
    const environment = await openEnvironment(portal, context, index);
    environments.push(environment);
    if (index === 0 && process.env.REDEVEN_CENTER_AUTH_BOUNDARIES === '1') await verifyRuntimeAuthenticationBoundaries(environment, target);
    await runtimeLogin(environment, target, false, index === 0);
    await environment.addScriptTag({ path: bundled });
    report.cases.push({ runtime: target.runtimeID, assertions: await environment.evaluate(() => GatewayAcceptance.verifyWebEntryServices()) });
    await environment.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => await runtimeStatus(environment) === 200, 'Reload lost valid Runtime session');
    await verifyRuntimeWorkspace(environment, index === 0);
    if (index === 0 && process.env.REDEVEN_CENTER_PERMISSIONS === '1') await verifyDeniedClipboardManualInput(environment, context, bundled);
    if (index === 0 && process.env.REDEVEN_CENTER_UPLOADS === '1') {
      await environment.addScriptTag({ path: bundled });
      report.cases.push(await environment.evaluate(() => GatewayAcceptance.verifyAttachmentUpload()));
      await verifyAttachmentPicker(environment);
    }
    if (index === 0 && process.env.REDEVEN_CENTER_NATIVE_SAVE === '1') await verifyNativeDownloadPicker(environment, bundled);
    const cookies = await context.cookies(target.origin);
    if (cookies.some(cookie => cookie.domain !== new URL(target.origin).hostname || !cookie.secure)) throw new Error('Cookies escaped environment HTTPS host');
    if (reportDir) await environment.screenshot({ path: path.join(reportDir, engine + '-runtime-' + index + '.png'), fullPage: true });
  }
  report.cases.push('Incorrect Runtime password and invalid recovery factor show actionable feedback without business authority; correct MFA recovers in place');
  report.cases.push('Every Runtime renders a ready Workbench after reload; actual Activity file-browser and terminal navigation returns to Workbench');
  let applicationEnv = environments[fixture.applicationIndex ?? 0];
  if (process.env.REDEVEN_CENTER_LIFECYCLE === '1') {
    if (engine !== 'chromium') throw new Error('Lifecycle qualification requires actual Chromium CDP');
    const candidate = environments[0];
    const cdp = await context.newCDPSession(candidate);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    try {
      if (await runtimeStatus(environments[1]) !== 200) throw new Error('Freezing one tab affected another Runtime');
      await portal.bringToFront();
      if ((await centerCall(portal, 'directory')).status !== 200) throw new Error('Frozen Env blocked Center');
    } finally { await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await cdp.detach(); }
    await candidate.bringToFront();
    await until(async () => await runtimeStatus(candidate) === 200, 'Resumed Env lost valid authority');
    await candidate.addScriptTag({ path: bundled });
    await candidate.evaluate(() => GatewayAcceptance.verifyWebEntryServices());
    report.cases.push('Chrome page freeze/resume preserves server authorization and other tabs; resumed terminal/file/Git/Flower RPC use authoritative state');
  }
  if (process.env.REDEVEN_CENTER_TERMINAL_RECOVERY === '1') {
    const previous = environments[0];
    environments[0] = await verifyTerminalRecovery(previous, context, portal, environments[1], bundled);
    if (applicationEnv === previous) applicationEnv = environments[0];
  }
  if (process.env.REDEVEN_CENTER_FLOWER_RECOVERY === '1') {
    const previous = environments[0];
    environments[0] = await verifyFlowerRecovery(previous, context, portal, environments[1], bundled);
    if (applicationEnv === previous) applicationEnv = environments[0];
  }
  if (process.env.REDEVEN_CENTER_PERFORMANCE === '1') {
    const directory = [], opened = [];
    for (let i = 0; i < 20; i++) {
      let started = performance.now();
      await portal.reload({ waitUntil: 'domcontentloaded' });
      await portal.getByRole('button', { name: 'Open', exact: true }).first().waitFor();
      directory.push(performance.now() - started);
      started = performance.now();
      const tab = await openEnvironment(portal, context, 0);
      await until(async () => await runtimeStatus(tab) === 200, 'Repeated open lost valid Runtime login');
      opened.push(performance.now() - started);
      await tab.close();
    }
    const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1];
    report.performance = { scope: '20 sequential real Chrome directory reloads and repeat opens of an already authorized healthy route; loopback Gateway and Runtime; excludes password/MFA and cold install', directoryMs: directory, openMs: opened, directoryP95Ms: p95(directory), openP95Ms: p95(opened), targets: { directoryMs: 2000, openMs: 3000 } };
    if (report.performance.directoryP95Ms >= 2000 || report.performance.openP95Ms >= 3000) throw new Error('Measured directory/open P95 exceeds qualification target');
    report.cases.push('20 real Chrome directory/open latency samples meet the documented P95 targets on the recorded local topology');
  }
  if (process.env.REDEVEN_CENTER_CONNECTOR_BIN) {
    const restart = await fetch(controlOrigin + '/restart-connector', { method: 'POST' });
    if (restart.status !== 204) throw new Error('Independent Connector restart failed');
    for (const environment of environments) {
      const responses = [];
      try {
        await until(async () => {
          const response = await environment.evaluate(async () => {
            const result = await fetch('/api/local/runtime');
            const body = result.status === 200 ? '' : (await result.text()).trim();
            return { status: result.status, code: /^[A-Z_0-9]{1,80}$/.test(body) ? body : '' };
          });
          responses.push(response);
          return response.status === 200;
        }, 'Connector did not restore an authorized Runtime route');
      } catch (error) {
        report.connectorRecoveryFailure = { origin: new URL(environment.url()).origin, responses };
        throw error;
      }
      await environment.reload({ waitUntil: 'domcontentloaded' });
      await environment.addScriptTag({ path: bundled });
      await environment.evaluate(() => GatewayAcceptance.verifyWebEntryServices());
    }
    if ((await centerCall(portal, 'directory')).status !== 200) throw new Error('Connector restart invalidated Center authority');
    report.cases.push('Independent Connector process is killed and replaced; existing authorized routes reconnect, Runtime login persists, and real terminal/files/Flower streams work');
  }
  if(process.env.REDEVEN_CENTER_SOAK_SECONDS) {
    const seconds=Number(process.env.REDEVEN_CENTER_SOAK_SECONDS);
    const started=Date.now();
    const evidence={scope:'Ten isolated Runtime tabs when capacity is enabled; one live terminal and Flower event subscription per tab, file RPC and streamed read each cycle; no paid model generation',requestedSeconds:seconds,startedAt:new Date(started).toISOString(),status:'running',samples:[]};
    for(const environment of environments){
      await environment.addScriptTag({path:bundled});
      await environment.evaluate(async()=>{window.controlledWorkload=await GatewayAcceptance.startControlledWorkload();});
    }
    try {
      do {
        // A real browser input renews activity through the shipped UI listener.
        await environments[0].bringToFront();
        await environments[0].mouse.click(5,5);
        const tabs=await Promise.all(environments.map(page=>page.evaluate(()=>window.controlledWorkload.tick())));
        const server=qualificationResources(await(await fetch(controlOrigin+'/resources')).json());
        evidence.samples.push({elapsedMs:Date.now()-started,tabs,server});
        if(reportDir)await writeFile(path.join(reportDir,engine+'-soak.json'),JSON.stringify(evidence,null,2),{mode:0o600});
        const remaining=seconds*1000-(Date.now()-started);
        if(remaining<=0)break;
        await new Promise(resolve=>setTimeout(resolve,Math.min(30000,remaining)));
      } while(true);
      evidence.elapsedMs=Date.now()-started;evidence.status='passed';
    } catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
    finally {
      const cleanup=await Promise.allSettled(environments.map(page=>page.evaluate(()=>window.controlledWorkload.close())));
      evidence.cleanup=cleanup.map(result=>({status:result.status,...(result.status==='rejected'?{reason:String(result.reason)}:{})}));
      if(reportDir)await writeFile(path.join(reportDir,engine+'-soak.json'),JSON.stringify(evidence,null,2),{mode:0o600});
      if(cleanup.some(result=>result.status==='rejected'))throw new Error('Controlled workload cleanup failed');
    }
    report.cases.push(evidence);
  }
  if (process.env.REDEVEN_CENTER_REVOCATION_LATENCY === '1') {
    const samples = [];
    for (let sample = 0; sample < 20; sample++) {
      // Both products independently reject reuse of an accepted TOTP step.
      const step = Math.floor(Date.now() / 30000);
      while (Math.floor(Date.now() / 30000) <= step) await new Promise(resolve => setTimeout(resolve, 250));
      const device = await browser.newContext({ locale: 'en-US' });
      try {
        const entry = await device.newPage();
        await entry.goto(fixture.origin);
        await authenticate(entry);
        const target = await openEnvironment(entry, device, 0);
        await runtimeLogin(target, fixture.targets[0]);
        await target.addScriptTag({ path: bundled });
        await target.evaluate(async () => { window.latencyObserver = await GatewayAcceptance.observeEntryRevocation(); });
        // The response follows the authoritative revoke. Include the request
        // itself and polling resolution, giving a conservative observed bound.
        const started = performance.now();
        await entry.getByRole('button', { name: 'Sign out', exact: true }).click();
        await until(async () => await target.evaluate(() => window.latencyObserver.ended()), 'Sampled logout left a live Runtime stream');
        const elapsed = performance.now() - started;
        if (await runtimeStatus(target) !== 401) throw new Error('Sampled logout retained Runtime admission');
        if (await runtimeStatus(environments[1]) !== 200) throw new Error('Sampled logout affected another device');
        samples.push(elapsed);
      } finally { await device.close(); }
    }
    const p95 = [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1];
    report.revocationLatency = { scope: '20 independent Chrome device logins, each with Center and Runtime MFA and one live Flowersec session; measured from sign-out click through observed stream termination, including request and 200ms polling; loopback topology', samplesMs: samples, p95Ms: p95, targetMs: 2000 };
    if (p95 >= 2000) throw new Error('Observed logout revocation P95 exceeds target');
  }
  if(process.env.REDEVEN_CENTER_MODEL_TURN==='1') {
    const modelTarget=environments[0];
    await modelTarget.addScriptTag({path:bundled});
    report.cases.push(await modelTarget.evaluate(()=>GatewayAcceptance.verifyModelTurn()));
  }
  if(process.env.REDEVEN_CENTER_CONTAINER==='1') {
    await environments[0].addScriptTag({path:bundled});
    report.cases.push(await environments[0].evaluate(()=>GatewayAcceptance.verifyContainerLifecycle()));
  }
  if (fixture.largeFile) {
    await applicationEnv.addScriptTag({path:bundled});
    const samples=[];
    let sampling=false;
    const sample=async()=>{if(sampling)return;sampling=true;try{samples.push({at:Date.now(),...qualificationResources(await (await fetch(controlOrigin+'/resources')).json())});}finally{sampling=false;}};
    await sample();
    const timer=setInterval(()=>{void sample().catch(()=>{});},500);
    try {
      const result=await applicationEnv.evaluate(({path,size,sha256})=>GatewayAcceptance.verifyLargeFile(path,size,sha256),fixture.largeFile);
      await sample();
      report.cases.push({scope:'One GiB sparse fixture read through actual Flowersec stream, incremental SHA-256 and cancellation; shared Go fixture process memory includes Center, Gateway and two Runtimes',...result,serverMemorySamples:samples});
    } finally {clearInterval(timer);}
  }
  const runtimeAPI = async (endpoint,body) => applicationEnv.evaluate(async ({endpoint,body}) => {
    const response=await fetch('/_redeven_proxy/api/'+endpoint,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();
    if (!response.ok || !result.ok) throw new Error(endpoint+': '+JSON.stringify(result));
    return result.data;
  },{endpoint,body});
  const openApp = async (kind,id,appPath='/',owner=applicationEnv,browserContext=context) => {
    const result=await owner.evaluate(async input => {
      const response=await fetch('/__center/applications',{method:'POST',headers:{'Content-Type':'application/json','X-Redeven-Center':'1'},body:JSON.stringify({...input,request_id:crypto.randomUUID()})});
      return {status:response.status,...await response.json()};
    },{kind,id,path:appPath});
    if (!result.ok) throw new Error('Isolated application prepare rejected '+JSON.stringify(result));
    const page=await browserContext.newPage();
    page.on('response', async response => { const path=new URL(response.url()).pathname; if(path.includes('_redeven_window') || path.includes('flowersec')) console.log('CHILD_RESPONSE',path,response.status()); if(path.endsWith('/_redeven_window/connect')) { const result=await response.json().catch(()=>({})); console.log('CHILD_SCOPE',JSON.stringify({scope:result.spend_scope && {launcher:result.spend_scope.launcher_origin,runtime:result.spend_scope.runtime_origin,app:result.spend_scope.app_origin,target:result.spend_scope.target_binding},keys:Object.keys(result)})); } });
    page.on('websocket',socket=> { console.log('CHILD_SOCKET',new URL(socket.url()).pathname); socket.on('socketerror',error=>console.log('CHILD_SOCKET_ERROR',String(error))); });
    page.on('requestfailed', request => console.log('CHILD_REQUEST_FAILURE',new URL(request.url()).pathname,request.failure()?.errorText));
    page.on('pageerror', error => console.log('CHILD_PAGE_ERROR',error.message));
    await page.goto(result.data.destination);
    await page.waitForURL(url=>url.origin===result.data.origin && !url.pathname.startsWith('/__center/'),{timeout:45000});
    return page;
  };
  const forward=await runtimeAPI('forwards',{target:fixture.webService,name:'Center isolated service'});
  const service=await openApp('pf',forward.forward_id);
  await until(async()=> (await service.textContent('body')).includes('Center isolated service qualification'),'Isolated Web Service did not load');
  const echo=await service.evaluate(async()=> (await fetch('/',{method:'POST',body:'isolated private payload'})).text());
  if(echo!=='isolated private payload') throw new Error('Service request body changed');
  for (const url of ['/api/local/runtime','/_redeven_proxy/api/spaces','/cs/another/']) {
    if(await service.evaluate(async url=>(await fetch(url)).status,url)===200) throw new Error('Service crossed Runtime authority: '+url);
  }
  for (const url of ['/api/local/web-applications/cs/foreign/', '/%2e%2e/_redeven_proxy/api/spaces','/%252e%252e/api/local/runtime','/%5capi/local/runtime']) {
    const probe=await service.evaluate(async url=>{const response=await fetch(url);return {status:response.status,body:await response.text()};},url);
    if(probe.status===200 && probe.body!=='Center isolated service qualification')throw new Error('Child path escaped its application: '+url);
  }
  const spoofed=await service.evaluate(async()=> (await fetch('/api/local/runtime',{headers:{'X-Redeven-Web-App-Origin':location.origin,'X-Redeven-Web-Device':'forged','X-Forwarded-Host':'localhost','Authorization':'Bearer forged'}})).status);
  if(spoofed===200)throw new Error('Child-supplied headers obtained Runtime authority');
  if ((await context.cookies(service.url())).some(cookie=>cookie.name.startsWith('redeven_local_access'))) throw new Error('Runtime cookie reached child app');
  const sameOrigin=await applicationEnv.evaluate(async id=>(await fetch('/pf/'+id+'/')).status,forward.forward_id);
  if(sameOrigin!==403) throw new Error('Untrusted app served on Env origin');
  report.cases.push('Independent Web Service origin, POST integrity, blocked Env APIs and no Runtime authentication cookie disclosure');
  await service.close();
  if (process.env.REDEVEN_CENTER_CHILD_REOPEN === '1') {
    // A separate device keeps this stress case within its own receipt budget.
    const device = await browser.newContext({ locale: 'en-US' });
    try {
      const entry = await device.newPage();
      await entry.goto(fixture.origin);
      await authenticate(entry);
      const index = fixture.applicationIndex ?? 0;
      const owner = await openEnvironment(entry, device, index);
      await runtimeLogin(owner, fixture.targets[index], true);
      const first = await openApp('pf', forward.forward_id, '/', owner, device);
      const original = (await device.cookies(first.url())).find(cookie => cookie.name === '__Host-redeven-access');
      if (!original) throw new Error('Original child admission cookie missing');
      await first.close();
      for (let i = 0; i < 20; i++) {
        const reopened = await openApp('pf', forward.forward_id, '/reopen/' + i, owner, device);
        await until(async () => (await reopened.textContent('body')).includes('Center isolated service qualification'), 'Reopened service did not render');
        const cookie = (await device.cookies(reopened.url())).find(cookie => cookie.name === '__Host-redeven-access');
        if (cookie?.value !== original.value) throw new Error('Repeated service open allocated another authority');
        if (await reopened.evaluate(async () => (await fetch('/api/local/runtime')).status) === 200) throw new Error('Reused child crossed Runtime authority');
        await reopened.close();
      }
      await entry.getByRole('button', { name: 'Sign out', exact: true }).click();
      await until(async () => await runtimeStatus(owner) === 401, 'Reopen test device retained authority after logout');
      if (await runtimeStatus(environments[1]) !== 200 || await runtimeStatus(applicationEnv) !== 200) throw new Error('Repeated child opens or device logout affected another device');
      report.cases.push('Twenty real Chrome close/reopen cycles on an isolated device reuse one exact Web Service admission cookie, preserve isolated origin and Env API denial, and revoke without affecting another device');
    } finally { await device.close(); }
  }
  const graphical = await runtimeAPI('remote-desktop/sessions', {mode:'view',locale:'en-US'});
  const viewer = await openApp('pf', graphical.forward_id, '/_redeven_desktop/');
  await viewer.waitForFunction(() => Boolean(window.redevenWindowTransport), {timeout:15000});
  const viewerTicket = await viewer.evaluate(async () => {
    const response = await window.redevenWindowTransport.fetch('/_redeven_desktop/ticket', {method:'POST',signal:AbortSignal.timeout(20000)});
    const result = await response.json();
    return {status:response.status, token:typeof result.data?.token === 'string'};
  });
  if(viewerTicket.status!==200 || !viewerTicket.token) throw new Error('Resource-scoped graphical transport failed '+JSON.stringify(viewerTicket));
  if(await viewer.evaluate(async () => (await fetch('/_redeven_desktop/ticket',{method:'POST'})).status)!==403) throw new Error('Raw graphical transport bypassed Flowersec');
  const escaped = await viewer.evaluate(async () => {
    try { return (await window.redevenWindowTransport.fetch('/_redeven_proxy/api/spaces')).status===200; } catch { return false; }
  });
  if(escaped) throw new Error('Graphical transport obtained environment management');
  report.cases.push('Actual graphical viewer bootstraps resource-scoped Flowersec and ticket; raw and Env API access denied (media/input not certified)');
  await viewer.close();
  await applicationEnv.evaluate(async id => { await fetch('/_redeven_proxy/api/remote-desktop/sessions/'+id,{method:'DELETE'}); }, graphical.id);
  if (fixture.externalHost && process.env.REDEVEN_CENTER_PHYSICAL_VIEWER === '1') {
    const previous = applicationEnv;
    applicationEnv = environments[0];
    const physical = await runtimeAPI('remote-desktop/sessions', {mode:'control',locale:'en-US'});
    const physicalViewer = await openApp('pf', physical.forward_id, '/_redeven_desktop/');
    try {
      await physicalViewer.locator('#desktop[data-painted]').waitFor({timeout:45000});
      const before = await physicalViewer.locator('#desktop').screenshot();
      if (reportDir) await physicalViewer.screenshot({path:path.join(reportDir,engine+'-udesk26-physical.png'),fullPage:true});
      const locked = await physicalViewer.locator('#toolbar').getAttribute('data-state') === 'locked';
      if (locked) {
        await physicalViewer.locator('#start-unlock').click();
        const focused = await physicalViewer.locator('#desktop').screenshot();
        await physicalViewer.keyboard.press('Enter');
        await until(async () => changedDisplayPixels(focused, await physicalViewer.locator('#desktop').screenshot()) > 1000, 'Physical login-screen input did not change the central display; focus borders do not count');
        if (reportDir) await physicalViewer.screenshot({path:path.join(reportDir,engine+'-udesk26-input.png'),fullPage:true});
        await physicalViewer.keyboard.press('Escape');
        await physicalViewer.locator('#cancel-unlock').click();
      } else {
        const started=await fetch(controlOrigin+'/desktop-input/start',{method:'POST'});
        if(started.status!==204)throw new Error('Physical input fixture did not start');
        await until(async()=>changedDisplayPixels(before,await physicalViewer.locator('#desktop').screenshot())>1000,'Physical test dialog was not painted');
        await physicalViewer.locator('#desktop').click();
        // Digit keys provide an exact physical-input assertion independent of
        // the user's selected language/IME, which this test must not change.
        const marker=Array.from(crypto.getRandomValues(new Uint8Array(24)),value=>String(value%10)).join('');
        await physicalViewer.keyboard.press('Control+a');
        await physicalViewer.keyboard.type(marker,{delay:15});
        if(reportDir)await physicalViewer.screenshot({path:path.join(reportDir,engine+'-udesk26-input.png'),fullPage:true});
        await physicalViewer.keyboard.press('Enter');
        let result;
        await until(async()=>{result=await(await fetch(controlOrigin+'/desktop-input/result')).json();return result.done;},'Host did not complete the typed dialog');
        if(result.value!==marker)throw new Error('Host input differs from Chrome keyboard marker');
        const clipboardAvailable=await physicalViewer.locator('#clipboard').isEnabled();
        await physicalViewer.locator('#settings').click();
        const audioAvailable=await physicalViewer.locator('#sound').isEnabled();
        const textInputAvailable=await physicalViewer.locator('#text-input').isEnabled();
        await physicalViewer.locator('#panel button[value=close]').click();
        report.cases.push({scope:'udesk26 published graphical backend capabilities',clipboardAvailable,audioAvailable,textInputAvailable});
      }
      await physicalViewer.locator('#disconnect').click();
      await until(async()=>await physicalViewer.locator('#desktop[data-painted]').count()===0,'Explicit disconnect retained physical pixels');
      report.cases.push('udesk26 physical display first paint and video through Chrome; ' + (locked ? 'login-screen Enter changes captured pixels, Escape/cancel releases input' : 'active-session pointer, full keyboard marker and Enter confirmed by actual host application output') + '; explicit disconnect erases picture');
    } catch (error) {
      console.log('PHYSICAL_VIEWER_STATE', await physicalViewer.evaluate(() => ({state:document.querySelector('#toolbar')?.getAttribute('data-state'),status:document.querySelector('#status')?.textContent,hint:document.querySelector('#hint')?.textContent,notice:document.querySelector('#notice')?.textContent})));
      if (reportDir) await physicalViewer.screenshot({path:path.join(reportDir,engine+'-udesk26-physical-failure.png'),fullPage:true});
      throw error;
    } finally {
      await physicalViewer.close();
      await applicationEnv.evaluate(async id => { await fetch('/_redeven_proxy/api/remote-desktop/sessions/'+id,{method:'DELETE'}); }, physical.id);
      applicationEnv=previous;
    }
  }
  if(process.env.REDEVEN_CENTER_REMOTE_DOWNLOAD==='1') {
    const canceledID='center-download-cancel-'+Date.now();
    await runtimeAPI('code-runtime/setup-operations',{operation_id:canceledID,install_method:'remote_download'});
    await runtimeAPI('code-runtime/setup-operations/'+canceledID+'/cancel',{});
    const deadline=Date.now()+180000;
    while((await runtimeAPI('code-runtime/status')).operation.state==='running') {
      if(Date.now()>deadline)throw new Error('Editor cancel did not settle');
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    const retryID='center-download-retry-'+Date.now();
    await runtimeAPI('code-runtime/setup-operations',{operation_id:retryID,install_method:'remote_download'});
    while(true){
      const status=await runtimeAPI('code-runtime/status');
      if(status.operation.state==='succeeded') break;
      if(status.operation.state==='failed' || status.operation.state==='cancelled') throw new Error('Remote editor download failed: '+JSON.stringify(status.operation));
      if(Date.now()>deadline) throw new Error('Remote editor download exceeded qualification budget');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    report.cases.push('Real target remote_download cancellation and retry install completed without Desktop transfer');
  }
  if(fixture.editorInstalled || process.env.REDEVEN_CENTER_REMOTE_DOWNLOAD==='1'){
    const space=await runtimeAPI('spaces',{path:fixture.workspace,name:'Center editor'});
    await runtimeAPI('spaces/'+space.code_space_id+'/start',{});
    const editor=await openApp('cs',space.code_space_id);
    await until(async()=>{
      const trust=editor.getByRole('button',{name:/Yes, I trust/});
      if(await trust.count()) await trust.first().click();
      return await editor.locator('.monaco-workbench').count()>0 && (await editor.textContent('body')).includes('center-editor.txt');
    },'Editor workbench unavailable');
    await until(async () => {
      const frame = editor.frames().find(frame => frame.url().includes('/webWorkerExtensionHostIframe.html'));
      return Boolean(frame && await frame.evaluate(() => document.readyState === 'complete').catch(() => false));
    }, 'Editor extension worker frame was blocked');
    await editor.locator('.label-name').filter({hasText:'center-editor.txt'}).first().dblclick();
    await until(async()=> (await editor.locator('.monaco-editor .view-lines').first().textContent()??'').replaceAll('\u00a0',' ').includes('Center editor qualification'),'Editor file unavailable');
    await editor.locator('.monaco-editor .view-lines').first().click();
    await editor.keyboard.press('Meta+Home');
    await editor.keyboard.insertText('Saved through Web Center ');
    await editor.keyboard.press('Meta+s');
    await until(async()=> (await readFile(path.join(fixture.workspace,'center-editor.txt'),'utf8')).includes('Saved through Web Center'),'Editor save not persisted to Runtime workspace');
    await editor.reload();
    await editor.locator('.label-name').filter({ hasText: /^center-editor\.txt$/ }).first().dblclick({ timeout: 60_000 });
    await until(async()=> (await editor.locator('.monaco-editor .view-lines').first().textContent().catch(()=>'')).replaceAll('\u00a0',' ').includes('Saved through Web Center'),'Editor persisted save missing after reload');
    for(const url of ['/api/local/runtime','/_redeven_proxy/api/spaces','/cs/another/']) {
      if(await editor.evaluate(async url=>(await fetch(url)).status,url)===200) throw new Error('Editor crossed Runtime authority: '+url);
    }
    report.cases.push('Published Browser Editor workbench and extension worker iframe load, edit, save and reload on isolated origin; Env API and other codespace access denied');
    await runtimeAPI('spaces/'+space.code_space_id+'/stop',{});
    if(await editor.evaluate(async()=> (await fetch('/')).status)===200)throw new Error('Stopped editor instance retained child admission');
    await runtimeAPI('spaces/'+space.code_space_id+'/start',{});
    if(await editor.evaluate(async()=> (await fetch('/')).status)===200)throw new Error('Editor restart revived stale instance admission');
    await editor.close();
    await runtimeAPI('spaces/'+space.code_space_id+'/stop',{});
    report.cases.push('Stopped/restarted editor rejects old instance-bound child cookie');
  }
  // A lost response recovers the same operation; canceling a new tab preserves
  // an already-open owner and does not send Runtime lifecycle commands.
  const directoryBefore = (await centerCall(portal,'directory')).data;
  const request = 'repeat-open-'+crypto.randomUUID();
  const firstOpen = await centerCall(portal,'open',{route:directoryBefore.routes[0].id,request});
  const repeatedOpen = await centerCall(portal,'open',{route:directoryBefore.routes[0].id,request});
  if (!firstOpen.ok || !repeatedOpen.ok) throw new Error('Open retry rejected: ' + JSON.stringify({firstStatus:firstOpen.status,firstError:firstOpen.error,repeatStatus:repeatedOpen.status,repeatError:repeatedOpen.error}));
  if(firstOpen.data.id!==repeatedOpen.data.id) throw new Error('Open retry created a second operation');
  const canceledOpen=await centerCall(portal,'operations/cancel',{id:firstOpen.data.id});
  if(canceledOpen.data.status!=='canceled' || canceledOpen.data.sequence<=firstOpen.data.sequence || await runtimeStatus(applicationEnv)!==200) throw new Error('Cancel invalidated existing route or did not advance owner state');
  report.cases.push('Lost open response reuses operation; cancel advances sequence and preserves existing target');
  let releaseDirectory;
  const blockedDirectory=new Promise(resolve=>{releaseDirectory=resolve;});
  await portal.route('**/api/center/v1/directory',async route=>{await blockedDirectory;await route.continue();});
  await portal.route('**/api/center/v1/open',async route=>{const response=await route.fetch();const body=await response.json();body.data.status='connecting';body.data.sequence=0;delete body.data.destination;await route.fulfill({response,json:body});});
  let releasePoll;
  const blockedPoll=new Promise(resolve=>{releasePoll=resolve;});
  await portal.route('**/api/center/v1/operations?*',async route=>{await blockedPoll;await route.continue();});
  try {
    const [canceledTab]=await Promise.all([context.waitForEvent('page',{timeout:15000}),portal.getByRole('button',{name:'Open',exact:true}).first().click()]);
    await portal.locator('.operation').getByRole('button',{name:'Cancel',exact:true}).waitFor();
    await portal.getByRole('button',{name:'Refresh',exact:true}).click();
    const [cancelResponse]=await Promise.all([portal.waitForResponse(response=>new URL(response.url()).pathname==='/api/center/v1/operations/cancel',{timeout:15000}),portal.locator('.operation').getByRole('button',{name:'Cancel',exact:true}).click()]);
    if(cancelResponse.status()!==200)throw new Error('Unrelated form lock suppressed cancellation');
    releaseDirectory();releasePoll();
    await until(async()=>canceledTab.isClosed(),'Canceled pending tab navigated');
  } finally {
    releaseDirectory();releasePoll();
    await portal.unrouteAll({behavior:'wait'});
  }
  if(await runtimeStatus(applicationEnv)!==200)throw new Error('Pending-tab cancellation revoked existing environment');
  report.cases.push('Cancel reaches owner while unrelated directory refresh is busy; delayed ready cannot navigate pending tab');
  await portal.getByRole('button',{name:'Rotate entry key',exact:true}).first().click();
  const rotation=portal.getByRole('dialog',{name:'Rotate entry key',exact:true});
  await rotation.getByLabel('Current Runtime binding revision',{exact:true}).fill('1');
  await rotation.getByRole('button',{name:'Continue',exact:true}).click();
  await authenticate(portal,true);
  const replacement=JSON.parse(await portal.locator('#binding-title').locator('..').locator('pre').textContent());
  await until(async()=>await runtimeStatus(environments[0])!==200,'Rotation retained old entry admission');
  if(await runtimeStatus(environments[1])!==200) throw new Error('Rotation invalidated unrelated route');
  const appliedRotation=await fetch(controlOrigin+'/binding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(replacement)});
  if(appliedRotation.status!==204) throw new Error('Owner rejected rotated identity');
  await portal.locator('#binding-title').locator('..').getByRole('button',{name:'Continue',exact:true}).click();
  const rotated=await openEnvironment(portal,context,0);
  await runtimeLogin(rotated,fixture.targets[0],true);
  await environments[0].close();
  environments[0]=rotated;
  report.cases.push('Entry client certificate rotation fences old access, preserves another Runtime and requires fresh owner consent');
  if (reportDir) await portal.screenshot({ path: path.join(reportDir, engine + '-center.png'), fullPage: true });
  if (fixture.externalHost && process.env.REDEVEN_CENTER_RESTART_RUNTIME==='1') {
    const restarted=await fetch(controlOrigin+'/restart-runtime',{method:'POST'});
    if(restarted.status!==204)throw new Error('Task-owned Runtime restart failed');
    await until(async()=>await runtimeStatus(environments[0])!==200,'Runtime restart retained old authentication');
    if(await runtimeStatus(environments[1])!==200 || (await centerCall(portal,'directory')).status!==200)throw new Error('Target restart affected another environment or Center');
    await until(async () => {
      const catalog = await centerCall(portal, 'catalog?source='+encodeURIComponent(directoryBefore.routes[0].source_id));
      return catalog.data?.members.some(member => member.runtime_public_id === fixture.targets[0].runtimeID && member.connected);
    }, 'Restarted Runtime did not rejoin the Gateway');
    const directoryRefreshed = portal.waitForResponse(response => new URL(response.url()).pathname === '/api/center/v1/catalog');
    await portal.getByRole('button',{name:'Refresh',exact:true}).click();
    await directoryRefreshed;
    await until(async()=>await portal.getByRole('button',{name:'Open',exact:true}).first().isEnabled(),'Restarted Runtime did not rejoin');
    const reopened=await openEnvironment(portal,context,0);
    await runtimeLogin(reopened,fixture.targets[0],true);
    await environments[0].close();environments[0]=reopened;
    report.cases.push('Task-owned udesk26 Runtime restarts independently, invalidates old login, rejoins Gateway, and requires MFA; Center and second Runtime stay usable');
  }
  const secondContext = await browser.newContext({ locale: 'en-US' });
  const secondPortal = await secondContext.newPage();
  await secondPortal.goto(fixture.origin);
  await authenticate(secondPortal);
  const secondEnvironment = await openEnvironment(secondPortal, secondContext, 0);
  await runtimeLogin(secondEnvironment, fixture.targets[0], true);
  await environments[0].addScriptTag({path:bundled});
  await environments[0].evaluate(async () => { window.entryRevocation = await GatewayAcceptance.observeEntryRevocation(); });
  await portal.getByRole('button', { name: 'Sign out', exact: true }).click();
  await until(async () => (await centerCall(portal, 'directory')).status !== 200, 'Center logout did not revoke device');
  for (const environment of environments) await until(async () => await runtimeStatus(environment) === 401, 'Device logout left derived access usable');
  await until(async () => await environments[0].evaluate(() => window.entryRevocation.ended()), 'Logout left a live Flowersec stream connected');
  if (await runtimeStatus(secondEnvironment) !== 200) throw new Error('Device logout revoked another device');
  await environments[0].reload({ waitUntil: 'domcontentloaded' });
  if (await runtimeStatus(environments[0]) !== 401) throw new Error('Old Runtime cookies revived revoked Center access');
  report.cases.push('Device logout revokes both derived entries, preserves another device, and stale Runtime cookies cannot revive access');
  const other = await openEnvironment(secondPortal, secondContext, 1);
  await runtimeLogin(other, fixture.targets[1], true);
  await secondEnvironment.addScriptTag({path:bundled});
  await secondEnvironment.evaluate(async()=>{window.entryRevocation=await GatewayAcceptance.observeEntryRevocation();});
  const revoked = await fetch(controlOrigin+'/revoke-binding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({Target:0})});
  if(revoked.status!==204)throw new Error('Fixture binding revoke failed');
  await until(async()=>await secondEnvironment.evaluate(()=>window.entryRevocation.ended()),'Runtime binding revoke left live session');
  if(await runtimeStatus(other)!==200)throw new Error('Binding revoke affected unrelated Runtime');
  report.cases.push('Runtime owner binding revoke closes its live Flowersec session and preserves another Runtime');
  const clientRevoked=await fetch(controlOrigin+'/revoke-client',{method:'POST'});
  if(clientRevoked.status!==204)throw new Error('Gateway client revoke failed');
  await until(async()=>await runtimeStatus(other)!==200,'Gateway client revoke left access usable');
  report.cases.push('Gateway client revoke removes server access without stopping target Runtime');
  }
  report.status = 'passed';
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  if (reportDir && browser) for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    // Failure screenshots may contain setup secrets: keep evidence private.
    await page.screenshot({ path: path.join(reportDir, engine + '-failure-' + index + '.png'), fullPage: true, mask: [page.locator("input, .secret")] }).catch(() => {});
    console.error('FAILED_PAGE_ORIGIN', new URL(page.url()).origin);
    const alerts = await page.getByRole('alert').allTextContents().catch(() => []);
    console.error('FAILED_PAGE_ALERTS', JSON.stringify(alerts));
  }
  throw error;
} finally {
  if (reportDir) {
    await writeFile(path.join(reportDir, engine + '-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    for (const file of await readdir(reportDir)) await chmod(path.join(reportDir,path.basename(file)),0o600);
  }
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
